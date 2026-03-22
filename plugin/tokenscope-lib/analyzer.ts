// Analysis classes - ModelResolver, ContentCollector, TokenAnalysisEngine

import type {
  SessionMessage,
  SessionMessagePart,
  TokenModel,
  TokenAnalysis,
  CategoryEntrySource,
  CategoryEntry,
  CategorySummary,
  isToolPart,
  isReasoningPart,
  isTextPart,
} from "./types"
import { isToolPart as toolGuard, isReasoningPart as reasoningGuard, isTextPart as textGuard } from "./types"
import { OPENAI_MODEL_MAP, TRANSFORMERS_MODEL_MAP, PROVIDER_DEFAULTS } from "./config"
import { TokenizerManager } from "./tokenizer"

// Model Resolution

export interface ModelAndProvider {
  model: TokenModel
  providerID: string
  modelID: string
}

export class ModelResolver {
  resolveModelAndProvider(messages: SessionMessage[]): ModelAndProvider {
    let detectedProviderID = "anthropic"
    let detectedModelID = "claude-sonnet-4-20250514"

    for (const message of [...messages].reverse()) {
      if (message.info.providerID) {
        detectedProviderID = this.canonicalize(message.info.providerID) || detectedProviderID
      }
      if (message.info.modelID) {
        detectedModelID = message.info.modelID
      }
      if (message.info.providerID && message.info.modelID) {
        break
      }
    }

    const model = this.resolveTokenModel(messages)

    return {
      model,
      providerID: detectedProviderID,
      modelID: detectedModelID,
    }
  }

  resolveTokenModel(messages: SessionMessage[]): TokenModel {
    for (const message of [...messages].reverse()) {
      const modelID = this.canonicalize(message.info.modelID)
      const providerID = this.canonicalize(message.info.providerID)

      const openaiModel = this.resolveOpenAIModel(modelID, providerID)
      if (openaiModel) return openaiModel

      const transformerModel = this.resolveTransformersModel(modelID, providerID)
      if (transformerModel) return transformerModel
    }

    return { name: "approx", spec: { kind: "approx" } }
  }

  private resolveOpenAIModel(modelID?: string, providerID?: string): TokenModel | undefined {
    if (providerID === "openai" || providerID === "opencode" || providerID === "azure") {
      const mapped = this.mapOpenAI(modelID)
      return { name: modelID ?? mapped, spec: { kind: "tiktoken", model: mapped } }
    }

    if (modelID && OPENAI_MODEL_MAP[modelID]) {
      return { name: modelID, spec: { kind: "tiktoken", model: OPENAI_MODEL_MAP[modelID] } }
    }

    return undefined
  }

  private resolveTransformersModel(modelID?: string, providerID?: string): TokenModel | undefined {
    if (modelID && TRANSFORMERS_MODEL_MAP[modelID]) {
      return { name: modelID, spec: { kind: "transformers", hub: TRANSFORMERS_MODEL_MAP[modelID] } }
    }

    if (providerID && PROVIDER_DEFAULTS[providerID]) {
      return { name: modelID ?? providerID, spec: PROVIDER_DEFAULTS[providerID] }
    }

    // Prefix-based fallbacks
    if (modelID?.startsWith("claude")) {
      return { name: modelID, spec: { kind: "transformers", hub: "Xenova/claude-tokenizer" } }
    }

    if (modelID?.startsWith("llama")) {
      return {
        name: modelID,
        spec: { kind: "transformers", hub: TRANSFORMERS_MODEL_MAP[modelID] ?? "Xenova/Meta-Llama-3.1-Tokenizer" },
      }
    }

    if (modelID?.startsWith("mistral")) {
      return { name: modelID, spec: { kind: "transformers", hub: "Xenova/mistral-tokenizer-v3" } }
    }

    if (modelID?.startsWith("deepseek")) {
      return { name: modelID, spec: { kind: "transformers", hub: "deepseek-ai/DeepSeek-V3" } }
    }

    return undefined
  }

  private mapOpenAI(modelID?: string): string {
    if (!modelID) return "cl100k_base"
    return OPENAI_MODEL_MAP[modelID] ?? modelID
  }

  private canonicalize(value?: string): string | undefined {
    return value?.split("/").pop()?.toLowerCase().trim()
  }
}

// Content Collection

export class ContentCollector {
  collectSystemPrompts(messages: SessionMessage[]): CategoryEntrySource[] {
    const prompts = new Map<string, string>()
    const addPrompt = (value?: string | string[]) => {
      if (Array.isArray(value)) {
        for (const item of value) {
          const trimmed = (item ?? "").trim()
          if (trimmed) prompts.set(trimmed, trimmed)
        }
        return
      }

      const trimmed = (value ?? "").trim()
      if (trimmed) prompts.set(trimmed, trimmed)
    }

    for (const message of messages) {
      // Current upstream model stores optional system override on user messages.
      // Keep broader compatibility by accepting either string or string[].
      if (message.info.role === "user" || message.info.role === "assistant") {
        addPrompt(message.info.system)
      }

      // Backward compatibility for older exports that had explicit system role content.
      if (message.info.role === "system") {
        const content = this.extractText(message.parts)
        if (content) prompts.set(content, content)
      }
    }

    return Array.from(prompts.values()).map((content, index) => ({
      label: this.identifySystemPrompt(content, index + 1),
      content,
    }))
  }

  collectMessageTexts(messages: SessionMessage[], role: "user" | "assistant"): CategoryEntrySource[] {
    const results: CategoryEntrySource[] = []
    let index = 0

    for (const message of messages) {
      if (message.info.role !== role) continue
      const content = this.extractText(message.parts)
      if (!content) continue

      index += 1
      results.push({ label: `${this.capitalize(role)}#${index}`, content })
    }

    return results
  }

  collectToolOutputs(messages: SessionMessage[]): CategoryEntrySource[] {
    const toolOutputs = new Map<string, string>()
    const compactedPlaceholder = "[Old tool result content cleared]"

    for (const message of messages) {
      for (const part of message.parts) {
        if (!toolGuard(part)) continue

        if (part.state.status !== "completed") continue

        const rawOutput = part.state.time?.compacted ? compactedPlaceholder : part.state.output
        const output = (rawOutput ?? "").toString().trim()
        if (!output) continue

        const toolName = part.tool || "tool"
        const existing = toolOutputs.get(toolName) || ""
        toolOutputs.set(toolName, existing + (existing ? "\n\n" : "") + output)
      }
    }

    return Array.from(toolOutputs.entries()).map(([toolName, content]) => ({
      label: toolName,
      content,
    }))
  }

  collectToolCallCounts(messages: SessionMessage[]): Map<string, number> {
    const toolCounts = new Map<string, number>()

    for (const message of messages) {
      for (const part of message.parts) {
        if (!toolGuard(part)) continue

        const toolName = part.tool || "tool"
        if (toolName) {
          toolCounts.set(toolName, (toolCounts.get(toolName) || 0) + 1)
        }
      }
    }

    return toolCounts
  }

  collectAllToolsCalled(messages: SessionMessage[]): string[] {
    return Array.from(this.collectToolCallCounts(messages).keys()).sort()
  }

  collectReasoningTexts(messages: SessionMessage[]): CategoryEntrySource[] {
    const results: CategoryEntrySource[] = []
    let index = 0

    for (const message of messages) {
      for (const part of message.parts) {
        if (!reasoningGuard(part)) continue

        const text = (part.text ?? "").toString().trim()
        if (!text) continue

        index += 1
        results.push({ label: `Reasoning#${index}`, content: text })
      }
    }

    return results
  }

  private extractText(parts: SessionMessagePart[]): string {
    return parts
      .filter(textGuard)
      .map((part) => part.text ?? "")
      .map((text) => text.trim())
      .filter(Boolean)
      .join("\n\n")
  }

  private identifySystemPrompt(content: string, index: number): string {
    const lower = content.toLowerCase()

    if (lower.includes("opencode") && lower.includes("cli") && content.length > 500) return "System#MainPrompt"
    if (lower.includes("opencode") && lower.includes("cli") && content.length <= 500) return "System#ShortPrompt"
    if (lower.includes("agent") && lower.includes("mode")) return "System#AgentMode"
    if (lower.includes("permission") || lower.includes("allowed") || lower.includes("deny")) return "System#Permissions"
    if (lower.includes("tool") && (lower.includes("rule") || lower.includes("guideline"))) return "System#ToolRules"
    if (lower.includes("format") || lower.includes("style") || lower.includes("concise")) return "System#Formatting"
    if (lower.includes("project") || lower.includes("repository") || lower.includes("codebase"))
      return "System#ProjectContext"
    if (lower.includes("session") || lower.includes("context") || lower.includes("memory")) return "System#SessionMgmt"
    if (content.includes("@") && (content.includes(".md") || content.includes(".txt"))) return "System#FileRefs"
    if (content.includes("name:") && content.includes("description:")) return "System#AgentDef"
    if (lower.includes("code") && (lower.includes("convention") || lower.includes("standard")))
      return "System#CodeGuidelines"

    return `System#${index}`
  }

  private capitalize(value: string): string {
    if (!value) return value
    return value[0].toUpperCase() + value.slice(1)
  }
}

// Token Analysis Engine

export class TokenAnalysisEngine {
  constructor(
    private tokenizerManager: TokenizerManager,
    private contentCollector: ContentCollector
  ) {}

  async analyze(
    sessionID: string,
    messages: SessionMessage[],
    tokenModel: TokenModel,
    entryLimit: number
  ): Promise<TokenAnalysis> {
    const systemPrompts = this.contentCollector.collectSystemPrompts(messages)
    const userTexts = this.contentCollector.collectMessageTexts(messages, "user")
    const assistantTexts = this.contentCollector.collectMessageTexts(messages, "assistant")
    const toolOutputs = this.contentCollector.collectToolOutputs(messages)
    const reasoningTraces = this.contentCollector.collectReasoningTexts(messages)
    const allToolsCalled = this.contentCollector.collectAllToolsCalled(messages)
    const toolCallCounts = this.contentCollector.collectToolCallCounts(messages)

    const [system, user, assistant, tools, reasoning] = await Promise.all([
      this.buildCategory("system", systemPrompts, tokenModel, entryLimit),
      this.buildCategory("user", userTexts, tokenModel, entryLimit),
      this.buildCategory("assistant", assistantTexts, tokenModel, entryLimit),
      this.buildCategory("tools", toolOutputs, tokenModel, entryLimit),
      this.buildCategory("reasoning", reasoningTraces, tokenModel, entryLimit),
    ])

    const analysis: TokenAnalysis = {
      sessionID,
      model: tokenModel,
      categories: { system, user, assistant, tools, reasoning },
      totalTokens:
        system.totalTokens + user.totalTokens + assistant.totalTokens + tools.totalTokens + reasoning.totalTokens,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      assistantMessageCount: 0,
      apiCallCount: 0,
      mostRecentInput: 0,
      mostRecentOutput: 0,
      mostRecentReasoning: 0,
      mostRecentCacheRead: 0,
      mostRecentCacheWrite: 0,
      sessionCost: 0,
      mostRecentCost: 0,
      allToolsCalled,
      toolCallCounts,
      warnings: [],
    }

    this.applyTelemetryAdjustments(analysis, messages)

    return analysis
  }

  private async buildCategory(
    label: string,
    sources: CategoryEntrySource[],
    model: TokenModel,
    entryLimit: number
  ): Promise<CategorySummary> {
    const entries: CategoryEntry[] = []

    for (const source of sources) {
      const tokens = await this.tokenizerManager.countTokens(source.content, model)
      if (tokens > 0) {
        entries.push({ label: source.label, tokens })
      }
    }

    entries.sort((a, b) => b.tokens - a.tokens)
    const limited = entries.slice(0, entryLimit)
    const totalTokens = entries.reduce((sum, entry) => sum + entry.tokens, 0)

    return { label, totalTokens, entries: limited, allEntries: entries }
  }

  private applyTelemetryAdjustments(analysis: TokenAnalysis, messages: SessionMessage[]) {
    const assistantMessages = messages.filter((message) => message.info.role === "assistant")
    const assistants = assistantMessages.map((msg) => ({ msg, tokens: msg.info.tokens, cost: msg.info.cost ?? 0 }))

    const stepFinishCount = messages.reduce((count, message) => {
      return count + message.parts.filter((part) => part.type === "step-finish").length
    }, 0)

    const hasApiTelemetry = (message: SessionMessage) => {
      const tokens = message.info.tokens
      const tokenTotal =
        (Number(tokens?.input) || 0) +
        (Number(tokens?.output) || 0) +
        (Number(tokens?.reasoning) || 0) +
        (Number(tokens?.cache?.read) || 0) +
        (Number(tokens?.cache?.write) || 0)
      return tokenTotal > 0 || (Number(message.info.cost) || 0) > 0
    }

    const telemetryApiCalls = assistantMessages.filter(hasApiTelemetry).length
    const apiCallCount = stepFinishCount > 0 ? stepFinishCount : telemetryApiCalls

    let totalInput = 0,
      totalOutput = 0,
      totalReasoning = 0
    let totalCacheRead = 0,
      totalCacheWrite = 0,
      totalCost = 0

    for (const { tokens, cost } of assistants) {
      if (tokens) {
        totalInput += Number(tokens.input) || 0
        totalOutput += Number(tokens.output) || 0
        totalReasoning += Number(tokens.reasoning) || 0
        totalCacheRead += Number(tokens.cache?.read) || 0
        totalCacheWrite += Number(tokens.cache?.write) || 0
      }
      totalCost += Number(cost) || 0
    }

    const mostRecentWithUsage = [...assistants]
      .reverse()
      .find(
        ({ tokens }) =>
          tokens &&
          (Number(tokens.input) || 0) +
            (Number(tokens.output) || 0) +
            (Number(tokens.reasoning) || 0) +
            (Number(tokens.cache?.read) || 0) +
            (Number(tokens.cache?.write) || 0) >
            0
      ) ?? assistants[assistants.length - 1]

    let mostRecentInput = 0,
      mostRecentOutput = 0,
      mostRecentReasoning = 0
    let mostRecentCacheRead = 0,
      mostRecentCacheWrite = 0,
      mostRecentCost = 0

    if (mostRecentWithUsage) {
      const t = mostRecentWithUsage.tokens
      if (t) {
        mostRecentInput = Number(t.input) || 0
        mostRecentOutput = Number(t.output) || 0
        mostRecentReasoning = Number(t.reasoning) || 0
        mostRecentCacheRead = Number(t.cache?.read) || 0
        mostRecentCacheWrite = Number(t.cache?.write) || 0
      }
      mostRecentCost = Number(mostRecentWithUsage.cost) || 0
    }

    analysis.inputTokens = totalInput
    analysis.outputTokens = totalOutput
    analysis.reasoningTokens = totalReasoning
    analysis.cacheReadTokens = totalCacheRead
    analysis.cacheWriteTokens = totalCacheWrite
    analysis.assistantMessageCount = assistantMessages.length
    analysis.apiCallCount = apiCallCount
    analysis.sessionCost = totalCost
    analysis.mostRecentCost = mostRecentCost
    analysis.mostRecentInput = mostRecentInput
    analysis.mostRecentOutput = mostRecentOutput
    analysis.mostRecentReasoning = mostRecentReasoning
    analysis.mostRecentCacheRead = mostRecentCacheRead
    analysis.mostRecentCacheWrite = mostRecentCacheWrite

    const recentApiInputTotal = mostRecentInput + mostRecentCacheRead
    const localUserAndTools = analysis.categories.user.totalTokens + analysis.categories.tools.totalTokens
    const inferredPromptOverheadTokens = Math.max(0, recentApiInputTotal - localUserAndTools)
    const hasExplicitSystem = analysis.categories.system.totalTokens > 0
    const strongInferenceSignal =
      inferredPromptOverheadTokens >= 300 &&
      inferredPromptOverheadTokens >= recentApiInputTotal * 0.15 &&
      inferredPromptOverheadTokens >= localUserAndTools * 0.1

    if (inferredPromptOverheadTokens >= 50 && !hasExplicitSystem) {
      const inferredLabel = strongInferenceSignal
        ? "System (inferred from API telemetry)"
        : "Unattributed prompt overhead (inferred)"

      analysis.categories.system.totalTokens = inferredPromptOverheadTokens
      analysis.categories.system.entries = [{ label: inferredLabel, tokens: inferredPromptOverheadTokens }]
      analysis.categories.system.allEntries = analysis.categories.system.entries
    }

    analysis.totalTokens =
      analysis.categories.system.totalTokens +
      analysis.categories.user.totalTokens +
      analysis.categories.assistant.totalTokens +
      analysis.categories.tools.totalTokens +
      analysis.categories.reasoning.totalTokens
  }
}
