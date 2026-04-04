// Telemetry helpers - extracts per-API-call token and cost data from stored session messages

import type { TokenUsage } from "./types"

export interface TelemetryCall {
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cost: number
  providerTotalTokens?: number
}

export interface TelemetrySummary {
  assistantMessageCount: number
  apiCallCount: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  callsWithCacheRead: number
  callsWithCacheWrite: number
  sessionCost: number
  mostRecentInput: number
  mostRecentOutput: number
  mostRecentReasoning: number
  mostRecentCacheRead: number
  mostRecentCacheWrite: number
  mostRecentCost: number
  mostRecentProviderTotalTokens?: number
}

type TelemetryPartLike = {
  type?: string
  tokens?: TokenUsage
  cost?: number
}

type TelemetryMessageLike = {
  info: {
    role?: string
    tokens?: TokenUsage
    cost?: number
  }
  parts: TelemetryPartLike[]
}

function safeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function hasExplicitNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function buildTelemetryCall(tokens: TokenUsage | undefined, cost: unknown, force: boolean): TelemetryCall | null {
  const inputTokens = safeNumber(tokens?.input)
  const outputTokens = safeNumber(tokens?.output)
  const reasoningTokens = safeNumber(tokens?.reasoning)
  const cacheReadTokens = safeNumber(tokens?.cache?.read)
  const cacheWriteTokens = safeNumber(tokens?.cache?.write)
  const providerTotalTokens = hasExplicitNumber(tokens?.total) ? safeNumber(tokens?.total) : undefined
  const normalizedCost = safeNumber(cost)

  const hasActivity =
    inputTokens + outputTokens + reasoningTokens + cacheReadTokens + cacheWriteTokens > 0 ||
    normalizedCost > 0 ||
    providerTotalTokens !== undefined

  if (!force && !hasActivity) return null

  return {
    inputTokens,
    outputTokens,
    reasoningTokens,
    cacheReadTokens,
    cacheWriteTokens,
    cost: normalizedCost,
    providerTotalTokens,
  }
}

function isStepFinishPart(part: TelemetryPartLike): part is Required<Pick<TelemetryPartLike, "type">> & TelemetryPartLike {
  return part.type === "step-finish"
}

export function collectTelemetryCalls(messages: TelemetryMessageLike[]): TelemetryCall[] {
  const calls: TelemetryCall[] = []

  for (const message of messages) {
    if (message.info.role !== "assistant") continue

    const stepFinishParts = message.parts.filter(isStepFinishPart)
    if (stepFinishParts.length > 0) {
      for (const part of stepFinishParts) {
        const call = buildTelemetryCall(part.tokens, part.cost, true)
        if (call) calls.push(call)
      }
      continue
    }

    const fallback = buildTelemetryCall(message.info.tokens, message.info.cost, false)
    if (fallback) calls.push(fallback)
  }

  return calls
}

export function summarizeTelemetry(messages: TelemetryMessageLike[]): TelemetrySummary {
  const assistantMessageCount = messages.reduce((count, message) => count + (message.info.role === "assistant" ? 1 : 0), 0)
  const calls = collectTelemetryCalls(messages)

  let inputTokens = 0
  let outputTokens = 0
  let reasoningTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let callsWithCacheRead = 0
  let callsWithCacheWrite = 0
  let sessionCost = 0

  for (const call of calls) {
    inputTokens += call.inputTokens
    outputTokens += call.outputTokens
    reasoningTokens += call.reasoningTokens
    cacheReadTokens += call.cacheReadTokens
    cacheWriteTokens += call.cacheWriteTokens
    sessionCost += call.cost

    if (call.cacheReadTokens > 0) callsWithCacheRead += 1
    if (call.cacheWriteTokens > 0) callsWithCacheWrite += 1
  }

  const mostRecent = calls[calls.length - 1]

  return {
    assistantMessageCount,
    apiCallCount: calls.length,
    inputTokens,
    outputTokens,
    reasoningTokens,
    cacheReadTokens,
    cacheWriteTokens,
    callsWithCacheRead,
    callsWithCacheWrite,
    sessionCost,
    mostRecentInput: mostRecent?.inputTokens ?? 0,
    mostRecentOutput: mostRecent?.outputTokens ?? 0,
    mostRecentReasoning: mostRecent?.reasoningTokens ?? 0,
    mostRecentCacheRead: mostRecent?.cacheReadTokens ?? 0,
    mostRecentCacheWrite: mostRecent?.cacheWriteTokens ?? 0,
    mostRecentCost: mostRecent?.cost ?? 0,
    mostRecentProviderTotalTokens: mostRecent?.providerTotalTokens,
  }
}

export function firstCacheWriteTokens(messages: TelemetryMessageLike[]): number {
  for (const call of collectTelemetryCalls(messages)) {
    if (call.cacheWriteTokens > 0) return call.cacheWriteTokens
  }

  return 0
}
