// Types and interfaces for the tokenscope plugin

export interface SessionMessage {
  info: SessionMessageInfo
  parts: SessionMessagePart[]
}

export interface SessionMessageInfo {
  id: string
  role: string
  modelID?: string
  providerID?: string
  system?: string[]
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
  | { type: "text"; text: string; synthetic?: boolean }
  | { type: "reasoning"; text: string }
  | { type: "tool"; tool: string; state: ToolState }
  | { type: string; [key: string]: unknown }

export interface ToolState {
  status: "pending" | "running" | "completed" | "error"
  input?: Record<string, unknown>
  output?: string
  title?: string
  metadata?: Record<string, unknown>
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
  // New context analysis fields
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
  | { kind: "transformers"; hub: string }
  | { kind: "approx" }

export interface CategoryEntrySource {
  label: string
  content: string
}

export interface CostEstimate {
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

export interface SubagentSummary {
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

export interface SubagentAnalysis {
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
  projectTree: ContextComponent & { fileCount: number }
  customInstructions: ContextComponent & { sources: string[] }
  totalCachedContext: number
}

// Tool schema estimation types

export interface ToolSchemaEstimate {
  name: string
  enabled: boolean
  estimatedTokens: number
  argumentCount: number
  hasComplexArgs: boolean
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

export interface SkillAnalysis {
  availableSkills: AvailableSkill[]
  loadedSkills: LoadedSkill[]
  totalAvailableTokens: number
  totalLoadedTokens: number
  skillToolDescriptionTokens: number
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

// Export parsing types

export interface ExportedSession {
  info: ExportedSessionInfo
  messages: ExportedMessage[]
}

export interface ExportedSessionInfo {
  id: string
  title: string
  parentID?: string
}

export interface ExportedMessage {
  info: ExportedMessageInfo
  parts: ExportedPart[]
}

export interface ExportedMessageInfo {
  id: string
  role: "user" | "assistant"
  system?: string[]
  tools?: Record<string, boolean>
  tokens?: TokenUsage
  cost?: number
  modelID?: string
  providerID?: string
}

export interface ExportedPart {
  type: string
  tool?: string
  state?: {
    status: string
    input?: Record<string, unknown>
  }
}

// Config types

export interface TokenscopeConfig {
  enableContextBreakdown: boolean
  enableToolSchemaEstimation: boolean
  enableCacheEfficiency: boolean
  enableSubagentAnalysis: boolean
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
}

export interface ChildSession {
  id: string
  title: string
  parentID?: string
}

// Type guards

export function isToolPart(part: SessionMessagePart): part is { type: "tool"; tool: string; state: ToolState } {
  return part.type === "tool"
}

export function isReasoningPart(part: SessionMessagePart): part is { type: "reasoning"; text: string } {
  return part.type === "reasoning"
}

export function isTextPart(part: SessionMessagePart): part is { type: "text"; text: string; synthetic?: boolean } {
  return part.type === "text"
}
