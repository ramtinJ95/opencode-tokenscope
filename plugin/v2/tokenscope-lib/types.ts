// Types and interfaces for the tokenscope plugin

// Normalized session transcript. OpenCode messages are converted into this shape at the
// plugin boundary (see opencode.ts) so the analyzers never depend on the host's wire format.

export interface ModelRef {
  providerID?: string
  modelID?: string
}

export interface SessionMessage {
  info: SessionMessageInfo
  parts: SessionMessagePart[]
}

export interface SessionMessageInfo {
  id: string
  role: "user" | "assistant" | "system"
  agent?: string
  model?: ModelRef
  tokens?: TokenUsage
  cost?: number
}

export interface TokenUsage {
  input?: number
  output?: number
  reasoning?: number
  cache?: {
    read?: number
    write?: number
  }
}

export type SessionMessagePart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool"; tool: string; state: ToolState }

export interface ToolState {
  status: "streaming" | "running" | "completed" | "error"
  input?: Record<string, unknown>
  // For a failed call this is what the model saw: the tool's content, or else the error message.
  output?: string
  metadata?: Record<string, unknown>
}

// The system prompt and tool definitions of the most recent model request for a session,
// captured by the plugin's session "context" hook.

export interface RequestSnapshot {
  system: SystemSnapshotPart[]
  tools: ToolDefinition[]
}

export interface SystemSnapshotPart {
  text: string
  // Named instruction sources inside this part (for example "core/environment").
  instructions?: Array<{ key: string; text: string }>
}

export interface ToolDefinition {
  id: string
  description: string
  schema: unknown
}

export interface CategoryEntry {
  label: string
  tokens: number
}

export interface CategorySummary {
  label: string
  totalTokens: number
  entries: CategoryEntry[]
  allEntries: CategoryEntry[]
}

export interface TokenAnalysis {
  sessionID: string
  model: TokenModel
  pricingModelName?: string
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
  apiCallCount: number
  callsWithCacheRead: number
  callsWithCacheWrite: number
  mostRecentInput: number
  mostRecentOutput: number
  mostRecentReasoning: number
  mostRecentCacheRead: number
  mostRecentCacheWrite: number
  sessionCost: number
  mostRecentCost: number
  allToolsCalled: string[]
  toolCallCounts: Map<string, number>
  perModelUsage: ModelTokenUsage[]
  warnings: string[]
  subagentAnalysis?: SubagentAnalysis
  contextBreakdown?: ContextBreakdown
  toolEstimates?: ToolSchemaEstimate[]
  cacheEfficiency?: CacheEfficiency
  skillAnalysis?: SkillAnalysis
}

export interface TokenModel {
  name: string
  spec: TokenizerSpec
}

export type TokenizerSpec =
  | { kind: "tiktoken"; model: string }
  | { kind: "huggingface"; hub: string }
  | { kind: "approx" }

export interface CategoryEntrySource {
  label: string
  content: string
}

export interface CostEstimate {
  usesEstimatedCost: boolean
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
  perModelCosts: ModelCostEstimate[]
  unknownPricingModels: string[]
}

export interface ModelTokenUsage {
  providerID?: string
  modelID?: string
  modelName: string
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  apiCost: number
  apiCallCount: number
  callsWithCacheRead: number
  callsWithCacheWrite: number
  costSegments?: ModelTokenUsageSegment[]
}

export interface ModelTokenUsageSegment {
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  apiCallCount: number
}

export type PricingTier = "context_tier" | "mixed_context_tiers"

export interface TokenCostBreakdown {
  estimatedSessionCost: number
  estimatedInputCost: number
  estimatedOutputCost: number
  estimatedCacheReadCost: number
  estimatedCacheWriteCost: number
  estimatedInputCostWithoutCaching: number
  pricePerMillionInput: number
  pricePerMillionOutput: number
  pricePerMillionCacheRead: number
  pricePerMillionCacheWrite: number
  pricingTier?: PricingTier
  pricingTierThreshold?: number
}

export interface ModelCostEstimate extends ModelTokenUsage, TokenCostBreakdown {
  pricingModelName: string
  hasPricing: boolean
}

export interface EstimatedCostComponents {
  estimatedInputCost: number
  estimatedOutputCost: number
  estimatedCacheReadCost: number
  estimatedCacheWriteCost: number
}

export interface SubagentSummary extends EstimatedCostComponents {
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
  apiCallCount: number
}

export interface SubagentAnalysis extends EstimatedCostComponents {
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

// Context breakdown types

export interface ContextComponent {
  tokens: number
  identified: boolean // true = found in prompts, false = estimated
}

export interface ContextBreakdown {
  baseSystemPrompt: ContextComponent
  toolDefinitions: ContextComponent & { toolCount: number }
  environmentContext: ContextComponent & { components: string[] }
  customInstructions: ContextComponent & { sources: string[] }
  // Skill, MCP, reference and Code Mode catalogs plus API-provided instruction entries.
  guidance: ContextComponent & { sources: string[] }
  totalCachedContext: number
}

// Tool schema estimation types

export interface ToolSchemaEstimate {
  name: string
  enabled: boolean
  estimatedTokens: number
  argumentCount: number
  hasComplexArgs: boolean
  source?: "model-request" | "transcript"
}

// Skill analysis types

export interface AvailableSkill {
  name: string
  description: string
  tokens: number
}

export interface LoadedSkill {
  name: string
  callCount: number
  firstMessageIndex: number
  tokens: number
  totalTokens: number
  content: string
}

export interface AvailableSubagent {
  name: string
  description: string
  tokens: number
}

export interface SkillAnalysis {
  availableSkills: AvailableSkill[]
  availableSubagents: AvailableSubagent[]
  loadedSkills: LoadedSkill[]
  totalAvailableTokens: number
  totalAvailableSubagentTokens: number
  totalLoadedTokens: number
  availableSkillsContextTokens: number
  skillToolDescriptionTokens: number
  subagentToolDescriptionTokens: number
}

// Cache efficiency types

export interface CacheEfficiency {
  cacheReadTokens: number
  freshInputTokens: number
  cacheWriteTokens: number
  totalInputTokens: number
  cacheHitRate: number
  costWithoutCaching: number
  costWithCaching: number
  costSavings: number
  savingsPercent: number
  effectiveRate: number
  standardRate: number
}

// Config types

export interface TokenscopeConfig {
  enableContextBreakdown: boolean
  enableToolSchemaEstimation: boolean
  enableCacheEfficiency: boolean
  enableSubagentAnalysis: boolean
  enableDetailedSubagentCostBreakdown: boolean
  enableSkillAnalysis: boolean
}

// Context analysis result

export interface ContextAnalysisResult {
  contextBreakdown?: ContextBreakdown
  toolEstimates?: ToolSchemaEstimate[]
  cacheEfficiency?: CacheEfficiency
}

export interface ModelPricing {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
  contextWindow?: number
  tiers?: Array<{
    input: number
    output: number
    cacheWrite: number
    cacheRead: number
    threshold: number
  }>
  contextOver200k?: {
    input: number
    output: number
    cacheWrite: number
    cacheRead: number
    threshold?: number
  }
}

export interface ChildSession {
  id: string
  title?: string
  agent?: string
}

export interface SessionAggregateInfo {
  id?: string
  cost?: number
  tokens?: TokenUsage
  revert?: {
    messageID?: string
  }
}
