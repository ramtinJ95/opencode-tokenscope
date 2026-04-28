// Telemetry helpers - extracts per-API-call token and cost data from stored session messages

import type { TokenUsage } from "./types"

export interface TelemetryCall {
  model: string
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
  perModel: Record<
    string,
    {
      inputTokens: number
      outputTokens: number
      reasoningTokens: number
      cacheReadTokens: number
      cacheWriteTokens: number
      apiCallCount: number
    }
  >
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
    model?: {
      providerID?: string
      modelID?: string
    }
    providerID?: string
    modelID?: string
  }
  parts: TelemetryPartLike[]
}

function resolveModelKey(message: TelemetryMessageLike): string {
  const providerID =
    (typeof message.info.providerID === "string" && message.info.providerID.trim()) ||
    (typeof message.info.model?.providerID === "string" && message.info.model.providerID.trim()) ||
    ""
  const modelID =
    (typeof message.info.modelID === "string" && message.info.modelID.trim()) ||
    (typeof message.info.model?.modelID === "string" && message.info.model.modelID.trim()) ||
    ""

  if (providerID && modelID) return `${providerID}/${modelID}`
  if (modelID) return modelID
  if (providerID) return providerID
  return "unknown"
}

function safeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function hasExplicitNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function buildTelemetryCall(model: string, tokens: TokenUsage | undefined, cost: unknown, force: boolean): TelemetryCall | null {
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
    model,
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
    const model = resolveModelKey(message)

    const stepFinishParts = message.parts.filter(isStepFinishPart)
    if (stepFinishParts.length > 0) {
      for (const part of stepFinishParts) {
        const call = buildTelemetryCall(model, part.tokens, part.cost, true)
        if (call) calls.push(call)
      }
      continue
    }

    const fallback = buildTelemetryCall(model, message.info.tokens, message.info.cost, false)
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
  const perModel: TelemetrySummary["perModel"] = {}

  for (const call of calls) {
    inputTokens += call.inputTokens
    outputTokens += call.outputTokens
    reasoningTokens += call.reasoningTokens
    cacheReadTokens += call.cacheReadTokens
    cacheWriteTokens += call.cacheWriteTokens
    sessionCost += call.cost

    if (call.cacheReadTokens > 0) callsWithCacheRead += 1
    if (call.cacheWriteTokens > 0) callsWithCacheWrite += 1

    if (!perModel[call.model]) {
      perModel[call.model] = {
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        apiCallCount: 0,
      }
    }
    perModel[call.model].inputTokens += call.inputTokens
    perModel[call.model].outputTokens += call.outputTokens
    perModel[call.model].reasoningTokens += call.reasoningTokens
    perModel[call.model].cacheReadTokens += call.cacheReadTokens
    perModel[call.model].cacheWriteTokens += call.cacheWriteTokens
    perModel[call.model].apiCallCount += 1
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
    perModel,
  }
}

export function firstCacheWriteTokens(messages: TelemetryMessageLike[]): number {
  for (const call of collectTelemetryCalls(messages)) {
    if (call.cacheWriteTokens > 0) return call.cacheWriteTokens
  }

  return 0
}
