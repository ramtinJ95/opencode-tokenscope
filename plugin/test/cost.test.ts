import { expect, test } from "bun:test"

import { ContentCollector, ModelResolver, TokenAnalysisEngine } from "../tokenscope-lib/analyzer.js"
import { CostCalculator } from "../tokenscope-lib/cost.js"
import { calculateModelAwareCacheEfficiency } from "../tokenscope-lib/formatter-helpers.js"
import { formatCacheEfficiency } from "../tokenscope-lib/formatter-insight-sections.js"
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

test("summarizeTelemetry clamps invalid negative usage and cost to zero", () => {
  const telemetry = summarizeTelemetry([
    {
      role: "assistant",
      tokens: { input: -10, output: -20, reasoning: -1, cache: { read: -30, write: -40 }, total: -100 },
      cost: -5,
    },
  ])

  expect(telemetry.inputTokens).toBe(0)
  expect(telemetry.outputTokens).toBe(0)
  expect(telemetry.cacheReadTokens).toBe(0)
  expect(telemetry.sessionCost).toBe(0)
  expect(telemetry.mostRecentProviderTotalTokens).toBe(0)
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

test("ModelResolver prefers data model fields over stale info model fields", () => {
  const resolver = new ModelResolver()
  const resolved = resolver.resolveModelAndProvider([
    {
      info: { id: "msg_1", role: "assistant", model: { providerID: "openai", modelID: "gpt-5.4" } },
      data: { providerID: "openai", modelID: "gpt-5.4-mini" },
      parts: [],
    },
  ])

  expect(resolved.providerID).toBe("openai")
  expect(resolved.modelID).toBe("gpt-5.4-mini")
  expect(resolved.model.name).toBe("gpt-5.4-mini")
})

test("ModelResolver uses model families instead of treating every OpenCode model as OpenAI", () => {
  const resolver = new ModelResolver()
  const claude = resolver.resolveModelAndProvider([
    {
      info: { id: "msg_claude", role: "assistant", providerID: "opencode", modelID: "claude-opus-4-6" },
      parts: [],
    },
  ])
  const gpt = resolver.resolveModelAndProvider([
    {
      info: { id: "msg_gpt", role: "assistant", providerID: "opencode", modelID: "gpt-5.4-mini" },
      parts: [],
    },
  ])

  expect(claude.model.spec).toEqual({ kind: "huggingface", hub: "Xenova/claude-tokenizer" })
  expect(gpt.model.spec).toEqual({ kind: "tiktoken", model: "gpt-4o" })
})

test("ModelResolver retains the actual model name when tokenization is approximate", () => {
  const resolver = new ModelResolver()
  const resolved = resolver.resolveModelAndProvider([
    {
      info: { id: "msg_gemini", role: "assistant", providerID: "opencode", modelID: "gemini-3.1-pro" },
      parts: [],
    },
  ])

  expect(resolved.model).toEqual({ name: "gemini-3.1-pro", spec: { kind: "approx" } })
})

test("ContentCollector excludes ignored text and includes replayed tool errors", () => {
  const collector = new ContentCollector()
  const messages = [
    {
      info: { id: "msg_user", role: "user" },
      parts: [
        { type: "text" as const, text: "visible" },
        { type: "text" as const, text: "hidden", ignored: true },
      ],
    },
    {
      info: { id: "msg_assistant", role: "assistant" },
      parts: [
        { type: "tool" as const, tool: "read", state: { status: "error" as const, error: "permission denied" } },
        {
          type: "tool" as const,
          tool: "bash",
          state: {
            status: "error" as const,
            error: "interrupted",
            metadata: { interrupted: true, output: "partial output" },
          },
        },
      ],
    },
  ]

  expect(collector.collectMessageTexts(messages, "user")).toEqual([{ label: "User#1", content: "visible" }])
  expect(collector.collectToolOutputs(messages)).toEqual([
    { label: "read", content: "permission denied" },
    { label: "bash", content: "partial output" },
  ])
})

test("TokenAnalysisEngine does not relabel prompt remainder as system content", async () => {
  const engine = new TokenAnalysisEngine(
    { async countTokens(content: string) { return content.length } } as any,
    new ContentCollector()
  )
  const analysis = await engine.analyze(
    "ses_test",
    [
      { info: { id: "msg_user", role: "user" }, parts: [{ type: "text", text: "hello" }] },
      {
        info: { id: "msg_assistant", role: "assistant", providerID: "openai", modelID: "gpt-5.4" },
        parts: [
          { type: "text", text: "prior assistant history" },
          {
            type: "step-finish",
            tokens: { input: 1_200, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
            cost: 0,
          },
        ],
      },
    ],
    { name: "gpt-5.4", spec: { kind: "approx" } },
    3
  )

  expect(analysis.categories.system.totalTokens).toBe(0)
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

test("calculateCost applies over 200k context pricing when available", () => {
  const calculator = new CostCalculator({
    "anthropic/claude-sonnet-4-20250514": {
      input: 1,
      output: 2,
      cacheRead: 0.1,
      cacheWrite: 1,
      contextOver200k: { input: 2, output: 4, cacheRead: 0.2, cacheWrite: 2 },
    },
    default: { input: 1, output: 3, cacheWrite: 0, cacheRead: 0 },
  })

  const cost = calculator.calculateCost(
    baseAnalysis({
      pricingModelName: "anthropic/claude-sonnet-4-20250514",
      inputTokens: 1_000,
      outputTokens: 100,
      cacheReadTokens: 210_000,
      apiCallCount: 1,
      perModelUsage: [
        {
          providerID: "anthropic",
          modelID: "claude-sonnet-4-20250514",
          modelName: "anthropic/claude-sonnet-4-20250514",
          inputTokens: 1_000,
          outputTokens: 100,
          reasoningTokens: 0,
          cacheReadTokens: 210_000,
          cacheWriteTokens: 0,
          apiCost: 0,
          apiCallCount: 1,
          callsWithCacheRead: 1,
          callsWithCacheWrite: 0,
        },
      ],
    })
  )

  expect(cost.estimatedSessionCost).toBeCloseTo(0.0444)
  expect(cost.perModelCosts[0]?.pricePerMillionInput).toBe(2)
  expect(cost.perModelCosts[0]?.pricePerMillionCacheRead).toBe(0.2)
  expect(cost.perModelCosts[0]?.pricingTier).toBe("context_tier")
  expect(cost.perModelCosts[0]?.pricingTierThreshold).toBe(200_000)
})

test("calculateCost applies over 200k pricing per API call instead of aggregated totals", () => {
  const calculator = new CostCalculator({
    "anthropic/claude-sonnet-4-20250514": {
      input: 1,
      output: 2,
      cacheRead: 0.1,
      cacheWrite: 1,
      contextOver200k: { input: 2, output: 4, cacheRead: 0.2, cacheWrite: 2 },
    },
    default: { input: 1, output: 3, cacheWrite: 0, cacheRead: 0 },
  })

  const cost = calculator.calculateCost(
    baseAnalysis({
      pricingModelName: "anthropic/claude-sonnet-4-20250514",
      inputTokens: 300_000,
      outputTokens: 300,
      cacheReadTokens: 0,
      apiCallCount: 3,
      perModelUsage: [
        {
          providerID: "anthropic",
          modelID: "claude-sonnet-4-20250514",
          modelName: "anthropic/claude-sonnet-4-20250514",
          inputTokens: 300_000,
          outputTokens: 300,
          reasoningTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          apiCost: 0,
          apiCallCount: 3,
          callsWithCacheRead: 0,
          callsWithCacheWrite: 0,
          costSegments: [
            { inputTokens: 100_000, outputTokens: 100, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, apiCallCount: 1 },
            { inputTokens: 100_000, outputTokens: 100, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, apiCallCount: 1 },
            { inputTokens: 100_000, outputTokens: 100, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, apiCallCount: 1 },
          ],
        },
      ],
    })
  )

  expect(cost.estimatedSessionCost).toBeCloseTo(0.3006)
  expect(cost.perModelCosts[0]?.pricePerMillionInput).toBe(1)
  expect(cost.perModelCosts[0]?.pricingTier).toBeUndefined()
})

test("calculateCost uses custom context tier thresholds from live metadata", () => {
  const calculator = new CostCalculator({
    "provider/model": {
      input: 1,
      output: 2,
      cacheRead: 0.1,
      cacheWrite: 1,
      contextOver200k: { input: 3, output: 6, cacheRead: 0.3, cacheWrite: 3, threshold: 400_000 },
    },
    default: { input: 1, output: 3, cacheWrite: 0, cacheRead: 0 },
  })

  const belowThreshold = calculator.calculateCost(
    baseAnalysis({
      pricingModelName: "provider/model",
      inputTokens: 250_000,
      apiCallCount: 1,
      perModelUsage: [
        {
          providerID: "provider",
          modelID: "model",
          modelName: "provider/model",
          inputTokens: 250_000,
          outputTokens: 0,
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
  const aboveThreshold = calculator.calculateCost(
    baseAnalysis({
      pricingModelName: "provider/model",
      inputTokens: 450_000,
      apiCallCount: 1,
      perModelUsage: [
        {
          providerID: "provider",
          modelID: "model",
          modelName: "provider/model",
          inputTokens: 450_000,
          outputTokens: 0,
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

  expect(belowThreshold.estimatedSessionCost).toBeCloseTo(0.25)
  expect(belowThreshold.perModelCosts[0]?.pricingTier).toBeUndefined()
  expect(aboveThreshold.estimatedSessionCost).toBeCloseTo(1.35)
  expect(aboveThreshold.perModelCosts[0]?.pricingTier).toBe("context_tier")
  expect(aboveThreshold.perModelCosts[0]?.pricingTierThreshold).toBe(400_000)
})

test("calculateCost selects the largest matching context tier before the legacy 200K fallback", () => {
  const calculator = new CostCalculator({
    "provider/model": {
      input: 1,
      output: 2,
      cacheRead: 0.1,
      cacheWrite: 1,
      tiers: [
        { input: 3, output: 4, cacheRead: 0.3, cacheWrite: 0, threshold: 32_000 },
        { input: 5, output: 6, cacheRead: 0.5, cacheWrite: 0, threshold: 128_000 },
      ],
      contextOver200k: { input: 100, output: 100, cacheRead: 100, cacheWrite: 100 },
    },
  })

  const usage = {
    providerID: "provider",
    modelID: "model",
    modelName: "provider/model",
    inputTokens: 150_000,
    outputTokens: 1_000,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    apiCost: 0,
    apiCallCount: 1,
    callsWithCacheRead: 0,
    callsWithCacheWrite: 0,
  }
  const cost = calculator.calculateCost(
    baseAnalysis({
      pricingModelName: "provider/model",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      apiCallCount: 1,
      perModelUsage: [usage],
    })
  )

  expect(cost.estimatedSessionCost).toBeCloseTo(0.756)
  expect(cost.perModelCosts[0]?.pricePerMillionInput).toBe(5)
  expect(cost.perModelCosts[0]?.pricingTierThreshold).toBe(128_000)
})

test("calculateCost does not apply a context tier at its exact threshold", () => {
  const calculator = new CostCalculator({
    "provider/model": {
      input: 1,
      output: 2,
      cacheRead: 0.1,
      cacheWrite: 1,
      tiers: [{ input: 5, output: 6, cacheRead: 0.5, cacheWrite: 0, threshold: 128_000 }],
    },
  })
  const cost = calculator.calculateUsageCost(
    { inputTokens: 128_000, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    calculator.getPricing("provider/model")
  )

  expect(cost.estimatedSessionCost).toBeCloseTo(0.128)
  expect(cost.pricingTier).toBeUndefined()
})

test("pricing prefix matching requires a model-version boundary", () => {
  const calculator = new CostCalculator({
    "openai/gpt-5.1": { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 },
  })

  expect(calculator.hasPricing("openai/gpt-5.1-2025-01-01")).toBe(true)
  expect(calculator.hasPricing("openai/gpt-5.10")).toBe(false)
})

test("calculateCost reports effective blended rates for mixed context tiers", () => {
  const calculator = new CostCalculator({
    "anthropic/claude-sonnet-4-20250514": {
      input: 1,
      output: 2,
      cacheRead: 0.1,
      cacheWrite: 1,
      contextOver200k: { input: 2, output: 4, cacheRead: 0.2, cacheWrite: 2 },
    },
    default: { input: 1, output: 3, cacheWrite: 0, cacheRead: 0 },
  })

  const cost = calculator.calculateCost(
    baseAnalysis({
      pricingModelName: "anthropic/claude-sonnet-4-20250514",
      inputTokens: 350_000,
      outputTokens: 300,
      apiCallCount: 2,
      perModelUsage: [
        {
          providerID: "anthropic",
          modelID: "claude-sonnet-4-20250514",
          modelName: "anthropic/claude-sonnet-4-20250514",
          inputTokens: 350_000,
          outputTokens: 300,
          reasoningTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          apiCost: 0,
          apiCallCount: 2,
          callsWithCacheRead: 0,
          callsWithCacheWrite: 0,
          costSegments: [
            { inputTokens: 100_000, outputTokens: 100, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, apiCallCount: 1 },
            { inputTokens: 250_000, outputTokens: 200, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, apiCallCount: 1 },
          ],
        },
      ],
    })
  )

  expect(cost.estimatedSessionCost).toBeCloseTo(0.601)
  expect(cost.perModelCosts[0]?.pricingTier).toBe("mixed_context_tiers")
  expect(cost.perModelCosts[0]?.pricePerMillionInput).toBeCloseTo(1.7142857)
  expect(cost.perModelCosts[0]?.pricePerMillionOutput).toBeCloseTo(3.3333333)
})

test("cache efficiency uses per-call uncached context tiers for cached tokens", () => {
  const calculator = new CostCalculator({
    "anthropic/claude-sonnet-4-20250514": {
      input: 1,
      output: 2,
      cacheRead: 0.1,
      cacheWrite: 1,
      contextOver200k: { input: 2, output: 4, cacheRead: 0.2, cacheWrite: 2 },
    },
    default: { input: 1, output: 3, cacheWrite: 0, cacheRead: 0 },
  })

  const cost = calculator.calculateCost(
    baseAnalysis({
      pricingModelName: "anthropic/claude-sonnet-4-20250514",
      inputTokens: 100_000,
      cacheReadTokens: 250_000,
      apiCallCount: 2,
      perModelUsage: [
        {
          providerID: "anthropic",
          modelID: "claude-sonnet-4-20250514",
          modelName: "anthropic/claude-sonnet-4-20250514",
          inputTokens: 100_000,
          outputTokens: 0,
          reasoningTokens: 0,
          cacheReadTokens: 250_000,
          cacheWriteTokens: 0,
          apiCost: 0,
          apiCallCount: 2,
          callsWithCacheRead: 1,
          callsWithCacheWrite: 0,
          costSegments: [
            { inputTokens: 100_000, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, apiCallCount: 1 },
            { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 250_000, cacheWriteTokens: 0, apiCallCount: 1 },
          ],
        },
      ],
    })
  )

  const efficiency = calculateModelAwareCacheEfficiency(
    {
      cacheReadTokens: 250_000,
      freshInputTokens: 100_000,
      cacheWriteTokens: 0,
      totalInputTokens: 350_000,
      cacheHitRate: 71.4,
      costWithoutCaching: 0,
      costWithCaching: 0,
      costSavings: 0,
      savingsPercent: 0,
      effectiveRate: 0,
      standardRate: 1,
    },
    cost
  )

  expect(cost.perModelCosts[0]?.estimatedInputCostWithoutCaching).toBeCloseTo(0.6)
  expect(efficiency.costWithoutCaching).toBeCloseTo(0.6)
  expect(efficiency.costWithCaching).toBeCloseTo(0.15)

  const lines = formatCacheEfficiency(
    {
      cacheReadTokens: 250_000,
      freshInputTokens: 100_000,
      cacheWriteTokens: 0,
      totalInputTokens: 350_000,
      cacheHitRate: 71.4,
      costWithoutCaching: 0,
      costWithCaching: 0,
      costSavings: 0,
      savingsPercent: 0,
      effectiveRate: 0,
      standardRate: 1,
    },
    cost,
    "claude-sonnet-4-20250514"
  )

  expect(lines.join("\n")).toContain("350,000 tokens x $1.71428571/M")
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
