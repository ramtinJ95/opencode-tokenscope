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
  output?: string
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
