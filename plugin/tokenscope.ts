import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import path from "path"
import fs from "fs/promises"
import { fileURLToPath, pathToFileURL } from "url"

const DEFAULT_ENTRY_LIMIT = 3
const VENDOR_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "vendor", "node_modules")

// Types

interface SessionMessage {
  info: SessionMessageInfo
  parts: SessionMessagePart[]
}

interface SessionMessageInfo {
  id: string
  role: string
  modelID?: string
  providerID?: string
  system?: string[]
  tokens?: TokenUsage
  cost?: number
}

interface TokenUsage {
  input?: number
  output?: number
  reasoning?: number
  cache?: {
    read?: number
    write?: number
  }
}

type SessionMessagePart =
  | { type: "text"; text: string; synthetic?: boolean }
  | { type: "reasoning"; text: string }
  | { type: "tool"; tool: string; state: ToolState }
  | { type: string; [key: string]: unknown }

function isToolPart(part: SessionMessagePart): part is { type: "tool"; tool: string; state: ToolState } {
  return part.type === "tool"
}

function isReasoningPart(part: SessionMessagePart): part is { type: "reasoning"; text: string } {
  return part.type === "reasoning"
}

function isTextPart(part: SessionMessagePart): part is { type: "text"; text: string; synthetic?: boolean } {
  return part.type === "text"
}

interface ToolState {
  status: "pending" | "running" | "completed" | "error"
  output?: string
}

interface CategoryEntry {
  label: string
  tokens: number
}

interface CategorySummary {
  label: string
  totalTokens: number
  entries: CategoryEntry[]
  allEntries: CategoryEntry[]
}

interface TokenAnalysis {
  sessionID: string
  model: TokenModel
  categories: {
    system: CategorySummary
    user: CategorySummary
    assistant: CategorySummary
    tools: CategorySummary
    reasoning: CategorySummary
  }
  totalTokens: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  assistantMessageCount: number
  mostRecentInput: number
  mostRecentOutput: number
  mostRecentReasoning: number
  mostRecentCacheRead: number
  mostRecentCacheWrite: number
  sessionCost: number
  mostRecentCost: number
  allToolsCalled: string[]
  toolCallCounts: Map<string, number>
  subagentAnalysis?: SubagentAnalysis
}

interface TokenModel {
  name: string
  spec: TokenizerSpec
}

type TokenizerSpec = 
  | { kind: "tiktoken"; model: string }
  | { kind: "transformers"; hub: string }
  | { kind: "approx" }

interface CategoryEntrySource {
  label: string
  content: string
}

interface CostEstimate {
  isSubscription: boolean
  apiSessionCost: number
  apiMostRecentCost: number
  estimatedSessionCost: number
  estimatedInputCost: number
  estimatedOutputCost: number
  estimatedCacheReadCost: number
  estimatedCacheWriteCost: number
  pricePerMillionInput: number
  pricePerMillionOutput: number
  pricePerMillionCacheRead: number
  pricePerMillionCacheWrite: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

interface SubagentSummary {
  sessionID: string
  title: string
  agentType: string
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  apiCost: number
  estimatedCost: number
  assistantMessageCount: number
}

interface SubagentAnalysis {
  subagents: SubagentSummary[]
  totalInputTokens: number
  totalOutputTokens: number
  totalReasoningTokens: number
  totalCacheReadTokens: number
  totalCacheWriteTokens: number
  totalTokens: number
  totalApiCost: number
  totalEstimatedCost: number
  totalApiCalls: number
}

interface ModelPricing {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
}

interface ChildSession {
  id: string
  title: string
  parentID?: string
}

// Model Configuration

let PRICING_CACHE: Record<string, ModelPricing> | null = null

async function loadModelPricing(): Promise<Record<string, ModelPricing>> {
  if (PRICING_CACHE) return PRICING_CACHE

  try {
    const modelsPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'models.json')
    const data = await fs.readFile(modelsPath, 'utf8')
    PRICING_CACHE = JSON.parse(data)
    return PRICING_CACHE!
  } catch {
    PRICING_CACHE = { "default": { input: 1, output: 3, cacheWrite: 0, cacheRead: 0 } }
    return PRICING_CACHE
  }
}

const OPENAI_MODEL_MAP: Record<string, string> = {
  "gpt-5": "gpt-4o",
  "o4-mini": "gpt-4o",
  "o3": "gpt-4o",
  "o3-mini": "gpt-4o",
  "o1": "gpt-4o",
  "o1-pro": "gpt-4o",
  "gpt-4.1": "gpt-4o",
  "gpt-4.1-mini": "gpt-4o",
  "gpt-4o": "gpt-4o",
  "gpt-4o-mini": "gpt-4o-mini",
  "gpt-4-turbo": "gpt-4",
  "gpt-4": "gpt-4",
  "gpt-3.5-turbo": "gpt-3.5-turbo",
  "text-embedding-3-large": "text-embedding-3-large",
  "text-embedding-3-small": "text-embedding-3-small",
  "text-embedding-ada-002": "text-embedding-ada-002",
}

const TRANSFORMERS_MODEL_MAP: Record<string, string> = {
  "claude-opus-4": "Xenova/claude-tokenizer",
  "claude-sonnet-4": "Xenova/claude-tokenizer",
  "claude-3.7-sonnet": "Xenova/claude-tokenizer",
  "claude-3.5-sonnet": "Xenova/claude-tokenizer",
  "claude-3.5-haiku": "Xenova/claude-tokenizer",
  "claude-3-opus": "Xenova/claude-tokenizer",
  "claude-3-sonnet": "Xenova/claude-tokenizer",
  "claude-3-haiku": "Xenova/claude-tokenizer",
  "claude-2.1": "Xenova/claude-tokenizer",
  "claude-2.0": "Xenova/claude-tokenizer",
  "claude-instant-1.2": "Xenova/claude-tokenizer",
  "llama-4": "Xenova/llama4-tokenizer",
  "llama-3.3": "unsloth/Llama-3.3-70B-Instruct",
  "llama-3.2": "Xenova/Llama-3.2-Tokenizer",
  "llama-3.1": "Xenova/Meta-Llama-3.1-Tokenizer",
  "llama-3": "Xenova/llama3-tokenizer-new",
  "llama-2": "Xenova/llama2-tokenizer",
  "code-llama": "Xenova/llama-code-tokenizer",
  "deepseek-r1": "deepseek-ai/DeepSeek-R1",
  "deepseek-v3": "deepseek-ai/DeepSeek-V3",
  "deepseek-v2": "deepseek-ai/DeepSeek-V2",
  "mistral-large": "Xenova/mistral-tokenizer-v3",
  "mistral-small": "Xenova/mistral-tokenizer-v3",
  "mistral-nemo": "Xenova/Mistral-Nemo-Instruct-Tokenizer",
  "devstral-small": "Xenova/Mistral-Nemo-Instruct-Tokenizer",
  "codestral": "Xenova/mistral-tokenizer-v3",
}

const PROVIDER_DEFAULTS: Record<string, TokenizerSpec> = {
  anthropic: { kind: "transformers", hub: "Xenova/claude-tokenizer" },
  meta: { kind: "transformers", hub: "Xenova/Meta-Llama-3.1-Tokenizer" },
  mistral: { kind: "transformers", hub: "Xenova/mistral-tokenizer-v3" },
  deepseek: { kind: "transformers", hub: "deepseek-ai/DeepSeek-V3" },
  google: { kind: "transformers", hub: "google/gemma-2-9b-it" },
}

// Tokenizer Management

class TokenizerManager {
  private tiktokenCache = new Map<string, any>()
  private transformerCache = new Map<string, any>()
  private tiktokenModule?: Promise<any>
  private transformersModule?: Promise<any>

  async countTokens(content: string, model: TokenModel): Promise<number> {
    if (!content.trim()) return 0

    try {
      switch (model.spec.kind) {
        case "approx":
          return this.approximateTokenCount(content)
        case "tiktoken":
          return await this.countWithTiktoken(content, model.spec.model)
        case "transformers":
          return await this.countWithTransformers(content, model.spec.hub)
      }
    } catch (error) {
      console.error(`Token counting error for ${model.name}:`, error)
      return this.approximateTokenCount(content)
    }
  }

  private approximateTokenCount(content: string): number {
    return Math.ceil(content.length / 4)
  }

  private async countWithTiktoken(content: string, model: string): Promise<number> {
    const encoder = await this.loadTiktokenEncoder(model)
    try {
      return encoder.encode(content).length
    } catch {
      return this.approximateTokenCount(content)
    }
  }

  private async countWithTransformers(content: string, hub: string): Promise<number> {
    const tokenizer = await this.loadTransformersTokenizer(hub)
    if (!tokenizer || typeof tokenizer.encode !== "function") {
      return this.approximateTokenCount(content)
    }

    try {
      const encoding = await tokenizer.encode(content)
      return Array.isArray(encoding) ? encoding.length : (encoding?.length ?? this.approximateTokenCount(content))
    } catch {
      return this.approximateTokenCount(content)
    }
  }

  private async loadTiktokenEncoder(model: string) {
    if (this.tiktokenCache.has(model)) {
      return this.tiktokenCache.get(model)
    }

    const mod = await this.loadTiktokenModule()
    const encodingForModel = mod.encodingForModel ?? mod.default?.encodingForModel
    const getEncoding = mod.getEncoding ?? mod.default?.getEncoding

    if (typeof getEncoding !== "function") {
      return { encode: (text: string) => ({ length: Math.ceil(text.length / 4) }) }
    }

    let encoder
    try {
      encoder = encodingForModel(model)
    } catch {
      encoder = getEncoding("cl100k_base")
    }

    this.tiktokenCache.set(model, encoder)
    return encoder
  }

  private async loadTiktokenModule() {
    if (!this.tiktokenModule) {
      this.tiktokenModule = this.importFromVendor("js-tiktoken")
    }
    return this.tiktokenModule
  }

  private async loadTransformersTokenizer(hub: string) {
    if (this.transformerCache.has(hub)) {
      return this.transformerCache.get(hub)
    }

    try {
      const { AutoTokenizer } = await this.loadTransformersModule()
      const tokenizer = await AutoTokenizer.from_pretrained(hub)
      this.transformerCache.set(hub, tokenizer)
      return tokenizer
    } catch {
      this.transformerCache.set(hub, null)
      return null
    }
  }

  private async loadTransformersModule() {
    if (!this.transformersModule) {
      this.transformersModule = this.importFromVendor("@huggingface/transformers")
    }
    return this.transformersModule
  }

  private async importFromVendor(pkg: string) {
    const pkgJsonPath = path.join(VENDOR_ROOT, pkg, "package.json")
    let data: string
    try {
      data = await fs.readFile(pkgJsonPath, "utf8")
    } catch {
      throw new Error(
        `Token analyzer dependencies missing. Run the install.sh script to install vendor tokenizers.\n` +
        `Expected path: ${pkgJsonPath}`
      )
    }

    const manifest = JSON.parse(data)
    const entry = manifest.module ?? manifest.main ?? "index.js"
    const entryPath = path.join(VENDOR_ROOT, pkg, entry)
    return import(pathToFileURL(entryPath).href)
  }
}

// Model Resolution

class ModelResolver {
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

// Content Collectors

class ContentCollector {
  collectSystemPrompts(messages: SessionMessage[]): CategoryEntrySource[] {
    const prompts = new Map<string, string>()

    for (const message of messages) {
      if (message.info.role === "system") {
        const content = this.extractText(message.parts)
        if (content) prompts.set(content, content)
      }

      if (message.info.role === "assistant") {
        for (const prompt of message.info.system ?? []) {
          const trimmed = (prompt ?? "").trim()
          if (trimmed) prompts.set(trimmed, trimmed)
        }
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

    for (const message of messages) {
      for (const part of message.parts) {
        if (!isToolPart(part)) continue

        if (part.state.status !== "completed") continue

        const output = (part.state.output ?? "").toString().trim()
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
        if (!isToolPart(part)) continue

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
        if (!isReasoningPart(part)) continue

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
      .filter(isTextPart)
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
    if (lower.includes("project") || lower.includes("repository") || lower.includes("codebase")) return "System#ProjectContext"
    if (lower.includes("session") || lower.includes("context") || lower.includes("memory")) return "System#SessionMgmt"
    if (content.includes("@") && (content.includes(".md") || content.includes(".txt"))) return "System#FileRefs"
    if (content.includes("name:") && content.includes("description:")) return "System#AgentDef"
    if (lower.includes("code") && (lower.includes("convention") || lower.includes("standard"))) return "System#CodeGuidelines"

    return `System#${index}`
  }

  private capitalize(value: string): string {
    if (!value) return value
    return value[0].toUpperCase() + value.slice(1)
  }
}

// Token Analysis Engine

class TokenAnalysisEngine {
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
      mostRecentInput: 0,
      mostRecentOutput: 0,
      mostRecentReasoning: 0,
      mostRecentCacheRead: 0,
      mostRecentCacheWrite: 0,
      sessionCost: 0,
      mostRecentCost: 0,
      allToolsCalled,
      toolCallCounts,
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
    const assistants = messages
      .filter((m) => m.info.role === "assistant" && (m.info?.tokens || m.info?.cost !== undefined))
      .map((m) => ({ msg: m, tokens: m.info.tokens, cost: m.info.cost ?? 0 }))

    let totalInput = 0, totalOutput = 0, totalReasoning = 0
    let totalCacheRead = 0, totalCacheWrite = 0, totalCost = 0

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
      .find(({ tokens }) => 
        tokens && (
          (Number(tokens.input) || 0) +
          (Number(tokens.output) || 0) +
          (Number(tokens.reasoning) || 0) +
          (Number(tokens.cache?.read) || 0) +
          (Number(tokens.cache?.write) || 0) > 0
        )
      ) ?? assistants[assistants.length - 1]

    let mostRecentInput = 0, mostRecentOutput = 0, mostRecentReasoning = 0
    let mostRecentCacheRead = 0, mostRecentCacheWrite = 0, mostRecentCost = 0

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
    analysis.assistantMessageCount = assistants.length
    analysis.sessionCost = totalCost
    analysis.mostRecentCost = mostRecentCost
    analysis.mostRecentInput = mostRecentInput
    analysis.mostRecentOutput = mostRecentOutput
    analysis.mostRecentReasoning = mostRecentReasoning
    analysis.mostRecentCacheRead = mostRecentCacheRead
    analysis.mostRecentCacheWrite = mostRecentCacheWrite

    const recentApiInputTotal = mostRecentInput + mostRecentCacheRead
    const localUserAndTools = analysis.categories.user.totalTokens + analysis.categories.tools.totalTokens
    const inferredSystemTokens = Math.max(0, recentApiInputTotal - localUserAndTools)
    
    if (inferredSystemTokens > 0 && analysis.categories.system.totalTokens === 0) {
      analysis.categories.system.totalTokens = inferredSystemTokens
      analysis.categories.system.entries = [{ label: "System (inferred from API)", tokens: inferredSystemTokens }]
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

// Cost Calculator

class CostCalculator {
  constructor(private pricingData: Record<string, ModelPricing>) {}

  calculateCost(analysis: TokenAnalysis): CostEstimate {
    const pricing = this.getPricing(analysis.model.name)
    const hasActivity = analysis.assistantMessageCount > 0 && 
      (analysis.inputTokens > 0 || analysis.outputTokens > 0)
    const isSubscription = hasActivity && analysis.sessionCost === 0
    
    const estimatedInputCost = (analysis.inputTokens / 1_000_000) * pricing.input
    const estimatedOutputCost = ((analysis.outputTokens + analysis.reasoningTokens) / 1_000_000) * pricing.output
    const estimatedCacheReadCost = (analysis.cacheReadTokens / 1_000_000) * pricing.cacheRead
    const estimatedCacheWriteCost = (analysis.cacheWriteTokens / 1_000_000) * pricing.cacheWrite
    const estimatedSessionCost = estimatedInputCost + estimatedOutputCost + estimatedCacheReadCost + estimatedCacheWriteCost
    
    return {
      isSubscription,
      apiSessionCost: analysis.sessionCost,
      apiMostRecentCost: analysis.mostRecentCost,
      estimatedSessionCost,
      estimatedInputCost,
      estimatedOutputCost,
      estimatedCacheReadCost,
      estimatedCacheWriteCost,
      pricePerMillionInput: pricing.input,
      pricePerMillionOutput: pricing.output,
      pricePerMillionCacheRead: pricing.cacheRead,
      pricePerMillionCacheWrite: pricing.cacheWrite,
      inputTokens: analysis.inputTokens,
      outputTokens: analysis.outputTokens,
      reasoningTokens: analysis.reasoningTokens,
      cacheReadTokens: analysis.cacheReadTokens,
      cacheWriteTokens: analysis.cacheWriteTokens,
    }
  }
  
  private getPricing(modelName: string): ModelPricing {
    const normalizedName = this.normalizeModelName(modelName)
    
    if (this.pricingData[normalizedName]) return this.pricingData[normalizedName]
    
    const lowerModel = normalizedName.toLowerCase()
    for (const [key, pricing] of Object.entries(this.pricingData)) {
      if (lowerModel.startsWith(key.toLowerCase())) return pricing
    }
    
    return this.pricingData["default"] || { input: 1, output: 3, cacheWrite: 0, cacheRead: 0 }
  }

  private normalizeModelName(modelName: string): string {
    return modelName.includes('/') ? modelName.split('/').pop() || modelName : modelName
  }
}

// Subagent Analyzer

class SubagentAnalyzer {
  constructor(
    private client: any,
    private costCalculator: CostCalculator,
    private pricingData: Record<string, ModelPricing>
  ) {}

  async analyzeChildSessions(parentSessionID: string): Promise<SubagentAnalysis> {
    const result: SubagentAnalysis = {
      subagents: [],
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalReasoningTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      totalTokens: 0,
      totalApiCost: 0,
      totalEstimatedCost: 0,
      totalApiCalls: 0,
    }

    try {
      const childrenResponse = await this.client.session.children({ path: { id: parentSessionID } })
      const children: ChildSession[] = ((childrenResponse as any)?.data ?? childrenResponse ?? []) as ChildSession[]

      if (!Array.isArray(children) || children.length === 0) return result

      for (const child of children) {
        const summary = await this.analyzeChildSession(child)
        if (summary) {
          result.subagents.push(summary)
          result.totalInputTokens += summary.inputTokens
          result.totalOutputTokens += summary.outputTokens
          result.totalReasoningTokens += summary.reasoningTokens
          result.totalCacheReadTokens += summary.cacheReadTokens
          result.totalCacheWriteTokens += summary.cacheWriteTokens
          result.totalTokens += summary.totalTokens
          result.totalApiCost += summary.apiCost
          result.totalEstimatedCost += summary.estimatedCost
          result.totalApiCalls += summary.assistantMessageCount
        }

        const nestedAnalysis = await this.analyzeChildSessions(child.id)
        for (const nested of nestedAnalysis.subagents) {
          result.subagents.push(nested)
        }
        result.totalInputTokens += nestedAnalysis.totalInputTokens
        result.totalOutputTokens += nestedAnalysis.totalOutputTokens
        result.totalReasoningTokens += nestedAnalysis.totalReasoningTokens
        result.totalCacheReadTokens += nestedAnalysis.totalCacheReadTokens
        result.totalCacheWriteTokens += nestedAnalysis.totalCacheWriteTokens
        result.totalTokens += nestedAnalysis.totalTokens
        result.totalApiCost += nestedAnalysis.totalApiCost
        result.totalEstimatedCost += nestedAnalysis.totalEstimatedCost
        result.totalApiCalls += nestedAnalysis.totalApiCalls
      }
    } catch (error) {
      console.error(`Failed to fetch child sessions for ${parentSessionID}:`, error)
    }

    return result
  }

  private async analyzeChildSession(child: ChildSession): Promise<SubagentSummary | null> {
    try {
      const messagesResponse = await this.client.session.messages({ path: { id: child.id } })
      const messages: SessionMessage[] = ((messagesResponse as any)?.data ?? messagesResponse ?? []) as SessionMessage[]

      if (!Array.isArray(messages) || messages.length === 0) return null

      const agentType = this.extractAgentType(child.title)
      let inputTokens = 0, outputTokens = 0, reasoningTokens = 0
      let cacheReadTokens = 0, cacheWriteTokens = 0
      let apiCost = 0, assistantMessageCount = 0, modelName = "unknown"

      for (const message of messages) {
        if (message.info.role === "assistant") {
          assistantMessageCount++
          const tokens = message.info.tokens
          if (tokens) {
            inputTokens += Number(tokens.input) || 0
            outputTokens += Number(tokens.output) || 0
            reasoningTokens += Number(tokens.reasoning) || 0
            cacheReadTokens += Number(tokens.cache?.read) || 0
            cacheWriteTokens += Number(tokens.cache?.write) || 0
          }
          apiCost += Number(message.info.cost) || 0
          if (message.info.modelID) modelName = message.info.modelID
        }
      }

      const totalTokens = inputTokens + outputTokens + reasoningTokens + cacheReadTokens + cacheWriteTokens
      const pricing = this.getPricing(modelName)
      const estimatedCost = 
        (inputTokens / 1_000_000) * pricing.input +
        ((outputTokens + reasoningTokens) / 1_000_000) * pricing.output +
        (cacheReadTokens / 1_000_000) * pricing.cacheRead +
        (cacheWriteTokens / 1_000_000) * pricing.cacheWrite

      return {
        sessionID: child.id, title: child.title, agentType,
        inputTokens, outputTokens, reasoningTokens, cacheReadTokens, cacheWriteTokens,
        totalTokens, apiCost, estimatedCost, assistantMessageCount,
      }
    } catch (error) {
      console.error(`Failed to analyze child session ${child.id}:`, error)
      return null
    }
  }

  private extractAgentType(title: string): string {
    const match = title.match(/@(\w+)\s+subagent/i)
    if (match) return match[1]
    const words = title.split(/\s+/)
    return words[0]?.toLowerCase() || "subagent"
  }

  private getPricing(modelName: string): ModelPricing {
    const normalizedName = modelName.includes('/') ? modelName.split('/').pop() || modelName : modelName
    if (this.pricingData[normalizedName]) return this.pricingData[normalizedName]
    
    const lowerModel = normalizedName.toLowerCase()
    for (const [key, pricing] of Object.entries(this.pricingData)) {
      if (lowerModel.startsWith(key.toLowerCase())) return pricing
    }
    
    return this.pricingData["default"] || { input: 1, output: 3, cacheWrite: 0, cacheRead: 0 }
  }
}

// Output Formatter

class OutputFormatter {
  private readonly BAR_WIDTH = 30
  private readonly TOKEN_SPACING = 11
  private readonly CATEGORY_LABEL_WIDTH = 9
  private readonly TOOL_LABEL_WIDTH = 20
  private readonly TOP_CONTRIBUTOR_LABEL_WIDTH = 30

  constructor(private costCalculator: CostCalculator) {}

  private formatCategoryBar(
    label: string,
    tokens: number,
    total: number,
    labelWidth: number = this.CATEGORY_LABEL_WIDTH
  ): string {
    if (tokens === 0) return ""

    const percentage = total > 0 ? ((tokens / total) * 100).toFixed(1) : "0.0"
    const percentageNum = parseFloat(percentage)
    const barWidth = Math.round((percentageNum / 100) * this.BAR_WIDTH)
    const bar = "█".repeat(barWidth) + "░".repeat(Math.max(0, this.BAR_WIDTH - barWidth))
    const labelPadded = label.padEnd(labelWidth)
    const formattedTokens = this.formatNumber(tokens)

    let pct = percentage
    if (percentageNum < 10) {
      pct = " " + pct
    }

    const tokensPart = `(${formattedTokens})`
    const spacesNeeded = Math.max(1, this.TOKEN_SPACING - tokensPart.length)
    const spacing = " ".repeat(spacesNeeded)

    return `${labelPadded} ${bar} ${spacing}${pct}% ${tokensPart}`
  }

  format(analysis: TokenAnalysis): string {
    const inputCategories = [
      { label: "SYSTEM", tokens: analysis.categories.system.totalTokens },
      { label: "USER", tokens: analysis.categories.user.totalTokens },
      { label: "TOOLS", tokens: analysis.categories.tools.totalTokens },
    ]
    const outputCategories = [
      { label: "ASSISTANT", tokens: analysis.categories.assistant.totalTokens },
      { label: "REASONING", tokens: analysis.categories.reasoning.totalTokens },
    ]
    const topEntries = this.collectTopEntries(analysis, 5)
    
    const toolStats = new Map<string, { tokens: number; calls: number }>()
    for (const [toolName, calls] of analysis.toolCallCounts.entries()) {
      toolStats.set(toolName, { tokens: 0, calls })
    }
    for (const entry of analysis.categories.tools.allEntries) {
      const existing = toolStats.get(entry.label) || { tokens: 0, calls: 0 }
      toolStats.set(entry.label, { ...existing, tokens: entry.tokens })
    }
    const toolEntries = Array.from(toolStats.entries())
      .map(([label, stats]) => ({ label, tokens: stats.tokens, calls: stats.calls }))
      .sort((a, b) => b.tokens - a.tokens)

    const costEstimate = this.costCalculator.calculateCost(analysis)

    return this.formatVisualOutput(
      analysis.sessionID, analysis.model.name, analysis.totalTokens,
      analysis.inputTokens, analysis.outputTokens, analysis.reasoningTokens,
      analysis.cacheReadTokens, analysis.cacheWriteTokens, analysis.assistantMessageCount,
      analysis.mostRecentInput, analysis.mostRecentOutput, analysis.mostRecentReasoning,
      analysis.mostRecentCacheRead, analysis.mostRecentCacheWrite,
      inputCategories, outputCategories, topEntries, toolEntries, costEstimate,
      analysis.subagentAnalysis
    )
  }

  private formatVisualOutput(
    sessionID: string,
    modelName: string,
    totalTokens: number,
    inputTokens: number,
    outputTokens: number,
    reasoningTokens: number,
    cacheReadTokens: number,
    cacheWriteTokens: number,
    assistantMessageCount: number,
    mostRecentInput: number,
    mostRecentOutput: number,
    mostRecentReasoning: number,
    mostRecentCacheRead: number,
    mostRecentCacheWrite: number,
    inputCategories: Array<{ label: string; tokens: number }>,
    outputCategories: Array<{ label: string; tokens: number }>,
    topEntries: CategoryEntry[],
    toolEntries: Array<{ label: string; tokens: number; calls: number }>,
    cost: CostEstimate,
    subagentAnalysis?: SubagentAnalysis
  ): string {
    const lines: string[] = []
    const sessionTotal = inputTokens + cacheReadTokens + cacheWriteTokens + outputTokens + reasoningTokens
    const mainCost = cost.isSubscription ? cost.estimatedSessionCost : cost.apiSessionCost

    // Header
    lines.push(`═══════════════════════════════════════════════════════════════════════════`)
    lines.push(`Token Analysis: Session ${sessionID}`)
    lines.push(`Model: ${modelName}`)
    lines.push(`═══════════════════════════════════════════════════════════════════════════`)
    lines.push(``)

    // 1. TOKEN BREAKDOWN BY CATEGORY
    lines.push(`TOKEN BREAKDOWN BY CATEGORY`)
    lines.push(`─────────────────────────────────────────────────────────────────────────`)
    lines.push(`Estimated using tokenizer analysis of message content:`)
    lines.push(``)

    const inputTotal = inputCategories.reduce((sum, cat) => sum + cat.tokens, 0)
    lines.push(`Input Categories:`)
    for (const category of inputCategories) {
      const barLine = this.formatCategoryBar(category.label, category.tokens, inputTotal)
      if (barLine) lines.push(`  ${barLine}`)
    }
    lines.push(``)
    lines.push(`  Subtotal: ${this.formatNumber(inputTotal)} estimated input tokens`)
    lines.push(``)

    const outputTotal = outputCategories.reduce((sum, cat) => sum + cat.tokens, 0)
    lines.push(`Output Categories:`)
    for (const category of outputCategories) {
      const barLine = this.formatCategoryBar(category.label, category.tokens, outputTotal)
      if (barLine) lines.push(`  ${barLine}`)
    }
    lines.push(``)
    lines.push(`  Subtotal: ${this.formatNumber(outputTotal)} estimated output tokens`)
    lines.push(``)
    lines.push(`Local Total: ${this.formatNumber(totalTokens)} tokens (estimated)`)

    // 2. TOOL USAGE BREAKDOWN (right after token breakdown)
    if (toolEntries.length > 0) {
      const toolsTotalTokens = inputCategories.find(c => c.label === "TOOLS")?.tokens || 0
      lines.push(``)
      lines.push(`TOOL USAGE BREAKDOWN`)
      lines.push(`─────────────────────────────────────────────────────────────────────────`)
      for (const tool of toolEntries) {
        const barLine = this.formatCategoryBar(tool.label, tool.tokens, toolsTotalTokens, this.TOOL_LABEL_WIDTH)
        if (barLine) {
          const calls = `${tool.calls}x`.padStart(5)
          lines.push(`${barLine} ${calls}`)
        }
      }
    }

    // 3. TOP CONTRIBUTORS
    if (topEntries.length > 0) {
      lines.push(``)
      lines.push(`TOP CONTRIBUTORS`)
      lines.push(`─────────────────────────────────────────────────────────────────────────`)
      for (const entry of topEntries) {
        const percentage = ((entry.tokens / totalTokens) * 100).toFixed(1)
        const label = `• ${entry.label}`.padEnd(this.TOP_CONTRIBUTOR_LABEL_WIDTH)
        const formattedTokens = this.formatNumber(entry.tokens)
        lines.push(`${label} ${formattedTokens} tokens (${percentage}%)`)
      }
    }

    // 4. MOST RECENT API CALL
    lines.push(``)
    lines.push(`═══════════════════════════════════════════════════════════════════════════`)
    lines.push(`MOST RECENT API CALL`)
    lines.push(`─────────────────────────────────────────────────────────────────────────`)
    lines.push(``)
    lines.push(`Raw telemetry from last API response:`)
    lines.push(`  Input (fresh):     ${this.formatNumber(mostRecentInput).padStart(10)} tokens`)
    lines.push(`  Cache read:        ${this.formatNumber(mostRecentCacheRead).padStart(10)} tokens`)
    if (mostRecentCacheWrite > 0) {
      lines.push(`  Cache write:       ${this.formatNumber(mostRecentCacheWrite).padStart(10)} tokens`)
    }
    lines.push(`  Output:            ${this.formatNumber(mostRecentOutput).padStart(10)} tokens`)
    if (mostRecentReasoning > 0) {
      lines.push(`  Reasoning:         ${this.formatNumber(mostRecentReasoning).padStart(10)} tokens`)
    }
    lines.push(`  ───────────────────────────────────`)
    lines.push(`  Total:             ${this.formatNumber(mostRecentInput + mostRecentCacheRead + mostRecentCacheWrite + mostRecentOutput + mostRecentReasoning).padStart(10)} tokens`)

    // 5. SESSION TOTALS
    lines.push(``)
    lines.push(`═══════════════════════════════════════════════════════════════════════════`)
    lines.push(`SESSION TOTALS (All ${assistantMessageCount} API calls)`)
    lines.push(`─────────────────────────────────────────────────────────────────────────`)
    lines.push(``)
    lines.push(`Total tokens processed across the entire session (for cost calculation):`)
    lines.push(``)
    lines.push(`  Input tokens:      ${this.formatNumber(inputTokens).padStart(10)} (fresh tokens across all calls)`)
    lines.push(`  Cache read:        ${this.formatNumber(cacheReadTokens).padStart(10)} (cached tokens across all calls)`)
    lines.push(`  Cache write:       ${this.formatNumber(cacheWriteTokens).padStart(10)} (tokens written to cache)`)
    lines.push(`  Output tokens:     ${this.formatNumber(outputTokens).padStart(10)} (all model responses)`)
    if (reasoningTokens > 0) {
      lines.push(`  Reasoning tokens:  ${this.formatNumber(reasoningTokens).padStart(10)} (thinking/reasoning)`)
    }
    lines.push(`  ───────────────────────────────────`)
    lines.push(`  Session Total:     ${this.formatNumber(sessionTotal).padStart(10)} tokens (for billing)`)

    // 6. SESSION COST / ESTIMATED SESSION COST
    lines.push(``)
    lines.push(`═══════════════════════════════════════════════════════════════════════════`)
    if (cost.isSubscription) {
      lines.push(`ESTIMATED SESSION COST (API Key Pricing)`)
      lines.push(`─────────────────────────────────────────────────────────────────────────`)
      lines.push(``)
      lines.push(`You appear to be on a subscription plan (API cost is $0).`)
      lines.push(`Here's what this session would cost with direct API access:`)
      lines.push(``)
      lines.push(`  Input tokens:      ${this.formatNumber(inputTokens).padStart(10)} × $${cost.pricePerMillionInput.toFixed(2)}/M  = $${cost.estimatedInputCost.toFixed(4)}`)
      lines.push(`  Output tokens:     ${this.formatNumber(outputTokens + reasoningTokens).padStart(10)} × $${cost.pricePerMillionOutput.toFixed(2)}/M  = $${cost.estimatedOutputCost.toFixed(4)}`)
      if (cacheReadTokens > 0 && cost.pricePerMillionCacheRead > 0) {
        lines.push(`  Cache read:        ${this.formatNumber(cacheReadTokens).padStart(10)} × $${cost.pricePerMillionCacheRead.toFixed(2)}/M  = $${cost.estimatedCacheReadCost.toFixed(4)}`)
      }
      if (cacheWriteTokens > 0 && cost.pricePerMillionCacheWrite > 0) {
        lines.push(`  Cache write:       ${this.formatNumber(cacheWriteTokens).padStart(10)} × $${cost.pricePerMillionCacheWrite.toFixed(2)}/M  = $${cost.estimatedCacheWriteCost.toFixed(4)}`)
      }
      lines.push(`─────────────────────────────────────────────────────────────────────────`)
      lines.push(`ESTIMATED TOTAL: $${cost.estimatedSessionCost.toFixed(4)}`)
      lines.push(``)
      lines.push(`Note: This estimate uses standard API pricing from models.json.`)
      lines.push(`Actual API costs may vary based on provider and context size.`)
    } else {
      lines.push(`SESSION COST`)
      lines.push(`─────────────────────────────────────────────────────────────────────────`)
      lines.push(``)
      lines.push(`Token usage breakdown:`)
      lines.push(`  Input tokens:      ${this.formatNumber(inputTokens).padStart(10)}`)
      lines.push(`  Output tokens:     ${this.formatNumber(outputTokens).padStart(10)}`)
      if (reasoningTokens > 0) {
        lines.push(`  Reasoning tokens:  ${this.formatNumber(reasoningTokens).padStart(10)}`)
      }
      if (cacheReadTokens > 0) {
        lines.push(`  Cache read:        ${this.formatNumber(cacheReadTokens).padStart(10)}`)
      }
      if (cacheWriteTokens > 0) {
        lines.push(`  Cache write:       ${this.formatNumber(cacheWriteTokens).padStart(10)}`)
      }
      lines.push(``)
      lines.push(`─────────────────────────────────────────────────────────────────────────`)
      lines.push(`ACTUAL COST (from API):  $${cost.apiSessionCost.toFixed(4)}`)
      const diff = Math.abs(cost.apiSessionCost - cost.estimatedSessionCost)
      const diffPercent = cost.apiSessionCost > 0 ? (diff / cost.apiSessionCost) * 100 : 0
      if (diffPercent > 5) {
        lines.push(`Estimated cost:          $${cost.estimatedSessionCost.toFixed(4)} (${diffPercent > 0 ? (cost.estimatedSessionCost > cost.apiSessionCost ? '+' : '-') : ''}${diffPercent.toFixed(1)}% diff)`)
      }
      lines.push(``)
      lines.push(`Note: Actual cost from OpenCode includes provider-specific pricing`)
      lines.push(`and 200K+ context adjustments.`)
    }

    // 7. SUBAGENT COSTS (if any)
    if (subagentAnalysis && subagentAnalysis.subagents.length > 0) {
      const subagentLabelWidth = 25
      const subagentTotalCost = cost.isSubscription 
        ? subagentAnalysis.totalEstimatedCost 
        : subagentAnalysis.totalApiCost

      lines.push(``)
      lines.push(`═══════════════════════════════════════════════════════════════════════════`)
      lines.push(`SUBAGENT COSTS (${subagentAnalysis.subagents.length} child sessions, ${subagentAnalysis.totalApiCalls} API calls)`)
      lines.push(`─────────────────────────────────────────────────────────────────────────`)
      lines.push(``)
      for (const subagent of subagentAnalysis.subagents) {
        const label = `${subagent.agentType}`.padEnd(subagentLabelWidth)
        const costStr = cost.isSubscription 
          ? `$${subagent.estimatedCost.toFixed(4)}`
          : `$${subagent.apiCost.toFixed(4)}`
        const tokensStr = `(${this.formatNumber(subagent.totalTokens)} tokens, ${subagent.assistantMessageCount} calls)`
        lines.push(`  ${label} ${costStr.padStart(10)}  ${tokensStr}`)
      }
      lines.push(`─────────────────────────────────────────────────────────────────────────`)
      lines.push(`Subagent Total:${' '.repeat(subagentLabelWidth - 14)} $${subagentTotalCost.toFixed(4)}  (${this.formatNumber(subagentAnalysis.totalTokens)} tokens, ${subagentAnalysis.totalApiCalls} calls)`)
    }

    // 8. SUMMARY (always last)
    lines.push(``)
    lines.push(`═══════════════════════════════════════════════════════════════════════════`)
    lines.push(`SUMMARY`)
    lines.push(`─────────────────────────────────────────────────────────────────────────`)
    lines.push(``)
    lines.push(`                          Cost        Tokens          API Calls`)

    if (subagentAnalysis && subagentAnalysis.subagents.length > 0) {
      const subagentTotalCost = cost.isSubscription 
        ? subagentAnalysis.totalEstimatedCost 
        : subagentAnalysis.totalApiCost
      const grandTotalCost = mainCost + subagentTotalCost
      const grandTotalTokens = sessionTotal + subagentAnalysis.totalTokens
      const grandTotalApiCalls = assistantMessageCount + subagentAnalysis.totalApiCalls

      lines.push(`  Main session:      $${mainCost.toFixed(4).padStart(10)}    ${this.formatNumber(sessionTotal).padStart(10)}         ${assistantMessageCount.toString().padStart(5)}`)
      lines.push(`  Subagents:         $${subagentTotalCost.toFixed(4).padStart(10)}    ${this.formatNumber(subagentAnalysis.totalTokens).padStart(10)}         ${subagentAnalysis.totalApiCalls.toString().padStart(5)}`)
      lines.push(`─────────────────────────────────────────────────────────────────────────`)
      lines.push(`  TOTAL:             $${grandTotalCost.toFixed(4).padStart(10)}    ${this.formatNumber(grandTotalTokens).padStart(10)}         ${grandTotalApiCalls.toString().padStart(5)}`)
    } else {
      lines.push(`  Session:           $${mainCost.toFixed(4).padStart(10)}    ${this.formatNumber(sessionTotal).padStart(10)}         ${assistantMessageCount.toString().padStart(5)}`)
    }

    lines.push(``)
    lines.push(`═══════════════════════════════════════════════════════════════════════════`)

    return lines.join("\n")
  }

  private collectTopEntries(analysis: TokenAnalysis, limit: number): CategoryEntry[] {
    const pool = [
      ...analysis.categories.system.allEntries,
      ...analysis.categories.user.allEntries,
      ...analysis.categories.assistant.allEntries,
      ...analysis.categories.tools.allEntries,
      ...analysis.categories.reasoning.allEntries,
    ]
      .filter((entry) => entry.tokens > 0)
      .sort((a, b) => b.tokens - a.tokens)

    return pool.slice(0, limit)
  }

  private formatNumber(value: number): string {
    return new Intl.NumberFormat("en-US").format(value)
  }
}

// Plugin Export

export const TokenAnalyzerPlugin: Plugin = async ({ client }) => {
  const pricingData = await loadModelPricing()
  
  const tokenizerManager = new TokenizerManager()
  const modelResolver = new ModelResolver()
  const contentCollector = new ContentCollector()
  const analysisEngine = new TokenAnalysisEngine(tokenizerManager, contentCollector)
  const costCalculator = new CostCalculator(pricingData)
  const subagentAnalyzer = new SubagentAnalyzer(client, costCalculator, pricingData)
  const formatter = new OutputFormatter(costCalculator)

  return {
    tool: {
      tokenscope: tool({
        description:
          "Analyze token usage across the current session with detailed breakdowns by category (system, user, assistant, tools, reasoning). " +
          "Provides visual charts, identifies top token consumers, and includes costs from subagent (Task tool) child sessions.",
        args: {
          sessionID: tool.schema.string().optional(),
          limitMessages: tool.schema.number().int().min(1).max(10).optional(),
          includeSubagents: tool.schema.boolean().optional().describe("Include token costs from subagent child sessions (default: true)"),
        },
        async execute(args, context) {
          const sessionID = args.sessionID ?? context.sessionID
          if (!sessionID) {
            throw new Error("No session ID available for token analysis")
          }

          const response = await client.session.messages({ path: { id: sessionID } })
          const messages: SessionMessage[] = ((response as any)?.data ?? response ?? []) as SessionMessage[]

          if (!Array.isArray(messages) || messages.length === 0) {
            return `Session ${sessionID} has no messages yet.`
          }

          const tokenModel = modelResolver.resolveTokenModel(messages)
          const analysis = await analysisEngine.analyze(
            sessionID,
            messages,
            tokenModel,
            args.limitMessages ?? DEFAULT_ENTRY_LIMIT
          )

          if (args.includeSubagents !== false) {
            analysis.subagentAnalysis = await subagentAnalyzer.analyzeChildSessions(sessionID)
          }

          const output = formatter.format(analysis)
          const outputPath = path.join(process.cwd(), 'token-usage-output.txt')
          
          try {
            try { await fs.unlink(outputPath) } catch {}
            await fs.writeFile(outputPath, output, { encoding: 'utf8', flag: 'w' })
          } catch (error) {
            throw new Error(`Failed to write token analysis to ${outputPath}: ${error}`)
          }

          const timestamp = new Date().toISOString()
          const formattedTotal = new Intl.NumberFormat("en-US").format(analysis.totalTokens)
          
          let summaryMsg = `Token analysis complete! Full report saved to: ${outputPath}\n\nTimestamp: ${timestamp}\nMain session tokens: ${formattedTotal}`
          
          if (analysis.subagentAnalysis && analysis.subagentAnalysis.subagents.length > 0) {
            const subagentTokens = new Intl.NumberFormat("en-US").format(analysis.subagentAnalysis.totalTokens)
            const grandTotal = new Intl.NumberFormat("en-US").format(analysis.totalTokens + analysis.subagentAnalysis.totalTokens)
            summaryMsg += `\nSubagent sessions: ${analysis.subagentAnalysis.subagents.length} (${subagentTokens} tokens)`
            summaryMsg += `\nGrand total: ${grandTotal} tokens`
          }
          
          summaryMsg += `\n\nUse: cat token-usage-output.txt (or read the file) to view the complete analysis.`
          
          return summaryMsg
        },
      }),
    },
  }
}
