// ContextAnalyzer - breaks down the always-present request context (system prompt and tool definitions)

import type {
  ContextBreakdown,
  ToolSchemaEstimate,
  CacheEfficiency,
  SessionMessage,
  RequestSnapshot,
  ToolDefinition,
  TokenscopeConfig,
  ModelPricing,
  TokenModel,
  ContextAnalysisResult,
} from "./types.js"
import { TokenizerManager } from "./tokenizer.js"
import { firstCacheWriteTokens, summarizeTelemetry } from "./telemetry.js"
import { WarningCollector, formatErrorMessage } from "./warnings.js"

const ENVIRONMENT_INSTRUCTION_KEYS = new Set(["core/date", "core/environment"])
const PROJECT_INSTRUCTIONS_KEY = "core/instructions"
const API_INSTRUCTION_PREFIX = "api/"
const ESTIMATED_ENVIRONMENT_TOKENS = 150

export interface ContextAnalysisInput {
  sessionID: string
  messages: SessionMessage[]
  // The latest captured model request for the session, when one has been observed.
  snapshot?: RequestSnapshot
  tokenModel: TokenModel
  pricing: ModelPricing
  config: TokenscopeConfig
}

export class ContextAnalyzer {
  private toolTokenCache = new WeakMap<ToolDefinition, number>()

  constructor(
    private tokenizerManager: TokenizerManager,
    private warnings?: WarningCollector
  ) {}

  async analyze(input: ContextAnalysisInput): Promise<ContextAnalysisResult> {
    const { sessionID, messages, snapshot, tokenModel, pricing, config } = input
    const result: ContextAnalysisResult = {}
    const needsRequestContext = config.enableContextBreakdown || config.enableToolSchemaEstimation

    try {
      if (needsRequestContext && !snapshot) {
        this.warnings?.add(
          `No model request has been observed for session ${sessionID} since TokenScope loaded, so its system prompt and tool definitions are estimated instead of measured.`,
          `request-snapshot:${sessionID}`
        )
      }

      if (config.enableContextBreakdown) {
        result.contextBreakdown = snapshot
          ? await this.measureContext(snapshot, tokenModel)
          : this.estimateContextFromCacheTokens(messages)
      }

      if (config.enableToolSchemaEstimation) {
        result.toolEstimates = snapshot
          ? await this.measureToolSchemas(snapshot.tools, tokenModel)
          : this.estimateToolSchemas(messages)
      }

      if (config.enableCacheEfficiency) {
        result.cacheEfficiency = this.calculateCacheEfficiency(messages, pricing)
      }
    } catch (error) {
      this.warnings?.add(
        `Context analysis was skipped for session ${sessionID}: ${formatErrorMessage(error)}`,
        `context-analysis:${sessionID}`
      )
    }

    return result
  }

  private emptyBreakdown(): ContextBreakdown {
    return {
      baseSystemPrompt: { tokens: 0, identified: false },
      toolDefinitions: { tokens: 0, identified: false, toolCount: 0 },
      environmentContext: { tokens: 0, identified: false, components: [] },
      customInstructions: { tokens: 0, identified: false, sources: [] },
      guidance: { tokens: 0, identified: false, sources: [] },
      totalCachedContext: 0,
    }
  }

  /**
   * Tokenize the captured system prompt and tool definitions.
   *
   * OpenCode sends the agent's base prompt as one system part and its instruction sources
   * (environment, AGENTS.md files, skill/MCP/reference catalogs) as another, tagged per source.
   */
  private async measureContext(snapshot: RequestSnapshot, tokenModel: TokenModel): Promise<ContextBreakdown> {
    const breakdown = this.emptyBreakdown()
    const count = (text: string) => this.tokenizerManager.countTokens(text, tokenModel)

    for (const part of snapshot.system) {
      if (!part.instructions) {
        breakdown.baseSystemPrompt.tokens += await count(part.text)
        continue
      }

      for (const instruction of part.instructions) {
        const tokens = await count(instruction.text)

        if (ENVIRONMENT_INSTRUCTION_KEYS.has(instruction.key)) {
          breakdown.environmentContext.tokens += tokens
          breakdown.environmentContext.components.push(instruction.key)
        } else if (instruction.key === PROJECT_INSTRUCTIONS_KEY) {
          breakdown.customInstructions.tokens += tokens
          breakdown.customInstructions.sources.push(...this.extractInstructionFiles(instruction.text))
        } else if (instruction.key.startsWith(API_INSTRUCTION_PREFIX)) {
          breakdown.customInstructions.tokens += tokens
          breakdown.customInstructions.sources.push(instruction.key)
        } else {
          breakdown.guidance.tokens += tokens
          breakdown.guidance.sources.push(instruction.key)
        }
      }
    }

    await this.precomputeToolDefinitionTokens(snapshot.tools, tokenModel)
    breakdown.toolDefinitions.tokens = this.sumPrecomputedToolTokens(snapshot.tools)
    breakdown.toolDefinitions.toolCount = snapshot.tools.length

    for (const component of [
      breakdown.baseSystemPrompt,
      breakdown.toolDefinitions,
      breakdown.environmentContext,
      breakdown.customInstructions,
      breakdown.guidance,
    ]) {
      component.identified = true
    }

    breakdown.totalCachedContext =
      breakdown.baseSystemPrompt.tokens +
      breakdown.toolDefinitions.tokens +
      breakdown.environmentContext.tokens +
      breakdown.customInstructions.tokens +
      breakdown.guidance.tokens

    return breakdown
  }

  private extractInstructionFiles(text: string): string[] {
    return Array.from(text.matchAll(/^Instructions from:\s*(.+)$/gim), (match) => match[1].trim()).filter(Boolean)
  }

  /**
   * Estimate the context breakdown when no model request was captured.
   *
   * The first cache_write bucket is used as an observed allocation budget, not as a complete
   * measurement of the context window. Each estimated component is taken from that budget in
   * turn, so the displayed parts can never add up to more than the observed count. The remainder
   * covers the base prompt, custom instructions and catalogs, which usage telemetry cannot split.
   */
  private estimateContextFromCacheTokens(messages: SessionMessage[]): ContextBreakdown {
    const breakdown = this.emptyBreakdown()
    const totalCachedTokens = firstCacheWriteTokens(messages)
    if (totalCachedTokens === 0) return breakdown

    const toolEstimates = this.estimateToolSchemas(messages)
    const estimatedToolTokens = toolEstimates.reduce((sum, estimate) => sum + estimate.estimatedTokens, 0)

    let remainingTokens = totalCachedTokens
    breakdown.toolDefinitions.tokens = Math.min(estimatedToolTokens, remainingTokens)
    breakdown.toolDefinitions.toolCount = toolEstimates.length
    remainingTokens -= breakdown.toolDefinitions.tokens

    breakdown.environmentContext.tokens = Math.min(ESTIMATED_ENVIRONMENT_TOKENS, remainingTokens)
    breakdown.environmentContext.components = [...ENVIRONMENT_INSTRUCTION_KEYS]
    remainingTokens -= breakdown.environmentContext.tokens

    breakdown.baseSystemPrompt.tokens = remainingTokens
    breakdown.totalCachedContext = totalCachedTokens

    return breakdown
  }

  private async measureToolSchemas(tools: ToolDefinition[], tokenModel: TokenModel): Promise<ToolSchemaEstimate[]> {
    await this.precomputeToolDefinitionTokens(tools, tokenModel)

    return tools
      .map((tool) => ({
        name: tool.id,
        enabled: true,
        estimatedTokens: this.toolTokenCache.get(tool) ?? 0,
        argumentCount: this.countSchemaArguments(tool.schema),
        hasComplexArgs: this.hasComplexSchemaArguments(tool.schema),
        source: "model-request" as const,
      }))
      .sort((a, b) => b.estimatedTokens - a.estimatedTokens)
  }

  /**
   * Estimate tool schema sizes from the tool calls in the transcript. Only tools the session
   * actually called are visible this way.
   */
  private estimateToolSchemas(messages: SessionMessage[]): ToolSchemaEstimate[] {
    const toolCallData = this.extractToolCallData(messages)

    return Array.from(toolCallData.entries())
      .map(([toolName, callData]) => {
        const estimate = this.estimateToolTokens(callData)
        return {
          name: toolName,
          enabled: true,
          estimatedTokens: estimate.tokens,
          argumentCount: estimate.argCount,
          hasComplexArgs: estimate.hasComplex,
          source: "transcript" as const,
        }
      })
      .sort((a, b) => b.estimatedTokens - a.estimatedTokens)
  }

  private formatToolDefinition(tool: ToolDefinition): string {
    return [
      `<tool name="${tool.id}">`,
      tool.description ? `<description>\n${tool.description}\n</description>` : undefined,
      tool.schema ? `<schema>\n${JSON.stringify(tool.schema, null, 2)}\n</schema>` : undefined,
      `</tool>`,
    ]
      .filter(Boolean)
      .join("\n")
  }

  private countSchemaArguments(schema: unknown): number {
    if (!schema || typeof schema !== "object") {
      return 0
    }

    const properties = (schema as any).properties
    return properties && typeof properties === "object" ? Object.keys(properties).length : 0
  }

  private hasComplexSchemaArguments(schema: unknown): boolean {
    if (!schema || typeof schema !== "object") {
      return false
    }

    const properties = (schema as any).properties
    if (!properties || typeof properties !== "object") {
      return false
    }

    return Object.values(properties).some((property) => {
      if (!property || typeof property !== "object") return false
      const type = (property as any).type
      return type === "array" || type === "object" || !!(property as any).properties || !!(property as any).items
    })
  }

  private sumPrecomputedToolTokens(tools: ToolDefinition[]): number {
    return tools.reduce((sum, tool) => sum + (this.toolTokenCache.get(tool) ?? 0), 0)
  }

  private async precomputeToolDefinitionTokens(tools: ToolDefinition[], tokenModel: TokenModel): Promise<void> {
    await Promise.all(
      tools.map(async (tool) => {
        if (this.toolTokenCache.has(tool)) {
          return
        }

        this.toolTokenCache.set(tool, await this.tokenizerManager.countTokens(this.formatToolDefinition(tool), tokenModel))
      })
    )
  }

  /**
   * Extract tool call argument data for inference
   */
  private extractToolCallData(messages: SessionMessage[]): Map<string, ToolCallInfo[]> {
    const data = new Map<string, ToolCallInfo[]>()

    for (const message of messages) {
      for (const part of message.parts) {
        if (part.type !== "tool" || !part.tool) continue

        const calls = data.get(part.tool) ?? []
        if (part.state.input) {
          calls.push({
            argNames: Object.keys(part.state.input),
            argTypes: this.inferArgTypes(part.state.input),
          })
        }
        data.set(part.tool, calls)
      }
    }

    return data
  }

  /**
   * Infer argument types from values
   */
  private inferArgTypes(input: Record<string, unknown>): Record<string, string> {
    const types: Record<string, string> = {}

    for (const [key, value] of Object.entries(input)) {
      if (Array.isArray(value)) {
        types[key] = "array"
      } else if (typeof value === "object" && value !== null) {
        types[key] = "object"
      } else if (typeof value === "number") {
        types[key] = "number"
      } else if (typeof value === "boolean") {
        types[key] = "boolean"
      } else {
        types[key] = "string"
      }
    }

    return types
  }

  /**
   * Estimate tokens for a tool schema based on call data
   *
   * base_tokens = 200  (description + schema overhead)
   * per_simple_arg = 30
   * per_complex_arg = 60  (arrays, objects)
   * description_bonus = 80 (simple) or 120 (complex)
   */
  private estimateToolTokens(callData: ToolCallInfo[]): { tokens: number; argCount: number; hasComplex: boolean } {
    const BASE_TOKENS = 200
    const PER_SIMPLE_ARG = 30
    const PER_COMPLEX_ARG = 60
    const SIMPLE_DESCRIPTION_BONUS = 80
    const COMPLEX_DESCRIPTION_BONUS = 120

    // If no call data, use conservative defaults
    if (callData.length === 0) {
      return {
        tokens: BASE_TOKENS + 3 * PER_SIMPLE_ARG + PER_COMPLEX_ARG + SIMPLE_DESCRIPTION_BONUS,
        argCount: 3,
        hasComplex: true,
      }
    }

    // Aggregate argument info from all calls
    const allArgNames = new Set<string>()
    const complexArgs = new Set<string>()

    for (const call of callData) {
      for (const name of call.argNames) {
        allArgNames.add(name)
      }
      for (const [name, type] of Object.entries(call.argTypes)) {
        if (type === "array" || type === "object") {
          complexArgs.add(name)
        }
      }
    }

    const argCount = allArgNames.size
    const simpleArgCount = argCount - complexArgs.size
    const complexArgCount = complexArgs.size
    const hasComplex = complexArgCount > 0

    const descBonus = hasComplex ? COMPLEX_DESCRIPTION_BONUS : SIMPLE_DESCRIPTION_BONUS
    const tokens = BASE_TOKENS + simpleArgCount * PER_SIMPLE_ARG + complexArgCount * PER_COMPLEX_ARG + descBonus

    return { tokens, argCount, hasComplex }
  }

  /**
   * Calculate cache efficiency metrics
   */
  private calculateCacheEfficiency(messages: SessionMessage[], pricing: ModelPricing): CacheEfficiency {
    const telemetry = summarizeTelemetry(messages)
    const totalCacheRead = telemetry.cacheReadTokens
    const totalFreshInput = telemetry.inputTokens
    const totalCacheWrite = telemetry.cacheWriteTokens
    const totalInputTokens = totalCacheRead + totalFreshInput + totalCacheWrite
    const cacheableInputTokens = totalCacheRead + totalFreshInput

    // Cache hit rate (read-hit ratio over cacheable input)
    const cacheHitRate = cacheableInputTokens > 0 ? (totalCacheRead / cacheableInputTokens) * 100 : 0

    // Cost calculations
    const costWithoutCaching = (totalInputTokens / 1_000_000) * pricing.input
    const costWithCaching =
      (totalFreshInput / 1_000_000) * pricing.input +
      (totalCacheRead / 1_000_000) * pricing.cacheRead +
      (totalCacheWrite / 1_000_000) * pricing.cacheWrite

    const costSavings = costWithoutCaching - costWithCaching
    const savingsPercent = costWithoutCaching > 0 ? (costSavings / costWithoutCaching) * 100 : 0

    // Effective rate (what you're actually paying per token)
    const effectiveRate = totalInputTokens > 0 ? (costWithCaching / totalInputTokens) * 1_000_000 : 0
    const standardRate = pricing.input

    return {
      cacheReadTokens: totalCacheRead,
      freshInputTokens: totalFreshInput,
      cacheWriteTokens: totalCacheWrite,
      totalInputTokens,
      cacheHitRate,
      costWithoutCaching,
      costWithCaching,
      costSavings,
      savingsPercent,
      effectiveRate,
      standardRate,
    }
  }
}

interface ToolCallInfo {
  argNames: string[]
  argTypes: Record<string, string>
}
