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
  contextAnalysis?: ContextAnalysis // New: detailed context breakdown
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

// Tool Definition Types (from /experimental/tool API)

export interface ToolDefinition {
  id: string
  description: string
  parameters: unknown // JSON Schema
}

export interface ToolDefinitionAnalysis {
  id: string
  description: string
  descriptionTokens: number
  schemaTokens: number
  totalTokens: number
}

export interface ToolDefinitionsBreakdown {
  tools: ToolDefinitionAnalysis[]
  totalDescriptionTokens: number
  totalSchemaTokens: number
  totalTokens: number
  toolCount: number
}

// System Prompt Breakdown Types

export interface SystemPromptSection {
  label: string
  description: string // Human-readable explanation of what this section does
  content: string
  tokens: number
}

export interface SystemPromptBreakdown {
  sections: SystemPromptSection[]
  totalTokens: number
  rawPrompt: string // The full system prompt for reference
}

// Context Efficiency Types

export interface ContextEfficiency {
  staticContextTokens: number // tool defs + system prompt
  cacheReadTokens: number
  cacheWriteTokens: number
  freshInputTokens: number
  cacheHitRate: number // percentage
  effectiveCostReduction: number // percentage saved vs no caching
}

// Request Composition Types

export interface RequestComposition {
  toolDefinitions: number
  systemPrompt: number
  conversationHistory: number
  userMessage: number
  totalRequest: number
}

// Combined Context Analysis

export interface ContextAnalysis {
  toolDefinitions: ToolDefinitionsBreakdown
  systemPrompt: SystemPromptBreakdown
  efficiency: ContextEfficiency
  requestComposition: RequestComposition
  providerID: string
  modelID: string
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
