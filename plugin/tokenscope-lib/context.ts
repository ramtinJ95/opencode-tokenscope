// ContextAnalyzer - analyzes context breakdown from opencode export

import { spawn } from "node:child_process"
import type { Readable } from "node:stream"

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
} from "./types.js"
import { TokenizerManager } from "./tokenizer.js"
import { collectTelemetryCalls, firstCacheWriteTokens, summarizeTelemetry } from "./telemetry.js"
import { WarningCollector, formatErrorMessage } from "./warnings.js"
import { fetchSessionMessages, fetchToolList, unwrapResponseData } from "./opencode.js"

interface ToolListItem {
  id: string
  description?: string
  parameters?: unknown
  jsonSchema?: unknown
}

type ExportCommandRunner = (sessionID: string, directory?: string) => Promise<string>
type ExportSpawnOptions = {
  cwd?: string
  shell: boolean
  stdio: ["ignore", "pipe", "pipe"]
  windowsHide: true
}
type ExportSpawnProcess = {
  stdout: Readable
  stderr: Readable
  on(event: "error", listener: (error: Error) => void): unknown
  on(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown
}
type ExportSpawn = (command: string, args: string[], options: ExportSpawnOptions) => ExportSpawnProcess

export function createExportCommandRunner(
  spawnCommand: ExportSpawn = spawn as unknown as ExportSpawn,
  platform: NodeJS.Platform = process.platform
): ExportCommandRunner {
  return async (sessionID, directory) => new Promise((resolve, reject) => {
    const child = spawnCommand("opencode", ["export", sessionID], {
      cwd: directory,
      shell: platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })

    let stdout = ""
    let stderr = ""

    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")

    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    child.on("error", reject)
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve(stdout)
        return
      }

      const reason = signal ? `signal ${signal}` : `code ${code}`
      const detail = stderr.trim() ? `: ${stderr.trim()}` : ""
      reject(new Error(`opencode export exited with ${reason}${detail}`))
    })
  })
}

export const defaultExportCommandRunner: ExportCommandRunner = createExportCommandRunner()

export class ContextAnalyzer {
  private tokenizerManager: TokenizerManager
  private toolTokenCache = new WeakMap<ToolListItem, number>()

  constructor(
    tokenizerManager: TokenizerManager,
    private warnings?: WarningCollector,
    private client?: any,
    private directory?: string,
    private exportCommandRunner: ExportCommandRunner = defaultExportCommandRunner
  ) {
    this.tokenizerManager = tokenizerManager
  }

  /**
   * Main entry point - analyzes a session using opencode export
   */
  async analyze(
    sessionID: string,
    tokenModel: TokenModel,
    pricing: ModelPricing,
    config: TokenscopeConfig,
    providerID?: string,
    modelID?: string
  ): Promise<ContextAnalysisResult> {
    const result: ContextAnalysisResult = {}

    try {
      const exported = await this.runExport(sessionID)
      if (!exported) return result

      const shouldFetchToolDefinitions = config.enableContextBreakdown || config.enableToolSchemaEstimation
      const cacheWriteModel = this.firstCacheWriteModel(exported)
      const toolProviderID = cacheWriteModel.providerID ?? providerID
      const toolModelID = cacheWriteModel.modelID ?? modelID
      const toolDefinitions = shouldFetchToolDefinitions ? await this.getToolDefinitions(toolProviderID, toolModelID) : []
      if (toolDefinitions.length > 0) {
        await this.precomputeToolDefinitionTokens(toolDefinitions, tokenModel)
      }

      if (config.enableContextBreakdown) {
        result.contextBreakdown = await this.analyzeContextBreakdown(exported, tokenModel, toolDefinitions)
      }

      if (config.enableToolSchemaEstimation) {
        result.toolEstimates = await this.estimateToolSchemas(exported, tokenModel, toolDefinitions)
      }

      if (config.enableCacheEfficiency) {
        result.cacheEfficiency = this.calculateCacheEfficiency(exported, pricing)
      }
    } catch (error) {
      this.warnings?.add(
        `Context analysis was skipped for session ${sessionID}: ${formatErrorMessage(error)}`,
        `context-analysis:${sessionID}`
      )
    }

    return result
  }

  /**
   * Execute opencode export and parse the JSON output
   */
  private async runExport(sessionID: string): Promise<ExportedSession | null> {
    let cliError: unknown

    try {
      const result = await this.exportCommandRunner(sessionID, this.directory)
      return this.parseExportOutput(result)
    } catch (error) {
      cliError = error
    }

    try {
      return await this.runSdkExport(sessionID)
    } catch (error) {
      this.warnings?.add(
        `OpenCode export failed for session ${sessionID}. Context sections were skipped: ${formatErrorMessage(cliError)}; SDK fallback failed: ${formatErrorMessage(error)}`,
        `export-failed:${sessionID}`
      )
      return null
    }
  }

  private parseExportOutput(result: string): ExportedSession {
    if (!result.trim()) {
      throw new Error("OpenCode export returned no data")
    }

    return JSON.parse(result) as ExportedSession
  }

  private async runSdkExport(sessionID: string): Promise<ExportedSession> {
    const response = await fetchSessionMessages(this.client, sessionID, { directory: this.directory })
    const messages = unwrapResponseData<ExportedMessage[]>(response ?? [])

    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error("OpenCode session.messages returned no data")
    }

    return {
      info: { id: sessionID, title: sessionID },
      messages,
    }
  }

  /**
   * Analyze context breakdown from cache_write tokens.
   *
   * Note: OpenCode's `opencode export` command doesn't include generated system
   * prompt content. The first cache_write bucket is therefore used only as an
   * observed allocation budget, not as a complete context-window measurement.
   *
   * If system prompts become available in future versions, we can enhance this
   * to tokenize the actual content for more accurate breakdowns.
   */
  private async analyzeContextBreakdown(
    exported: ExportedSession,
    tokenModel: TokenModel,
    toolDefinitions: ToolListItem[]
  ): Promise<ContextBreakdown> {
    const breakdown: ContextBreakdown = {
      baseSystemPrompt: { tokens: 0, identified: false },
      toolDefinitions: { tokens: 0, identified: false, toolCount: 0 },
      environmentContext: { tokens: 0, identified: false, components: [] },
      projectTree: { tokens: 0, identified: false, fileCount: 0 },
      customInstructions: { tokens: 0, identified: false, sources: [] },
      totalCachedContext: 0,
    }

    // OpenCode currently stores only explicit user-provided system overrides on
    // messages, not the generated env/instructions/skills/tool prompt array.
    // Only tokenize exported system content directly if it looks like generated
    // OpenCode context; otherwise estimate from provider cache_write telemetry.
    const systemPrompts = this.selectGeneratedSystemPrompts(this.extractSystemPrompts(exported))

    // If system prompts are available, analyze them directly
    if (systemPrompts.length > 0) {
      return this.analyzeSystemPromptContent(exported, tokenModel, systemPrompts, breakdown, toolDefinitions)
    }

    // Default: Estimate from cache_write tokens
    return this.estimateContextFromCacheTokens(exported, breakdown, toolDefinitions)
  }

  /**
   * Analyze actual system prompt content (for when opencode export includes it)
   */
  private async analyzeSystemPromptContent(
    exported: ExportedSession,
    tokenModel: TokenModel,
    systemPrompts: string[],
    breakdown: ContextBreakdown,
    toolDefinitions: ToolListItem[]
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

      // Check for project tree with modern <directories> tags
      // (fallback to legacy <files> tags)
      if (promptLower.includes("<directories>") || promptLower.includes("<files>")) {
        const treeMatch = prompt.match(/<directories>[\s\S]*?<\/directories>/i) ?? prompt.match(/<files>[\s\S]*?<\/files>/i)
        if (treeMatch) {
          const filesTokens = await this.tokenizerManager.countTokens(treeMatch[0], tokenModel)
          breakdown.projectTree.tokens += filesTokens
          breakdown.projectTree.identified = true

          breakdown.projectTree.fileCount += this.countProjectTreeEntries(treeMatch[0])
        }
      }

      // Check for custom instructions
      if (promptLower.includes("instructions from:") || promptLower.includes("agents.md")) {
        // Try to extract just the instructions section
        const instructionMatches = prompt.match(
          /Instructions from:[\s\S]*?(?=Instructions from:|<env>|<files>|<directories>|$)/gi
        )
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
        !promptLower.includes("<directories>") &&
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
        !promptLower.includes("<directories>") &&
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

    if (breakdown.toolDefinitions.tokens === 0 && toolDefinitions.length > 0) {
      breakdown.toolDefinitions.tokens = this.sumPrecomputedToolTokens(toolDefinitions)
      breakdown.toolDefinitions.toolCount = toolDefinitions.length
      breakdown.toolDefinitions.identified = false
      breakdown.totalCachedContext += breakdown.toolDefinitions.tokens
    }

    return breakdown
  }

  /**
   * Extract system prompts from exported session
   */
  private extractSystemPrompts(exported: ExportedSession): string[] {
    const prompts: Set<string> = new Set()
    const addPrompt = (value?: string | string[]) => {
      if (Array.isArray(value)) {
        for (const prompt of value) {
          const trimmed = (prompt ?? "").trim()
          if (trimmed) {
            prompts.add(trimmed)
          }
        }
        return
      }

      const trimmed = (value ?? "").trim()
      if (trimmed) {
        prompts.add(trimmed)
      }
    }

    for (const message of exported.messages) {
      if (message.info.role === "user" || message.info.role === "assistant") {
        addPrompt(message.info.system)
      }
    }

    return Array.from(prompts)
  }

  private countProjectTreeEntries(section: string): number {
    return section
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((line) => !/^<\/?(files|directories)>$/i.test(line)).length
  }

  /**
   * Estimate context breakdown from cache token counts when system prompts aren't available.
   *
   * Based on the current OpenCode system prompt structure:
   * - Tool Definitions: ~350 tokens per tool (typically 12-15 tools = ~4,500-5,500)
   * - Environment Context: ~100-200 tokens
   *
   * We use the first cache_write value as an observed allocation budget. It is
   * not a complete measurement of the active context window.
   */
  private estimateContextFromCacheTokens(
    exported: ExportedSession,
    breakdown: ContextBreakdown,
    toolDefinitions: ToolListItem[]
  ): ContextBreakdown {
    // Use the first cache-write bucket as the upper bound for this allocation.
    const totalCachedTokens = firstCacheWriteTokens(exported.messages)
    let enabledToolCount = 0

    // Count enabled tools from tool calls
    const enabledTools = this.extractEnabledTools(exported)
    enabledToolCount = toolDefinitions.length || Object.values(enabledTools).filter(Boolean).length

    if (totalCachedTokens === 0) {
      return breakdown
    }

    const measuredToolTokens = this.sumPrecomputedToolTokens(toolDefinitions)
    // Prefer current OpenCode /experimental/tool metadata when available; fall
    // back to a coarse per-tool estimate when only transcript data is present.
    const estimatedToolTokens = measuredToolTokens || enabledToolCount * 350
    breakdown.toolDefinitions.toolCount = enabledToolCount
    breakdown.toolDefinitions.identified = false // Mark as estimated

    // Estimate environment context (~150 tokens)
    breakdown.environmentContext.components = ["working-dir", "platform", "git-status", "date"]
    breakdown.environmentContext.identified = false

    // Current OpenCode does not inject a project tree into the system prompt.
    // Allocate each estimated component from a fixed budget so the displayed
    // parts can never add up to more than the observed cache-write count.
    let remainingTokens = totalCachedTokens
    breakdown.toolDefinitions.tokens = Math.min(estimatedToolTokens, remainingTokens)
    remainingTokens -= breakdown.toolDefinitions.tokens
    breakdown.environmentContext.tokens = Math.min(150, remainingTokens)
    remainingTokens -= breakdown.environmentContext.tokens
    breakdown.projectTree.tokens = 0
    breakdown.projectTree.identified = false

    // The remainder includes the base prompt, custom instructions, skill/MCP
    // catalogs, and provider framing. It cannot be split from usage telemetry.
    breakdown.baseSystemPrompt.tokens = remainingTokens
    breakdown.baseSystemPrompt.identified = false

    breakdown.totalCachedContext = totalCachedTokens

    return breakdown
  }

  /**
   * Estimate tool schema tokens from tool calls in the session
   */
  private async estimateToolSchemas(
    exported: ExportedSession,
    tokenModel: TokenModel,
    toolDefinitions: ToolListItem[]
  ): Promise<ToolSchemaEstimate[]> {
    if (toolDefinitions.length > 0) {
      const estimates = await Promise.all(
        toolDefinitions.map(async (definition) => {
          const schema = this.toolSchema(definition)
          const estimatedTokens =
            this.toolTokenCache.get(definition) ??
            (await this.tokenizerManager.countTokens(this.formatToolDefinition(definition), tokenModel))
          this.setPrecomputedToolTokens(definition, estimatedTokens)

          return {
            name: definition.id,
            enabled: true,
            estimatedTokens,
            argumentCount: this.countSchemaArguments(schema),
            hasComplexArgs: this.hasComplexSchemaArguments(schema),
            source: "opencode-api" as const,
          }
        })
      )

      estimates.sort((a, b) => b.estimatedTokens - a.estimatedTokens)
      return estimates
    }

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
        source: "transcript",
      })
    }

    // Sort by estimated tokens descending
    estimates.sort((a, b) => b.estimatedTokens - a.estimatedTokens)

    return estimates
  }

  private async getToolDefinitions(providerID?: string, modelID?: string): Promise<ToolListItem[]> {
    if (!this.client || !providerID || !modelID) {
      return []
    }

    try {
      const response = await fetchToolList(this.client, providerID, modelID, { directory: this.directory })
      const tools = unwrapResponseData<ToolListItem[]>(response ?? [])
      return Array.isArray(tools) ? tools.filter((tool) => typeof tool?.id === "string") : []
    } catch (error) {
      this.warnings?.add(
        `Could not fetch tool definitions for ${providerID}/${modelID}. Tool schema sizes use transcript-based estimates: ${formatErrorMessage(error)}`,
        `context-tool-list:${providerID}:${modelID}`
      )
      return []
    }
  }

  private selectGeneratedSystemPrompts(prompts: string[]): string[] {
    const strongPrompts = prompts.filter((prompt) => this.isStrongGeneratedSystemContext(prompt))
    const hasBasePrompt = prompts.some((prompt) => this.isBaseGeneratedSystemPrompt(prompt))

    if (strongPrompts.length === 0 || (strongPrompts.length === 1 && !hasBasePrompt)) {
      return []
    }

    return prompts.filter(
      (prompt) =>
        this.isStrongGeneratedSystemContext(prompt) || this.isBaseGeneratedSystemPrompt(prompt) || this.isInstructionPrompt(prompt)
    )
  }

  private isStrongGeneratedSystemContext(prompt: string): boolean {
    const lower = prompt.toLowerCase()
    return (
      /<env>[\s\S]*?<\/env>/i.test(prompt) ||
      /<available_skills>[\s\S]*?<\/available_skills>/i.test(prompt) ||
      /<functions>[\s\S]*?<\/functions>/i.test(prompt) ||
      (/^instructions from:\s*.+/im.test(prompt) &&
        (lower.includes("agents.md") ||
          lower.includes("claude.md") ||
          lower.includes("context.md") ||
          lower.includes("opencode"))) ||
      lower.includes("available agent types and the tools they have access to") ||
      lower.includes("skills provide specialized instructions and workflows")
    )
  }

  private isBaseGeneratedSystemPrompt(prompt: string): boolean {
    const lower = prompt.toLowerCase()
    return (
      lower.includes("you are opencode") ||
      (prompt.length > 500 && lower.includes("assistant") && lower.includes("software engineering"))
    )
  }

  private isInstructionPrompt(prompt: string): boolean {
    return /^instructions from:\s*.+/im.test(prompt)
  }

  private toolSchema(tool: ToolListItem): unknown {
    return tool.jsonSchema ?? tool.parameters
  }

  private formatToolDefinition(tool: ToolListItem): string {
    const schema = this.toolSchema(tool)
    return [
      `<tool name="${tool.id}">`,
      tool.description ? `<description>\n${tool.description}\n</description>` : undefined,
      schema ? `<schema>\n${JSON.stringify(schema, null, 2)}\n</schema>` : undefined,
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

  private sumPrecomputedToolTokens(tools: ToolListItem[]): number {
    return tools.reduce((sum, tool) => sum + (this.toolTokenCache.get(tool) ?? 0), 0)
  }

  private setPrecomputedToolTokens(tool: ToolListItem, tokens: number): void {
    this.toolTokenCache.set(tool, tokens)
  }

  private async precomputeToolDefinitionTokens(tools: ToolListItem[], tokenModel: TokenModel): Promise<void> {
    await Promise.all(
      tools.map(async (tool) => {
        if (this.toolTokenCache.has(tool)) {
          return
        }

        this.setPrecomputedToolTokens(tool, await this.tokenizerManager.countTokens(this.formatToolDefinition(tool), tokenModel))
      })
    )
  }

  private extractTranscriptTools(exported: ExportedSession): Record<string, boolean> {
    const tools: Record<string, boolean> = {}

    for (const message of exported.messages) {
      for (const part of message.parts) {
        if (part.type === "tool" && part.tool) {
          tools[part.tool] = true
        }
      }
    }

    if (Object.keys(tools).length === 0) {
      for (const message of exported.messages) {
        if (!message.info.tools) continue
        for (const [name, enabled] of Object.entries(message.info.tools)) {
          if (enabled) tools[name] = true
        }
      }
    }

    return tools
  }

  private firstCacheWriteModel(exported: ExportedSession): { providerID?: string; modelID?: string } {
    const call = collectTelemetryCalls(exported.messages).find((item) => item.cacheWriteTokens > 0)
    return { providerID: call?.providerID, modelID: call?.modelID }
  }

  /**
   * Extract enabled tools from user messages
   */
  private extractEnabledTools(exported: ExportedSession): Record<string, boolean> {
    return this.extractTranscriptTools(exported)
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
    const telemetry = summarizeTelemetry(exported.messages)
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
