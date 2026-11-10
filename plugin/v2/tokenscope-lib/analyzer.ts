// Analysis classes - ModelResolver, ContentCollector, TokenAnalysisEngine

import type {
  RequestSnapshot,
  SessionMessage,
  SessionMessagePart,
  TokenModel,
  TokenAnalysis,
  CategoryEntrySource,
  CategoryEntry,
  CategorySummary,
} from "./types.js"
import { OPENAI_MODEL_MAP, HUGGINGFACE_TOKENIZER_MODEL_MAP, PROVIDER_DEFAULTS } from "./config.js"
import { TokenizerManager } from "./tokenizer.js"
import { summarizeTelemetry } from "./telemetry.js"

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
      const providerID = this.getProviderID(message)
      const modelID = this.getModelID(message)

      if (providerID) {
        detectedProviderID = this.canonicalize(providerID) || detectedProviderID
      }
      if (modelID) {
        detectedModelID = modelID
      }
      if (providerID && modelID) {
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
    let fallbackModelName: string | undefined
    for (const message of [...messages].reverse()) {
      const modelID = this.canonicalize(this.getModelID(message))
      const providerID = this.canonicalize(this.getProviderID(message))
      fallbackModelName ??= modelID

      const openaiModel = this.resolveOpenAIModel(modelID, providerID)
      if (openaiModel) return openaiModel

      const huggingFaceTokenizerModel = this.resolveHuggingFaceTokenizerModel(modelID, providerID)
      if (huggingFaceTokenizerModel) return huggingFaceTokenizerModel
    }

    return { name: fallbackModelName ?? "unknown", spec: { kind: "approx" } }
  }

  private resolveOpenAIModel(modelID?: string, providerID?: string): TokenModel | undefined {
    const isOpenAIModel =
      !!modelID &&
      (!!OPENAI_MODEL_MAP[modelID] || modelID.startsWith("gpt-") || modelID.startsWith("chatgpt-") || /^o\d(?:-|$)/.test(modelID))

    if (providerID === "openai" || providerID === "azure" || isOpenAIModel) {
      const mapped = this.mapOpenAI(modelID)
      return { name: modelID ?? mapped, spec: { kind: "tiktoken", model: mapped } }
    }

    if (modelID && OPENAI_MODEL_MAP[modelID]) {
      return { name: modelID, spec: { kind: "tiktoken", model: OPENAI_MODEL_MAP[modelID] } }
    }

    return undefined
  }

  private resolveHuggingFaceTokenizerModel(modelID?: string, providerID?: string): TokenModel | undefined {
    if (modelID && HUGGINGFACE_TOKENIZER_MODEL_MAP[modelID]) {
      return { name: modelID, spec: { kind: "huggingface", hub: HUGGINGFACE_TOKENIZER_MODEL_MAP[modelID] } }
    }

    if (providerID && PROVIDER_DEFAULTS[providerID]) {
      return { name: modelID ?? providerID, spec: PROVIDER_DEFAULTS[providerID] }
    }

    if (modelID?.startsWith("claude")) {
      return { name: modelID, spec: { kind: "huggingface", hub: "Xenova/claude-tokenizer" } }
    }

    if (modelID?.startsWith("llama")) {
      return {
        name: modelID,
        spec: {
          kind: "huggingface",
          hub: HUGGINGFACE_TOKENIZER_MODEL_MAP[modelID] ?? "Xenova/Meta-Llama-3.1-Tokenizer",
        },
      }
    }

    if (modelID?.startsWith("mistral")) {
      return { name: modelID, spec: { kind: "huggingface", hub: "Xenova/mistral-tokenizer-v3" } }
    }

    if (modelID?.startsWith("deepseek")) {
      return { name: modelID, spec: { kind: "huggingface", hub: "deepseek-ai/DeepSeek-V3" } }
    }

    return undefined
  }

  private mapOpenAI(modelID?: string): string {
    if (!modelID) return "cl100k_base"
    if (OPENAI_MODEL_MAP[modelID]) return OPENAI_MODEL_MAP[modelID]
    if (modelID.startsWith("gpt-") || modelID.startsWith("chatgpt-") || /^o\d(?:-|$)/.test(modelID)) return "gpt-4o"
    return modelID
  }

  private getProviderID(message: SessionMessage): string | undefined {
    return message.info.model?.providerID
  }

  private getModelID(message: SessionMessage): string | undefined {
    return message.info.model?.modelID
  }

  private canonicalize(value?: string): string | undefined {
    return value?.split("/").pop()?.toLowerCase().trim()
  }
}

// Content Collection

export class ContentCollector {
  // The system prompt is not part of the transcript. When the last model request was captured,
  // its system parts are counted directly; mid-session system updates come from the transcript.
  collectSystemPrompts(messages: SessionMessage[], snapshot?: RequestSnapshot): CategoryEntrySource[] {
    const sources: CategoryEntrySource[] = []

    let promptIndex = 0
    for (const part of snapshot?.system ?? []) {
      if (part.instructions) {
        for (const instruction of part.instructions) {
          if (instruction.text.trim()) sources.push({ label: `System#${instruction.key}`, content: instruction.text })
        }
        continue
      }

      if (!part.text.trim()) continue
      // OpenCode can send the base prompt as several parts; number them so entries stay distinct.
      promptIndex += 1
      sources.push({ label: `System#prompt${promptIndex}`, content: part.text })
    }

    let updateIndex = 0
    for (const message of messages) {
      if (message.info.role !== "system") continue
      const content = this.extractText(message.parts)
      if (!content) continue

      updateIndex += 1
      sources.push({ label: `System#update${updateIndex}`, content })
    }

    return sources
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

    for (const message of messages) {
      for (const part of message.parts) {
        if (part.type !== "tool") continue

        // Completed and failed calls both leave a result in the model's context.
        if (part.state.status !== "completed" && part.state.status !== "error") continue

        const output = (part.state.output ?? "").trim()
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
        if (part.type !== "tool") continue

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
        if (part.type !== "reasoning") continue

        const text = part.text.trim()
        if (!text) continue

        index += 1
        results.push({ label: `Reasoning#${index}`, content: text })
      }
    }

    return results
  }

  private extractText(parts: SessionMessagePart[]): string {
    return parts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .map((text) => text.trim())
      .filter(Boolean)
      .join("\n\n")
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
    entryLimit: number,
    snapshot?: RequestSnapshot
  ): Promise<TokenAnalysis> {
    const systemPrompts = this.contentCollector.collectSystemPrompts(messages, snapshot)
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
      callsWithCacheRead: 0,
      callsWithCacheWrite: 0,
      mostRecentInput: 0,
      mostRecentOutput: 0,
      mostRecentReasoning: 0,
      mostRecentCacheRead: 0,
      mostRecentCacheWrite: 0,
      sessionCost: 0,
      mostRecentCost: 0,
      allToolsCalled,
      toolCallCounts,
      perModelUsage: [],
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
    const telemetry = summarizeTelemetry(messages)

    analysis.inputTokens = telemetry.inputTokens
    analysis.outputTokens = telemetry.outputTokens
    analysis.reasoningTokens = telemetry.reasoningTokens
    analysis.cacheReadTokens = telemetry.cacheReadTokens
    analysis.cacheWriteTokens = telemetry.cacheWriteTokens
    analysis.assistantMessageCount = telemetry.assistantMessageCount
    analysis.apiCallCount = telemetry.apiCallCount
    analysis.callsWithCacheRead = telemetry.callsWithCacheRead
    analysis.callsWithCacheWrite = telemetry.callsWithCacheWrite
    analysis.sessionCost = telemetry.sessionCost
    analysis.mostRecentCost = telemetry.mostRecentCost
    analysis.mostRecentInput = telemetry.mostRecentInput
    analysis.mostRecentOutput = telemetry.mostRecentOutput
    analysis.mostRecentReasoning = telemetry.mostRecentReasoning
    analysis.mostRecentCacheRead = telemetry.mostRecentCacheRead
    analysis.mostRecentCacheWrite = telemetry.mostRecentCacheWrite
    analysis.perModelUsage = telemetry.perModelUsage

    analysis.totalTokens =
      analysis.categories.system.totalTokens +
      analysis.categories.user.totalTokens +
      analysis.categories.assistant.totalTokens +
      analysis.categories.tools.totalTokens +
      analysis.categories.reasoning.totalTokens
  }
}
