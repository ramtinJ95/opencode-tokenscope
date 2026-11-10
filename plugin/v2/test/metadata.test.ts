import { expect, test } from "bun:test"

import { ModelMetadataResolver } from "../tokenscope-lib/metadata.js"
import type { ModelReader } from "../tokenscope-lib/opencode.js"
import { WarningCollector } from "../tokenscope-lib/warnings.js"

type CostTier = {
  tier?: { type: "context"; size: number }
  input: number
  output: number
  cache: { read: number; write: number }
}

function model(providerID: string, id: string, cost: CostTier[], overrides: Record<string, unknown> = {}) {
  return { id, modelID: id, providerID, name: id, cost, limit: { context: 200_000, output: 64_000 }, ...overrides }
}

function catalog(models: unknown[]): ModelReader {
  return {
    async list() {
      return { location: { directory: "/tmp/project" }, data: models }
    },
  } as unknown as ModelReader
}

const SONNET = "anthropic/claude-sonnet-4-20250514"

test("ModelMetadataResolver merges live model catalog pricing over bundled pricing", async () => {
  const resolver = new ModelMetadataResolver(
    catalog([
      model("anthropic", "claude-sonnet-4-20250514", [
        { input: 3, output: 15, cache: { read: 0.3, write: 3.75 } },
        { tier: { type: "context", size: 200_000 }, input: 6, output: 22.5, cache: { read: 0.6, write: 7.5 } },
      ]),
    ])
  )

  const pricing = await resolver.mergePricingData({
    default: { input: 1, output: 3, cacheRead: 0, cacheWrite: 0 },
    [SONNET]: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
  })

  expect(pricing[SONNET]).toEqual({
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 3.75,
    contextWindow: 200_000,
    tiers: [{ input: 6, output: 22.5, cacheRead: 0.6, cacheWrite: 7.5, threshold: 200_000 }],
  })
})

test("ModelMetadataResolver keeps every context tier, sorted by threshold", async () => {
  const resolver = new ModelMetadataResolver(
    catalog([
      model("openai", "gpt-5.4", [
        { input: 2.5, output: 15, cache: { read: 0.25, write: 0 } },
        { tier: { type: "context", size: 128_000 }, input: 3, output: 16, cache: { read: 0.3, write: 0 } },
        { tier: { type: "context", size: 400_000 }, input: 10, output: 45, cache: { read: 1, write: 0 } },
        { tier: { type: "context", size: 272_000 }, input: 5, output: 22.5, cache: { read: 0.5, write: 0 } },
      ]),
    ])
  )

  const pricing = await resolver.mergePricingData({})

  expect(pricing["openai/gpt-5.4"]?.tiers).toEqual([
    { input: 3, output: 16, cacheRead: 0.3, cacheWrite: 0, threshold: 128_000 },
    { input: 5, output: 22.5, cacheRead: 0.5, cacheWrite: 0, threshold: 272_000 },
    { input: 10, output: 45, cacheRead: 1, cacheWrite: 0, threshold: 400_000 },
  ])
  expect(pricing["openai/gpt-5.4"]?.contextOver200k).toBeUndefined()
})

test("ModelMetadataResolver indexes live pricing by both the catalog ID and the provider API model ID", async () => {
  const resolver = new ModelMetadataResolver(
    catalog([
      model("anthropic", "claude-sonnet-4", [{ input: 3, output: 15, cache: { read: 0.3, write: 3.75 } }], {
        modelID: "claude-sonnet-4-20250514",
      }),
    ])
  )

  const pricing = await resolver.mergePricingData({})

  expect(pricing["anthropic/claude-sonnet-4"]).toMatchObject({ input: 3, output: 15 })
  expect(pricing[SONNET]).toMatchObject({ input: 3, output: 15 })
})

test("ModelMetadataResolver keeps bundled pricing and warns when the model catalog is unavailable", async () => {
  const warnings = new WarningCollector()
  const failing = {
    async list() {
      throw new Error("catalog offline")
    },
  } as unknown as ModelReader
  const bundled = { [SONNET]: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } }

  const pricing = await new ModelMetadataResolver(failing, warnings).mergePricingData(bundled)

  expect(pricing).toBe(bundled)
  expect(warnings.list().join("\n")).toContain("catalog offline")
})

test("ModelMetadataResolver skips models that report no base price", async () => {
  const resolver = new ModelMetadataResolver(catalog([model("local", "llama-custom", [])]))
  const bundled = { default: { input: 1, output: 3, cacheRead: 0, cacheWrite: 0 } }

  const pricing = await resolver.mergePricingData(bundled)

  expect(pricing["local/llama-custom"]).toBeUndefined()
})

test("ModelMetadataResolver keeps the bundled context tier when the live catalog reports none", async () => {
  const resolver = new ModelMetadataResolver(
    catalog([model("anthropic", "claude-sonnet-4-20250514", [{ input: 3, output: 15, cache: { read: 0.3, write: 3.75 } }])])
  )

  const pricing = await resolver.mergePricingData({
    [SONNET]: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      contextOver200k: { input: 6, output: 22.5, cacheRead: 0.6, cacheWrite: 7.5 },
    },
  })

  expect(pricing[SONNET]).toMatchObject({
    input: 3,
    output: 15,
    contextOver200k: { input: 6, output: 22.5, cacheRead: 0.6, cacheWrite: 7.5 },
  })
})

test("ModelMetadataResolver updates bundled bare model aliases with live pricing", async () => {
  const resolver = new ModelMetadataResolver(
    catalog([model("anthropic", "claude-sonnet-4-20250514", [{ input: 3, output: 15, cache: { read: 0.3, write: 3.75 } }])])
  )

  const pricing = await resolver.mergePricingData({
    "claude-sonnet-4-20250514": { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
  })

  expect(pricing["claude-sonnet-4-20250514"]).toMatchObject({ input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 })
  expect(pricing[SONNET]).toMatchObject({ input: 3, output: 15 })
})

test("ModelMetadataResolver keeps bundled pricing when a subscription provider reports zero rates", async () => {
  const resolver = new ModelMetadataResolver(
    catalog([model("anthropic", "claude-sonnet-4-20250514", [{ input: 0, output: 0, cache: { read: 0, write: 0 } }])])
  )
  const bundledRates = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }

  const pricing = await resolver.mergePricingData({ [SONNET]: bundledRates })

  expect(pricing[SONNET]).toEqual(bundledRates)
})

test("ModelMetadataResolver does not overwrite bare aliases when live model IDs are ambiguous", async () => {
  const resolver = new ModelMetadataResolver(
    catalog([
      model("openai", "gpt-5.4", [{ input: 2.5, output: 15, cache: { read: 0.25, write: 0 } }]),
      model("azure", "gpt-5.4", [{ input: 9, output: 90, cache: { read: 0.9, write: 0 } }]),
    ])
  )
  const bundledAlias = { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 }

  const pricing = await resolver.mergePricingData({ "gpt-5.4": bundledAlias })

  expect(pricing["gpt-5.4"]).toEqual(bundledAlias)
  expect(pricing["openai/gpt-5.4"]).toMatchObject({ input: 2.5 })
  expect(pricing["azure/gpt-5.4"]).toMatchObject({ input: 9 })
})
