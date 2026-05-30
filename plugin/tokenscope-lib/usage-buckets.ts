import type { ModelTokenUsageCall, TokenUsage } from "./types.js"

export type PartialTokenBuckets = {
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

export type TokenBuckets = Required<PartialTokenBuckets>

export const EMPTY_TOKEN_BUCKETS: TokenBuckets = {
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}

export function safeTokenNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : undefined
}

export function readTokenBuckets(tokens: TokenUsage | undefined): PartialTokenBuckets | null {
  if (!tokens) return null

  const buckets = {
    inputTokens: safeTokenNumber(tokens.input),
    outputTokens: safeTokenNumber(tokens.output),
    reasoningTokens: safeTokenNumber(tokens.reasoning),
    cacheReadTokens: safeTokenNumber(tokens.cache?.read),
    cacheWriteTokens: safeTokenNumber(tokens.cache?.write),
  }

  return hasDefinedTokenBucket(buckets) ? buckets : null
}

export function completeTokenBuckets(buckets: PartialTokenBuckets | null | undefined): TokenBuckets {
  return {
    inputTokens: buckets?.inputTokens ?? 0,
    outputTokens: buckets?.outputTokens ?? 0,
    reasoningTokens: buckets?.reasoningTokens ?? 0,
    cacheReadTokens: buckets?.cacheReadTokens ?? 0,
    cacheWriteTokens: buckets?.cacheWriteTokens ?? 0,
  }
}

export function totalTokenBuckets(buckets: PartialTokenBuckets): number {
  return (
    (buckets.inputTokens ?? 0) +
    (buckets.outputTokens ?? 0) +
    (buckets.reasoningTokens ?? 0) +
    (buckets.cacheReadTokens ?? 0) +
    (buckets.cacheWriteTokens ?? 0)
  )
}

export function hasTokenActivity(buckets: PartialTokenBuckets | null | undefined): boolean {
  return totalTokenBuckets(buckets ?? EMPTY_TOKEN_BUCKETS) > 0
}

export function hasDefinedTokenBucket(buckets: PartialTokenBuckets): boolean {
  return Object.values(buckets).some((value) => value !== undefined)
}

export function hasLowerAggregateBucket(aggregate: PartialTokenBuckets, telemetry: TokenBuckets): boolean {
  return (
    (aggregate.inputTokens !== undefined && aggregate.inputTokens < telemetry.inputTokens) ||
    (aggregate.outputTokens !== undefined && aggregate.outputTokens < telemetry.outputTokens) ||
    (aggregate.reasoningTokens !== undefined && aggregate.reasoningTokens < telemetry.reasoningTokens) ||
    (aggregate.cacheReadTokens !== undefined && aggregate.cacheReadTokens < telemetry.cacheReadTokens) ||
    (aggregate.cacheWriteTokens !== undefined && aggregate.cacheWriteTokens < telemetry.cacheWriteTokens)
  )
}

export function sumTokenBuckets(usages: PartialTokenBuckets[]): TokenBuckets {
  return usages.reduce<TokenBuckets>(
    (sum, usage) => ({
      inputTokens: sum.inputTokens + (usage.inputTokens ?? 0),
      outputTokens: sum.outputTokens + (usage.outputTokens ?? 0),
      reasoningTokens: sum.reasoningTokens + (usage.reasoningTokens ?? 0),
      cacheReadTokens: sum.cacheReadTokens + (usage.cacheReadTokens ?? 0),
      cacheWriteTokens: sum.cacheWriteTokens + (usage.cacheWriteTokens ?? 0),
    }),
    { ...EMPTY_TOKEN_BUCKETS }
  )
}

export function positiveTokenDelta(total: PartialTokenBuckets, subtotal: PartialTokenBuckets): TokenBuckets {
  return {
    inputTokens: Math.max(0, (total.inputTokens ?? 0) - (subtotal.inputTokens ?? 0)),
    outputTokens: Math.max(0, (total.outputTokens ?? 0) - (subtotal.outputTokens ?? 0)),
    reasoningTokens: Math.max(0, (total.reasoningTokens ?? 0) - (subtotal.reasoningTokens ?? 0)),
    cacheReadTokens: Math.max(0, (total.cacheReadTokens ?? 0) - (subtotal.cacheReadTokens ?? 0)),
    cacheWriteTokens: Math.max(0, (total.cacheWriteTokens ?? 0) - (subtotal.cacheWriteTokens ?? 0)),
  }
}

export function rawContextTokens(usage: ModelTokenUsageCall): number {
  return usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
}
