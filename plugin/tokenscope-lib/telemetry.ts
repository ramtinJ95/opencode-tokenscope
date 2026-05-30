// Telemetry helpers - extracts per-API-call token and cost data from stored session messages

import type { ModelTokenUsage, TokenUsage } from "./types.js"

export interface TelemetryCall {
  providerID?: string
  modelID?: string
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
  perModelUsage: ModelTokenUsage[]
}

type ModelRefLike = {
  providerID?: string
  modelID?: string
  id?: string
}

type TelemetryPartLike = {
  type?: string
  tokens?: TokenUsage
  cost?: number
  model?: ModelRefLike
}

type TelemetryMessageLike = {
  info?: {
    role?: string
    tokens?: TokenUsage
    cost?: number
    providerID?: string
    modelID?: string
    model?: ModelRefLike
  }
  data?: {
    role?: string
    tokens?: TokenUsage
    cost?: number
    providerID?: string
    modelID?: string
    model?: ModelRefLike
  }
  role?: string
  type?: string
  providerID?: string
  modelID?: string
  tokens?: TokenUsage
  cost?: number
  model?: ModelRefLike
  parts?: TelemetryPartLike[]
}

function safeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function hasExplicitNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function getMessageRole(message: TelemetryMessageLike): string | undefined {
  return message.info?.role ?? message.data?.role ?? message.role ?? message.type
}

function getModelRef(message: TelemetryMessageLike, part?: TelemetryPartLike): ModelRefLike {
  const partModel = part?.model
  const dataModel = message.data?.model
  const infoModel = message.info?.model
  const topLevelModel = message.model

  return {
    providerID: normalizeString(
      partModel?.providerID ??
        dataModel?.providerID ??
        message.data?.providerID ??
        infoModel?.providerID ??
        message.info?.providerID ??
        topLevelModel?.providerID ??
        message.providerID
    ),
    modelID: normalizeString(
      partModel?.modelID ??
        partModel?.id ??
        dataModel?.modelID ??
        dataModel?.id ??
        message.data?.modelID ??
        infoModel?.modelID ??
        infoModel?.id ??
        message.info?.modelID ??
        topLevelModel?.modelID ??
        topLevelModel?.id ??
        message.modelID
    ),
  }
}

function getMessageTokens(message: TelemetryMessageLike): TokenUsage | undefined {
  return message.info?.tokens ?? message.data?.tokens ?? message.tokens
}

function getMessageCost(message: TelemetryMessageLike): unknown {
  return message.info?.cost ?? message.data?.cost ?? message.cost
}

function buildTelemetryCall(
  tokens: TokenUsage | undefined,
  cost: unknown,
  force: boolean,
  model: ModelRefLike
): TelemetryCall | null {
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
    providerID: model.providerID,
    modelID: model.modelID,
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

function modelDisplayName(providerID?: string, modelID?: string): string {
  if (providerID && modelID) return `${providerID}/${modelID}`
  return modelID ?? providerID ?? "unknown model"
}

function modelGroupingKey(providerID?: string, modelID?: string): string {
  return `${providerID ?? ""}\u0000${modelID ?? ""}`
}

function summarizeCallsByModel(calls: TelemetryCall[]): ModelTokenUsage[] {
  const byModel = new Map<string, ModelTokenUsage>()

  for (const call of calls) {
    const key = modelGroupingKey(call.providerID, call.modelID)
    const existing = byModel.get(key) ?? {
      providerID: call.providerID,
      modelID: call.modelID,
      modelName: modelDisplayName(call.providerID, call.modelID),
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      apiCost: 0,
      apiCallCount: 0,
      callsWithCacheRead: 0,
      callsWithCacheWrite: 0,
    }

    existing.inputTokens += call.inputTokens
    existing.outputTokens += call.outputTokens
    existing.reasoningTokens += call.reasoningTokens
    existing.cacheReadTokens += call.cacheReadTokens
    existing.cacheWriteTokens += call.cacheWriteTokens
    existing.apiCost += call.cost
    existing.apiCallCount += 1
    if (call.cacheReadTokens > 0) existing.callsWithCacheRead += 1
    if (call.cacheWriteTokens > 0) existing.callsWithCacheWrite += 1

    byModel.set(key, existing)
  }

  return Array.from(byModel.values()).sort((a, b) => b.apiCallCount - a.apiCallCount || a.modelName.localeCompare(b.modelName))
}

export function collectTelemetryCalls(messages: TelemetryMessageLike[]): TelemetryCall[] {
  const calls: TelemetryCall[] = []

  for (const message of messages) {
    if (getMessageRole(message) !== "assistant") continue

    const stepFinishParts = (message.parts ?? []).filter(isStepFinishPart)
    if (stepFinishParts.length > 0) {
      for (const part of stepFinishParts) {
        const call = buildTelemetryCall(part.tokens, part.cost, true, getModelRef(message, part))
        if (call) calls.push(call)
      }
      continue
    }

    const fallback = buildTelemetryCall(getMessageTokens(message), getMessageCost(message), false, getModelRef(message))
    if (fallback) calls.push(fallback)
  }

  return calls
}

export function summarizeTelemetry(messages: TelemetryMessageLike[]): TelemetrySummary {
  const assistantMessageCount = messages.reduce((count, message) => count + (getMessageRole(message) === "assistant" ? 1 : 0), 0)
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
    perModelUsage: summarizeCallsByModel(calls),
  }
}

export function firstCacheWriteTokens(messages: TelemetryMessageLike[]): number {
  for (const call of collectTelemetryCalls(messages)) {
    if (call.cacheWriteTokens > 0) return call.cacheWriteTokens
  }

  return 0
}
