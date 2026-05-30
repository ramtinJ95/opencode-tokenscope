import { expect, test } from "bun:test"

import { ModelResolver } from "../tokenscope-lib/analyzer.js"
import { CostCalculator } from "../tokenscope-lib/cost.js"
import { calculateModelAwareCacheEfficiency } from "../tokenscope-lib/formatter-helpers.js"
import { applySessionInfoTotals } from "../tokenscope-lib/session-workflow.js"
import { SubagentAnalyzer } from "../tokenscope-lib/subagent.js"
import { summarizeTelemetry } from "../tokenscope-lib/telemetry.js"
import type { TokenAnalysis } from "../tokenscope-lib/types.js"

function emptyCategory(label: string) {
  return { label, totalTokens: 0, entries: [], allEntries: [] }
}

function baseAnalysis(overrides: Partial<TokenAnalysis>): TokenAnalysis {
  return {
    sessionID: "ses_test",
    model: { name: "claude-sonnet-4-20250514", spec: { kind: "approx" } },
    categories: {
      system: emptyCategory("system"),
      user: emptyCategory("user"),
      assistant: emptyCategory("assistant"),
      tools: emptyCategory("tools"),
      reasoning: emptyCategory("reasoning"),
    },
    totalTokens: 0,
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
    allToolsCalled: [],
    toolCallCounts: new Map(),
    perModelUsage: [],
    warnings: [],
    ...overrides,
  }
}

test("summarizeTelemetry keeps cache buckets split by assistant message model", () => {
  const telemetry = summarizeTelemetry([
    {
      info: { role: "assistant" },
      data: { model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" } },
      parts: [
        {
          type: "step-finish",
          tokens: { input: 1_000, output: 200, reasoning: 0, cache: { read: 100_000, write: 1_000 } },
          cost: 0,
        },
      ],
    },
    {
      info: { role: "assistant" },
      data: { model: { providerID: "google", modelID: "gemini-2.5-flash" } },
      parts: [
        {
          type: "step-finish",
          tokens: { input: 2_000, output: 400, reasoning: 50, cache: { read: 50_000, write: 0 } },
          cost: 0,
        },
      ],
    },
  ])

  expect(telemetry.cacheReadTokens).toBe(150_000)
  expect(telemetry.perModelUsage).toHaveLength(2)
  expect(telemetry.perModelUsage.find((model) => model.modelID === "claude-sonnet-4-20250514")?.cacheReadTokens).toBe(100_000)
  expect(telemetry.perModelUsage.find((model) => model.modelID === "gemini-2.5-flash")?.cacheReadTokens).toBe(50_000)
})

test("summarizeTelemetry reads top-level scalar provider and model IDs", () => {
  const telemetry = summarizeTelemetry([
    {
      role: "assistant",
      providerID: "openai",
      modelID: "gpt-5.4-mini",
      tokens: { input: 1_000, output: 100, reasoning: 0, cache: { read: 500, write: 0 } },
      cost: 0,
    },
  ])

  expect(telemetry.perModelUsage).toHaveLength(1)
  expect(telemetry.perModelUsage[0]?.providerID).toBe("openai")
  expect(telemetry.perModelUsage[0]?.modelID).toBe("gpt-5.4-mini")
})

test("summarizeTelemetry prefers per-call data model over stale info model", () => {
  const telemetry = summarizeTelemetry([
    {
      info: { role: "assistant", model: { providerID: "openai", modelID: "gpt-5.4" } },
      data: { model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" } },
      tokens: { input: 1_000, output: 100, reasoning: 0, cache: { read: 500, write: 0 } },
      cost: 0,
    },
  ])

  expect(telemetry.perModelUsage).toHaveLength(1)
  expect(telemetry.perModelUsage[0]?.providerID).toBe("anthropic")
  expect(telemetry.perModelUsage[0]?.modelID).toBe("claude-sonnet-4-20250514")
})

test("ModelResolver reads scalar provider and model IDs from message data", () => {
  const resolver = new ModelResolver()
  const resolved = resolver.resolveModelAndProvider([
    {
      info: { id: "msg_1", role: "assistant" },
      data: { providerID: "openai", modelID: "gpt-5.4-mini" },
      parts: [],
    },
  ])

  expect(resolved.providerID).toBe("openai")
  expect(resolved.modelID).toBe("gpt-5.4-mini")
})

test("calculateCost applies per-model prices to input output and cache token types", () => {
  const calculator = new CostCalculator({
    "anthropic/claude-sonnet-4-20250514": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
    "google/gemini-2.5-flash": { input: 0.3, output: 2.5, cacheWrite: 0, cacheRead: 0.075 },
    default: { input: 1, output: 3, cacheWrite: 0, cacheRead: 0 },
  })

  const cost = calculator.calculateCost(
    baseAnalysis({
      inputTokens: 3_000,
      outputTokens: 600,
      reasoningTokens: 50,
      cacheReadTokens: 150_000,
      cacheWriteTokens: 1_000,
      apiCallCount: 2,
      perModelUsage: [
        {
          providerID: "anthropic",
          modelID: "claude-sonnet-4-20250514",
          modelName: "anthropic/claude-sonnet-4-20250514",
          inputTokens: 1_000,
          outputTokens: 200,
          reasoningTokens: 0,
          cacheReadTokens: 100_000,
          cacheWriteTokens: 1_000,
          apiCost: 0,
          apiCallCount: 1,
          callsWithCacheRead: 1,
          callsWithCacheWrite: 1,
        },
        {
          providerID: "google",
          modelID: "gemini-2.5-flash",
          modelName: "google/gemini-2.5-flash",
          inputTokens: 2_000,
          outputTokens: 400,
          reasoningTokens: 50,
          cacheReadTokens: 50_000,
          cacheWriteTokens: 0,
          apiCost: 0,
          apiCallCount: 1,
          callsWithCacheRead: 1,
          callsWithCacheWrite: 0,
        },
      ],
    })
  )

  expect(cost.perModelCosts).toHaveLength(2)
  expect(cost.estimatedCacheReadCost).toBeCloseTo(0.03375)
  expect(cost.estimatedSessionCost).toBeCloseTo(0.045225)
  expect(cost.perModelCosts.find((model) => model.providerID === "anthropic")?.estimatedSessionCost).toBeCloseTo(0.03975)
  expect(cost.perModelCosts.find((model) => model.providerID === "google")?.estimatedSessionCost).toBeCloseTo(0.005475)
})

test("calculateCost uses the analysis pricing model when telemetry model metadata is missing", () => {
  const calculator = new CostCalculator({
    "openai/gpt-5.4-mini": { input: 0.75, output: 4.5, cacheWrite: 0, cacheRead: 0.075 },
    default: { input: 1, output: 3, cacheWrite: 0, cacheRead: 0 },
  })

  const cost = calculator.calculateCost(
    baseAnalysis({
      pricingModelName: "openai/gpt-5.4-mini",
      inputTokens: 1_000,
      outputTokens: 100,
      apiCallCount: 1,
      perModelUsage: [
        {
          modelName: "unknown model",
          inputTokens: 1_000,
          outputTokens: 100,
          reasoningTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          apiCost: 0,
          apiCallCount: 1,
          callsWithCacheRead: 0,
          callsWithCacheWrite: 0,
        },
      ],
    })
  )

  expect(cost.perModelCosts[0]?.pricingModelName).toBe("openai/gpt-5.4-mini")
  expect(cost.estimatedSessionCost).toBeCloseTo(0.0012)
})

test("calculateCost falls back when telemetry only has provider metadata", () => {
  const calculator = new CostCalculator({
    "openai/gpt-5.4-mini": { input: 0.75, output: 4.5, cacheWrite: 0, cacheRead: 0.075 },
    default: { input: 1, output: 3, cacheWrite: 0, cacheRead: 0 },
  })

  const cost = calculator.calculateCost(
    baseAnalysis({
      pricingModelName: "openai/gpt-5.4-mini",
      inputTokens: 1_000,
      outputTokens: 100,
      apiCallCount: 1,
      perModelUsage: [
        {
          providerID: "openai",
          modelName: "openai",
          inputTokens: 1_000,
          outputTokens: 100,
          reasoningTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          apiCost: 0,
          apiCallCount: 1,
          callsWithCacheRead: 0,
          callsWithCacheWrite: 0,
        },
      ],
    })
  )

  expect(cost.perModelCosts[0]?.pricingModelName).toBe("openai/gpt-5.4-mini")
  expect(cost.estimatedSessionCost).toBeCloseTo(0.0012)
  expect(cost.unknownPricingModels).toEqual([])
})

test("calculateCost applies OpenCode-style context_over_200k pricing per API call", () => {
  const calculator = new CostCalculator({
    "provider/tiered-model": {
      input: 1,
      output: 10,
      cacheRead: 0.1,
      cacheWrite: 2,
      context_over_200k: { input: 2, output: 20, cache_read: 0.2, cache_write: 4 },
    },
  })

  const cost = calculator.calculateCost(
    baseAnalysis({
      pricingModelName: "provider/tiered-model",
      inputTokens: 400_001,
      outputTokens: 200_000,
      reasoningTokens: 200_000,
      apiCallCount: 2,
      perModelUsage: [
        {
          providerID: "provider",
          modelID: "tiered-model",
          modelName: "provider/tiered-model",
          inputTokens: 400_001,
          outputTokens: 200_000,
          reasoningTokens: 200_000,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          apiCost: 0,
          apiCallCount: 2,
          callsWithCacheRead: 0,
          callsWithCacheWrite: 0,
          calls: [
            {
              inputTokens: 200_000,
              outputTokens: 100_000,
              reasoningTokens: 100_000,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
            },
            {
              inputTokens: 200_001,
              outputTokens: 100_000,
              reasoningTokens: 100_000,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
            },
          ],
        },
      ],
    })
  )

  expect(cost.perModelCosts[0]?.usesTieredPricing).toBe(true)
  expect(cost.estimatedInputCost).toBeCloseTo(0.600002)
  expect(cost.estimatedOutputCost).toBeCloseTo(6)
  expect(cost.estimatedSessionCost).toBeCloseTo(6.600002)
})

test("calculateCost prefers the highest matching explicit context tier", () => {
  const calculator = new CostCalculator({
    "provider/tiered-model": {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      tiers: [
        { tier: { type: "context", size: 1_000 }, input: 2, output: 2, cache_read: 0, cache_write: 0 },
        { tier: { type: "context", size: 2_000 }, input: 3, output: 3, cache_read: 0, cache_write: 0 },
      ],
      context_over_200k: { input: 9, output: 9, cache_read: 0, cache_write: 0 },
    },
  })

  const cost = calculator.calculateCost(
    baseAnalysis({
      pricingModelName: "provider/tiered-model",
      inputTokens: 2_500,
      outputTokens: 1_000,
      apiCallCount: 1,
    })
  )

  expect(cost.perModelCosts[0]?.usesTieredPricing).toBe(true)
  expect(cost.estimatedSessionCost).toBeCloseTo(0.0105)
})

test("applySessionInfoTotals prefers persisted OpenCode session aggregates", () => {
  const analysis = baseAnalysis({
    inputTokens: 1,
    outputTokens: 2,
    reasoningTokens: 3,
    cacheReadTokens: 4,
    cacheWriteTokens: 5,
    sessionCost: 0.01,
  })

  applySessionInfoTotals(analysis, {
    id: "ses_test",
    cost: 0.1234,
    tokens: { input: 10, output: 20, reasoning: 30, cache: { read: 40, write: 50 } },
  })

  expect(analysis.inputTokens).toBe(10)
  expect(analysis.outputTokens).toBe(20)
  expect(analysis.reasoningTokens).toBe(30)
  expect(analysis.cacheReadTokens).toBe(40)
  expect(analysis.cacheWriteTokens).toBe(50)
  expect(analysis.sessionCost).toBe(0.1234)
})

test("calculateCost treats persisted aggregate tokens as subscription activity without telemetry calls", () => {
  const calculator = new CostCalculator({
    "openai/gpt-5.4-mini": { input: 1, output: 3, cacheWrite: 0, cacheRead: 0 },
  })

  const cost = calculator.calculateCost(
    baseAnalysis({
      pricingModelName: "openai/gpt-5.4-mini",
      inputTokens: 1_000,
      outputTokens: 500,
      apiCallCount: 0,
      sessionCost: 0,
    })
  )

  expect(cost.isSubscription).toBe(true)
  expect(cost.estimatedSessionCost).toBeCloseTo(0.0025)
})

test("calculateCost reconciles persisted aggregate deltas into estimates", () => {
  const calculator = new CostCalculator({
    "openai/gpt-5.4-mini": { input: 1, output: 3, cacheWrite: 0, cacheRead: 0 },
  })

  const cost = calculator.calculateCost(
    baseAnalysis({
      pricingModelName: "openai/gpt-5.4-mini",
      inputTokens: 1_500,
      outputTokens: 500,
      apiCallCount: 1,
      perModelUsage: [
        {
          providerID: "openai",
          modelID: "gpt-5.4-mini",
          modelName: "openai/gpt-5.4-mini",
          inputTokens: 1_000,
          outputTokens: 400,
          reasoningTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          apiCost: 0,
          apiCallCount: 1,
          callsWithCacheRead: 0,
          callsWithCacheWrite: 0,
        },
      ],
    })
  )

  expect(cost.perModelCosts).toHaveLength(2)
  expect(cost.estimatedSessionCost).toBeCloseTo(0.003)
})

test("calculateCost supports OpenCode nested cache pricing", () => {
  const calculator = new CostCalculator({
    "provider/normalized": {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      experimentalOver200K: { input: 2, output: 2, cache: { read: 0.5, write: 1.5 } },
      tiers: [{ tier: { type: "context", size: 1_000 }, input: 3, output: 3, cache: { read: 0.75, write: 2 } }],
    },
  })

  const cost = calculator.calculateCost(
    baseAnalysis({
      pricingModelName: "provider/normalized",
      inputTokens: 1_000,
      cacheReadTokens: 1_000,
      cacheWriteTokens: 1_000,
      apiCallCount: 1,
    })
  )

  expect(cost.estimatedInputCost).toBeCloseTo(0.003)
  expect(cost.estimatedCacheReadCost).toBeCloseTo(0.00075)
  expect(cost.estimatedCacheWriteCost).toBeCloseTo(0.002)
})

test("cache efficiency uses per-call tier pricing for uncached cost", () => {
  const calculator = new CostCalculator({
    "provider/tiered-model": {
      input: 1,
      output: 1,
      cacheRead: 0.1,
      cacheWrite: 0,
      context_over_200k: { input: 2, output: 2, cache_read: 0.2, cache_write: 0 },
    },
  })
  const cost = calculator.calculateCost(
    baseAnalysis({
      pricingModelName: "provider/tiered-model",
      inputTokens: 200_001,
      cacheReadTokens: 200_000,
      apiCallCount: 2,
      perModelUsage: [
        {
          providerID: "provider",
          modelID: "tiered-model",
          modelName: "provider/tiered-model",
          inputTokens: 200_001,
          outputTokens: 0,
          reasoningTokens: 0,
          cacheReadTokens: 200_000,
          cacheWriteTokens: 0,
          apiCost: 0,
          apiCallCount: 2,
          callsWithCacheRead: 1,
          callsWithCacheWrite: 0,
          calls: [
            { inputTokens: 100_000, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
            { inputTokens: 100_001, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 200_000, cacheWriteTokens: 0 },
          ],
        },
      ],
    })
  )

  const efficiency = calculateModelAwareCacheEfficiency(
    {
      cacheReadTokens: 200_000,
      freshInputTokens: 200_001,
      cacheWriteTokens: 0,
      totalInputTokens: 400_001,
      cacheHitRate: 0,
      costWithoutCaching: 0,
      costWithCaching: 0,
      costSavings: 0,
      savingsPercent: 0,
      effectiveRate: 0,
      standardRate: 0,
    },
    cost
  )

  expect(efficiency.costWithoutCaching).toBeCloseTo(0.700002)
})

test("SubagentAnalyzer preserves telemetry buckets missing from child aggregates", async () => {
  const calculator = new CostCalculator({
    "openai/gpt-5.4-mini": { input: 1, output: 3, cacheWrite: 2, cacheRead: 0.5 },
  })
  const analyzer = new SubagentAnalyzer(
    {
      session: {
        children: async ({ path }: { path: { id?: string; sessionID?: string } }) => {
          const id = path.id ?? path.sessionID
          if (id === "ses_parent") {
            return [{ id: "ses_child", title: "worker subagent", tokens: { input: 10, output: 20 }, cost: 0 }]
          }
          return []
        },
        messages: async () => [
          {
            info: { id: "msg_child", role: "assistant", providerID: "openai", modelID: "gpt-5.4-mini" },
            parts: [
              {
                type: "step-finish",
                tokens: { input: 5, output: 6, reasoning: 0, cache: { read: 7, write: 8 } },
                cost: 0,
              },
            ],
          },
        ],
      },
    },
    calculator
  )

  const result = await analyzer.analyzeChildSessions("ses_parent")

  expect(result.subagents[0]?.inputTokens).toBe(10)
  expect(result.subagents[0]?.outputTokens).toBe(20)
  expect(result.subagents[0]?.cacheReadTokens).toBe(7)
  expect(result.subagents[0]?.cacheWriteTokens).toBe(8)
  expect(result.totalEstimatedCost).toBeGreaterThan(0)
})

