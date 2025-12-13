// ContextAnalyzer - analyzes context breakdown from opencode export

import type {
  ContextBreakdown,
  ContextComponent,
  ToolSchemaEstimate,
  CacheEfficiency,
  ExportedSession,
  ExportedMessage,
  ExportedPart,
  TokenscopeConfig,
  ModelPricing,
  TokenModel,
  ContextAnalysisResult,
} from "./types"
import { TokenizerManager } from "./tokenizer"

export class ContextAnalyzer {
  private tokenizerManager: TokenizerManager

  constructor(tokenizerManager: TokenizerManager) {
    this.tokenizerManager = tokenizerManager
  }

  /**
   * Main entry point - analyzes a session using opencode export
   */
  async analyze(
    sessionID: string,
    tokenModel: TokenModel,
    pricing: ModelPricing,
    config: TokenscopeConfig
  ): Promise<ContextAnalysisResult> {
    const result: ContextAnalysisResult = {}

    try {
      const exported = await this.runExport(sessionID)
      if (!exported) return result

      if (config.enableContextBreakdown) {
        result.contextBreakdown = await this.analyzeContextBreakdown(exported, tokenModel)
      }

      if (config.enableToolSchemaEstimation) {
        result.toolEstimates = this.estimateToolSchemas(exported)
      }

      if (config.enableCacheEfficiency) {
        result.cacheEfficiency = this.calculateCacheEfficiency(exported, pricing)
      }
    } catch (error) {
      console.error(`Context analysis failed for session ${sessionID}:`, error)
    }

    return result
  }

  /**
   * Execute opencode export and parse the JSON output
   */
  private async runExport(sessionID: string): Promise<ExportedSession | null> {
    try {
      const { $ } = await import("bun")
      const result = await $`opencode export ${sessionID}`.text()

      // Find the start of JSON - the output format is:
      // "Exporting session: <id>{...json...}"
      // Note: There's no newline between the prefix and the JSON
      const jsonStartIndex = result.indexOf("{")
      if (jsonStartIndex === -1) {
        console.error(`No JSON found in opencode export output for session ${sessionID}`)
        return null
      }

      const jsonContent = result.slice(jsonStartIndex)
      return JSON.parse(jsonContent) as ExportedSession
    } catch (error) {
      console.error(`Failed to run opencode export for session ${sessionID}:`, error)
      return null
    }
  }

  /**
   * Analyze context breakdown from cache_write tokens.
   *
   * Note: OpenCode's `opencode export` command doesn't include system prompt content
   * in the output, so we estimate the breakdown from the first cache_write token count
   * which represents the total cached context size.
   *
   * If system prompts become available in future versions, we can enhance this
   * to tokenize the actual content for more accurate breakdowns.
   */
  private async analyzeContextBreakdown(
    exported: ExportedSession,
    tokenModel: TokenModel
  ): Promise<ContextBreakdown> {
    const breakdown: ContextBreakdown = {
      baseSystemPrompt: { tokens: 0, identified: false },
      toolDefinitions: { tokens: 0, identified: false, toolCount: 0 },
      environmentContext: { tokens: 0, identified: false, components: [] },
      projectTree: { tokens: 0, identified: false, fileCount: 0 },
      customInstructions: { tokens: 0, identified: false, sources: [] },
      totalCachedContext: 0,
    }

    // Try to get system prompts from export (for future compatibility)
    const systemPrompts = this.extractSystemPrompts(exported)

    // If system prompts are available, analyze them directly
    if (systemPrompts.length > 0) {
      return this.analyzeSystemPromptContent(exported, tokenModel, systemPrompts, breakdown)
    }

    // Default: Estimate from cache_write tokens
    return this.estimateContextFromCacheTokens(exported, breakdown)
  }

  /**
   * Analyze actual system prompt content (for when opencode export includes it)
   */
  private async analyzeSystemPromptContent(
    exported: ExportedSession,
    tokenModel: TokenModel,
    systemPrompts: string[],
    breakdown: ContextBreakdown
  ): Promise<ContextBreakdown> {

    for (const prompt of systemPrompts) {
      const promptLower = prompt.toLowerCase()
      const tokens = await this.tokenizerManager.countTokens(prompt, tokenModel)

      // The system prompt typically has multiple parts that may be concatenated.
      // We need to detect different sections within each prompt string.

      // Check for environment context with <env> tags
      if (promptLower.includes("<env>")) {
        // Extract just the env section tokens
        const envMatch = prompt.match(/<env>[\s\S]*?<\/env>/i)
        if (envMatch) {
          const envTokens = await this.tokenizerManager.countTokens(envMatch[0], tokenModel)
          breakdown.environmentContext.tokens += envTokens
          breakdown.environmentContext.identified = true

          if (promptLower.includes("working directory:")) {
            breakdown.environmentContext.components.push("working-dir")
          }
          if (promptLower.includes("platform:")) {
            breakdown.environmentContext.components.push("platform")
          }
          if (promptLower.includes("git repo")) {
            breakdown.environmentContext.components.push("git-status")
          }
          if (promptLower.includes("date:")) {
            breakdown.environmentContext.components.push("date")
          }
        }
      }

      // Check for project tree with <files> tags
      if (promptLower.includes("<files>")) {
        const filesMatch = prompt.match(/<files>[\s\S]*?<\/files>/i)
        if (filesMatch) {
          const filesTokens = await this.tokenizerManager.countTokens(filesMatch[0], tokenModel)
          breakdown.projectTree.tokens += filesTokens
          breakdown.projectTree.identified = true

          // Count file references
          const fileMatches = filesMatch[0].match(/\n\s+[\w\-\.]+\.[a-z]{1,5}/g)
          if (fileMatches) {
            breakdown.projectTree.fileCount += fileMatches.length
          }
        }
      }

      // Check for custom instructions
      if (promptLower.includes("instructions from:") || promptLower.includes("agents.md")) {
        // Try to extract just the instructions section
        const instructionMatches = prompt.match(/Instructions from:[\s\S]*?(?=Instructions from:|<env>|<files>|$)/gi)
        if (instructionMatches) {
          for (const match of instructionMatches) {
            const instrTokens = await this.tokenizerManager.countTokens(match, tokenModel)
            breakdown.customInstructions.tokens += instrTokens
            breakdown.customInstructions.identified = true

            // Extract source path
            const pathMatch = match.match(/Instructions from:\s*([^\n]+)/i)
            if (pathMatch && pathMatch[1]) {
              const sourcePath = pathMatch[1].trim()
              if (sourcePath && !breakdown.customInstructions.sources.includes(sourcePath)) {
                breakdown.customInstructions.sources.push(sourcePath)
              }
            }
          }
        }
      }

      // Tool definitions detection (in <functions> tags)
      if (promptLower.includes("<functions>") || promptLower.includes('"type": "object"')) {
        const functionsMatch = prompt.match(/<functions>[\s\S]*?<\/functions>/i)
        if (functionsMatch) {
          const funcTokens = await this.tokenizerManager.countTokens(functionsMatch[0], tokenModel)
          breakdown.toolDefinitions.tokens += funcTokens
          breakdown.toolDefinitions.identified = true

          // Count tools from <function> tags
          const toolMatches = functionsMatch[0].match(/<function>/g)
          if (toolMatches) {
            breakdown.toolDefinitions.toolCount += toolMatches.length
          }
        } else {
          // Fallback: count the whole prompt as tool definitions
          breakdown.toolDefinitions.tokens += tokens
          breakdown.toolDefinitions.identified = true
        }
      }

      // Base system prompt detection - the main instructions
      // This is typically the first/longest part without the special tags
      if (
        (promptLower.includes("you are opencode") ||
          promptLower.includes("you are claude") ||
          promptLower.includes("you are an") ||
          promptLower.includes("you are a ") ||
          (promptLower.includes("assistant") && promptLower.includes("software engineering"))) &&
        !promptLower.includes("<env>") &&
        !promptLower.includes("<files>") &&
        !promptLower.includes("<functions>")
      ) {
        breakdown.baseSystemPrompt.tokens += tokens
        breakdown.baseSystemPrompt.identified = true
      }
      // If nothing specific matched but it's substantial text, add to base prompt
      else if (
        prompt.length > 500 &&
        !promptLower.includes("<env>") &&
        !promptLower.includes("<files>") &&
        !promptLower.includes("<functions>") &&
        !promptLower.includes("instructions from:")
      ) {
        breakdown.baseSystemPrompt.tokens += tokens
      }
    }

    breakdown.totalCachedContext =
      breakdown.baseSystemPrompt.tokens +
      breakdown.toolDefinitions.tokens +
      breakdown.environmentContext.tokens +
      breakdown.projectTree.tokens +
      breakdown.customInstructions.tokens

    return breakdown
  }

  /**
   * Extract system prompts from exported session
   */
  private extractSystemPrompts(exported: ExportedSession): string[] {
    const prompts: Set<string> = new Set()

    for (const message of exported.messages) {
      // Assistant messages contain system[] in info
      if (message.info.role === "assistant" && message.info.system) {
        for (const prompt of message.info.system) {
          if (prompt && prompt.trim()) {
            prompts.add(prompt.trim())
          }
        }
      }
    }

    return Array.from(prompts)
  }

  /**
   * Estimate context breakdown from cache token counts when system prompts aren't available.
   *
   * Based on typical OpenCode system prompt structure:
   * - Base System Prompt: ~1,500-2,000 tokens
   * - Tool Definitions: ~350 tokens per tool (typically 12-15 tools = ~4,500-5,500)
   * - Environment Context: ~100-200 tokens
   * - Project Tree: ~300-800 tokens (varies by project)
   * - Custom Instructions: ~100-500 tokens
   *
   * We use the first cache_write value as an estimate of total cached context.
   */
  private estimateContextFromCacheTokens(
    exported: ExportedSession,
    breakdown: ContextBreakdown
  ): ContextBreakdown {
    // Find the first assistant message with cache_write to get total context size
    let totalCachedTokens = 0
    let enabledToolCount = 0

    for (const message of exported.messages) {
      if (message.info.role === "assistant" && message.info.tokens?.cache?.write) {
        totalCachedTokens = message.info.tokens.cache.write
        break
      }
    }

    // Count enabled tools from tool calls
    const enabledTools = this.extractEnabledTools(exported)
    enabledToolCount = Object.keys(enabledTools).length

    if (totalCachedTokens === 0) {
      return breakdown
    }

    // Estimate tool definitions (~350 tokens per tool)
    const estimatedToolTokens = enabledToolCount * 350
    breakdown.toolDefinitions.tokens = estimatedToolTokens
    breakdown.toolDefinitions.toolCount = enabledToolCount
    breakdown.toolDefinitions.identified = false // Mark as estimated

    // Estimate environment context (~150 tokens)
    breakdown.environmentContext.tokens = 150
    breakdown.environmentContext.components = ["working-dir", "platform", "git-status", "date"]
    breakdown.environmentContext.identified = false

    // Estimate project tree (~500 tokens average)
    breakdown.projectTree.tokens = 500
    breakdown.projectTree.identified = false

    // Remaining tokens go to base system prompt
    const remainingTokens = totalCachedTokens - estimatedToolTokens - 150 - 500
    breakdown.baseSystemPrompt.tokens = Math.max(0, remainingTokens)
    breakdown.baseSystemPrompt.identified = false

    breakdown.totalCachedContext = totalCachedTokens

    return breakdown
  }

  /**
   * Check if content looks like a file tree
   */
  private looksLikeFileTree(content: string): boolean {
    const lines = content.split("\n")
    let indentedLines = 0
    let filePatternLines = 0

    for (const line of lines) {
      if (/^\s{2,}[\w\-\.]+/.test(line)) {
        indentedLines++
      }
      if (/\.(ts|js|md|json|py|go|rs|java|c|cpp|h|css|html|tsx|jsx)$/i.test(line)) {
        filePatternLines++
      }
    }

    return indentedLines > 5 && filePatternLines > 3
  }

  /**
   * Estimate tool schema tokens from tool calls in the session
   */
  private estimateToolSchemas(exported: ExportedSession): ToolSchemaEstimate[] {
    const enabledTools = this.extractEnabledTools(exported)
    const toolCallData = this.extractToolCallData(exported)
    const estimates: ToolSchemaEstimate[] = []

    for (const [toolName, enabled] of Object.entries(enabledTools)) {
      const callData = toolCallData.get(toolName)
      const estimate = this.estimateToolTokens(toolName, callData)

      estimates.push({
        name: toolName,
        enabled,
        estimatedTokens: estimate.tokens,
        argumentCount: estimate.argCount,
        hasComplexArgs: estimate.hasComplex,
      })
    }

    // Sort by estimated tokens descending
    estimates.sort((a, b) => b.estimatedTokens - a.estimatedTokens)

    return estimates
  }

  /**
   * Extract enabled tools from user messages
   */
  private extractEnabledTools(exported: ExportedSession): Record<string, boolean> {
    const tools: Record<string, boolean> = {}

    for (const message of exported.messages) {
      // User messages may contain tools map in info
      if (message.info.tools) {
        for (const [name, enabled] of Object.entries(message.info.tools)) {
          tools[name] = enabled
        }
      }
    }

    // Also collect from tool calls if tools map not available
    if (Object.keys(tools).length === 0) {
      for (const message of exported.messages) {
        for (const part of message.parts) {
          if (part.type === "tool" && part.tool) {
            tools[part.tool] = true
          }
        }
      }
    }

    return tools
  }

  /**
   * Extract tool call argument data for inference
   */
  private extractToolCallData(exported: ExportedSession): Map<string, ToolCallInfo[]> {
    const data = new Map<string, ToolCallInfo[]>()

    for (const message of exported.messages) {
      for (const part of message.parts) {
        if (part.type === "tool" && part.tool && part.state?.input) {
          const toolName = part.tool
          const existing = data.get(toolName) || []
          existing.push({
            argNames: Object.keys(part.state.input),
            argTypes: this.inferArgTypes(part.state.input),
          })
          data.set(toolName, existing)
        }
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
   * Formula from plan:
   * base_tokens = 200  (description + schema overhead)
   * per_simple_arg = 30
   * per_complex_arg = 60  (arrays, objects)
   * description_bonus = 80 (simple) or 120 (complex)
   */
  private estimateToolTokens(
    toolName: string,
    callData?: ToolCallInfo[]
  ): { tokens: number; argCount: number; hasComplex: boolean } {
    const BASE_TOKENS = 200
    const PER_SIMPLE_ARG = 30
    const PER_COMPLEX_ARG = 60
    const SIMPLE_DESCRIPTION_BONUS = 80
    const COMPLEX_DESCRIPTION_BONUS = 120

    // If no call data, use conservative defaults
    if (!callData || callData.length === 0) {
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
  private calculateCacheEfficiency(exported: ExportedSession, pricing: ModelPricing): CacheEfficiency {
    let totalCacheRead = 0
    let totalFreshInput = 0
    let totalCacheWrite = 0

    for (const message of exported.messages) {
      if (message.info.role === "assistant" && message.info.tokens) {
        const tokens = message.info.tokens
        totalCacheRead += Number(tokens.cache?.read) || 0
        totalFreshInput += Number(tokens.input) || 0
        totalCacheWrite += Number(tokens.cache?.write) || 0
      }
    }

    const totalInputTokens = totalCacheRead + totalFreshInput

    // Cache hit rate
    const cacheHitRate = totalInputTokens > 0 ? (totalCacheRead / totalInputTokens) * 100 : 0

    // Cost calculations
    const costWithoutCaching = (totalInputTokens / 1_000_000) * pricing.input
    const costWithCaching =
      (totalFreshInput / 1_000_000) * pricing.input + (totalCacheRead / 1_000_000) * pricing.cacheRead

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
