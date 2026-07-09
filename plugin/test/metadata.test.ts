import { expect, test } from "bun:test"

import { ModelMetadataResolver } from "../tokenscope-lib/metadata.js"

test("ModelMetadataResolver merges live provider pricing over bundled pricing", async () => {
  const client = {
    provider: {
      async list() {
        return {
          all: [
            {
              id: "anthropic",
              models: {
                "claude-sonnet-4-20250514": {
                  id: "claude-sonnet-4-20250514",
                  cost: {
                    input: 3,
                    output: 15,
                    cache_read: 0.3,
                    cache_write: 3.75,
                    context_over_200k: {
                      input: 6,
                      output: 22.5,
                      cache_read: 0.6,
                      cache_write: 7.5,
                    },
                  },
                  limit: { context: 200_000, output: 64_000 },
                },
              },
            },
          ],
        }
      },
    },
  }

  const resolver = new ModelMetadataResolver(client, { directory: "/tmp/project" })
  const pricing = await resolver.mergePricingData({
    default: { input: 1, output: 3, cacheRead: 0, cacheWrite: 0 },
    "anthropic/claude-sonnet-4-20250514": { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
  })

  expect(pricing["anthropic/claude-sonnet-4-20250514"]).toEqual({
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 3.75,
    contextWindow: 200_000,
    contextOver200k: {
      input: 6,
      output: 22.5,
      cacheRead: 0.6,
      cacheWrite: 7.5,
    },
  })
})

test("ModelMetadataResolver reads current OpenCode nested cache and tier pricing", async () => {
  const client = {
    provider: {
      async list() {
        return {
          all: [
            {
              id: "anthropic",
              models: {
                "claude-sonnet-4-20250514": {
                  id: "claude-sonnet-4-20250514",
                  cost: {
                    input: 3,
                    output: 15,
                    cache: { read: 0.3, write: 3.75 },
                    tiers: [
                      {
                        input: 6,
                        output: 22.5,
                        cache: { read: 0.6, write: 7.5 },
                        tier: { type: "context", size: 200_000 },
                      },
                    ],
                  },
                  limit: { context: 1_000_000, output: 64_000 },
                },
              },
            },
          ],
        }
      },
    },
  }

  const resolver = new ModelMetadataResolver(client)
  const pricing = await resolver.mergePricingData({
    "anthropic/claude-sonnet-4-20250514": { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
  })

  expect(pricing["anthropic/claude-sonnet-4-20250514"]).toEqual({
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 3.75,
    contextWindow: 1_000_000,
    tiers: [{ input: 6, output: 22.5, cacheRead: 0.6, cacheWrite: 7.5, threshold: 200_000 }],
    contextOver200k: undefined,
  })
})

test("ModelMetadataResolver preserves arbitrary context tier thresholds", async () => {
  const client = {
    provider: {
      async list() {
        return {
          all: [
            {
              id: "provider",
              models: {
                model: {
                  id: "model",
                  cost: {
                    input: 1,
                    output: 2,
                    cache: { read: 0.1, write: 1 },
                    tiers: [
                      {
                        input: 3,
                        output: 6,
                        cache: { read: 0.3, write: 3 },
                        tier: { type: "context", size: 400_000 },
                      },
                    ],
                  },
                },
              },
            },
          ],
        }
      },
    },
  }

  const pricing = await new ModelMetadataResolver(client).mergePricingData({})

  expect(pricing["provider/model"]?.tiers).toEqual([
    { input: 3, output: 6, cacheRead: 0.3, cacheWrite: 3, threshold: 400_000 },
  ])
})

test("ModelMetadataResolver retains multiple sub-200K tiers ahead of the legacy fallback", async () => {
  const client = {
    provider: {
      async list() {
        return {
          all: [
            {
              id: "provider",
              models: {
                model: {
                  id: "model",
                  cost: {
                    input: 1,
                    output: 2,
                    cache: { read: 0.1, write: 1 },
                    tiers: [
                      { input: 3, output: 4, tier: { type: "context", size: 32_000 } },
                      {
                        input: 5,
                        output: 6,
                        cache: { read: 0.5, write: 2 },
                        tier: { type: "context", size: 128_000 },
                      },
                    ],
                    experimentalOver200K: {
                      input: 100,
                      output: 100,
                      cache: { read: 100, write: 100 },
                    },
                  },
                },
              },
            },
          ],
        }
      },
    },
  }

  const pricing = await new ModelMetadataResolver(client).mergePricingData({})

  expect(pricing["provider/model"]?.tiers).toEqual([
    { input: 3, output: 4, cacheRead: 0, cacheWrite: 0, threshold: 32_000 },
    { input: 5, output: 6, cacheRead: 0.5, cacheWrite: 2, threshold: 128_000 },
  ])
  expect(pricing["provider/model"]?.contextOver200k).toEqual({
    input: 100,
    output: 100,
    cacheRead: 100,
    cacheWrite: 100,
  })
})

test("ModelMetadataResolver indexes live pricing by both provider model key and API model id", async () => {
  const client = {
    provider: {
      async list() {
        return {
          all: [
            {
              id: "openai-compatible",
              models: {
                configuredAlias: {
                  id: "api-model-id",
                  cost: { input: 2, output: 8, cache: { read: 0.2, write: 2 } },
                },
              },
            },
          ],
        }
      },
    },
  }

  const pricing = await new ModelMetadataResolver(client).mergePricingData({})

  expect(pricing["openai-compatible/configuredalias"]).toMatchObject({ input: 2, output: 8, cacheRead: 0.2, cacheWrite: 2 })
  expect(pricing["openai-compatible/api-model-id"]).toMatchObject({ input: 2, output: 8, cacheRead: 0.2, cacheWrite: 2 })
})

test("ModelMetadataResolver prefers current OpenCode experimentalOver200K pricing", async () => {
  const client = {
    provider: {
      async list() {
        return {
          all: [
            {
              id: "anthropic",
              models: {
                "claude-sonnet-4-20250514": {
                  id: "claude-sonnet-4-20250514",
                  cost: {
                    input: 3,
                    output: 15,
                    cache: { read: 0.3, write: 3.75 },
                    experimentalOver200K: {
                      input: 6,
                      output: 22.5,
                      cache: { read: 0.6, write: 7.5 },
                    },
                  },
                },
              },
            },
          ],
        }
      },
    },
  }

  const resolver = new ModelMetadataResolver(client)
  const pricing = await resolver.mergePricingData({
    "anthropic/claude-sonnet-4-20250514": { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
  })

  expect(pricing["anthropic/claude-sonnet-4-20250514"]?.contextOver200k).toEqual({
    input: 6,
    output: 22.5,
    cacheRead: 0.6,
    cacheWrite: 7.5,
  })
})

test("ModelMetadataResolver keeps bundled pricing when provider metadata is unavailable", async () => {
  const client = {
    provider: {
      async list() {
        throw new Error("offline")
      },
    },
  }

  const bundled = { default: { input: 1, output: 3, cacheRead: 0, cacheWrite: 0 } }
  const resolver = new ModelMetadataResolver(client)

  await expect(resolver.mergePricingData(bundled)).resolves.toBe(bundled)
})

test("ModelMetadataResolver skips live metadata without required input and output rates for unknown models", async () => {
  const client = {
    provider: {
      async list() {
        return {
          all: [
            {
              id: "custom",
              models: {
                incomplete: {
                  id: "incomplete",
                  cost: { cache: { read: 0.2, write: 2 } },
                },
              },
            },
          ],
        }
      },
    },
  }

  const pricing = await new ModelMetadataResolver(client).mergePricingData({
    default: { input: 1, output: 3, cacheRead: 0, cacheWrite: 0 },
  })

  expect(pricing["custom/incomplete"]).toBeUndefined()
})

test("ModelMetadataResolver can merge incomplete live metadata into bundled pricing", async () => {
  const client = {
    provider: {
      async list() {
        return {
          all: [
            {
              id: "custom",
              models: {
                known: {
                  id: "known",
                  cost: { cache: { read: 0.2, write: 2 } },
                  limit: { context: 100_000, output: 8_000 },
                },
              },
            },
          ],
        }
      },
    },
  }

  const pricing = await new ModelMetadataResolver(client).mergePricingData({
    "custom/known": { input: 5, output: 10, cacheRead: 0.5, cacheWrite: 5 },
  })

  expect(pricing["custom/known"]).toEqual({
    input: 5,
    output: 10,
    cacheRead: 0.2,
    cacheWrite: 2,
    contextWindow: 100_000,
    contextOver200k: undefined,
  })
})

test("ModelMetadataResolver uses bare bundled aliases for incomplete provider pricing", async () => {
  const client = {
    provider: {
      async list() {
        return {
          all: [
            {
              id: "custom",
              models: {
                known: {
                  id: "known",
                  cost: { cache: { read: 0.2, write: 2 } },
                },
              },
            },
          ],
        }
      },
    },
  }

  const pricing = await new ModelMetadataResolver(client).mergePricingData({
    known: { input: 5, output: 10, cacheRead: 0.5, cacheWrite: 5 },
  })

  expect(pricing["custom/known"]).toEqual({
    input: 5,
    output: 10,
    cacheRead: 0.2,
    cacheWrite: 2,
    contextWindow: undefined,
    contextOver200k: undefined,
  })
})

test("ModelMetadataResolver uses provider bundled pricing for partial live bare aliases", async () => {
  const client = {
    provider: {
      async list() {
        return {
          all: [
            {
              id: "custom",
              models: {
                known: {
                  id: "known",
                  cost: { cache: { read: 0.2, write: 2 } },
                },
              },
            },
          ],
        }
      },
    },
  }

  const pricing = await new ModelMetadataResolver(client).mergePricingData({
    "custom/known": { input: 5, output: 10, cacheRead: 0.5, cacheWrite: 5 },
  })

  expect(pricing.known).toEqual({
    input: 5,
    output: 10,
    cacheRead: 0.2,
    cacheWrite: 2,
    contextWindow: undefined,
    contextOver200k: undefined,
  })
})

test("ModelMetadataResolver preserves bundled cache pricing when live metadata omits cache rates", async () => {
  const client = {
    provider: {
      async list() {
        return {
          all: [
            {
              id: "anthropic",
              models: {
                "claude-sonnet-4-20250514": {
                  id: "claude-sonnet-4-20250514",
                  cost: { input: 4, output: 16 },
                  limit: { context: 200_000, output: 64_000 },
                },
              },
            },
          ],
        }
      },
    },
  }

  const resolver = new ModelMetadataResolver(client)
  const pricing = await resolver.mergePricingData({
    "anthropic/claude-sonnet-4-20250514": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  })

  expect(pricing["anthropic/claude-sonnet-4-20250514"]).toEqual({
    input: 4,
    output: 16,
    cacheRead: 0.3,
    cacheWrite: 3.75,
    contextWindow: 200_000,
    contextOver200k: undefined,
  })
})

test("ModelMetadataResolver updates bundled bare model aliases with live pricing", async () => {
  const client = {
    provider: {
      async list() {
        return {
          all: [
            {
              id: "anthropic",
              models: {
                "claude-sonnet-4-20250514": {
                  id: "claude-sonnet-4-20250514",
                  cost: { input: 4, output: 16, cache_read: 0.4, cache_write: 4 },
                },
              },
            },
          ],
        }
      },
    },
  }

  const resolver = new ModelMetadataResolver(client)
  const pricing = await resolver.mergePricingData({
    "claude-sonnet-4-20250514": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    "anthropic/claude-sonnet-4-20250514": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  })

  expect(pricing["claude-sonnet-4-20250514"]).toMatchObject({ input: 4, output: 16, cacheRead: 0.4, cacheWrite: 4 })
  expect(pricing["anthropic/claude-sonnet-4-20250514"]).toMatchObject({ input: 4, output: 16, cacheRead: 0.4, cacheWrite: 4 })
})

test("ModelMetadataResolver keeps bundled pricing when live provider metadata reports zero subscription rates", async () => {
  const client = {
    provider: {
      async list() {
        return {
          all: [
            {
              id: "openai",
              models: {
                "gpt-5.4-mini": {
                  id: "gpt-5.4-mini",
                  cost: {
                    input: 0,
                    output: 0,
                    cache: { read: 0, write: 0 },
                  },
                },
              },
            },
          ],
        }
      },
    },
  }

  const bundled = {
    default: { input: 1, output: 3, cacheRead: 0, cacheWrite: 0 },
    "openai/gpt-5.4-mini": { input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0 },
  }

  const pricing = await new ModelMetadataResolver(client).mergePricingData(bundled)

  expect(pricing["openai/gpt-5.4-mini"]).toEqual(bundled["openai/gpt-5.4-mini"])
})

test("ModelMetadataResolver does not overwrite bare aliases when live model IDs are ambiguous", async () => {
  const client = {
    provider: {
      async list() {
        return {
          all: [
            { id: "provider-a", models: { shared: { id: "shared", cost: { input: 4, output: 16 } } } },
            { id: "provider-b", models: { shared: { id: "shared", cost: { input: 8, output: 32 } } } },
          ],
        }
      },
    },
  }

  const resolver = new ModelMetadataResolver(client)
  const pricing = await resolver.mergePricingData({
    shared: { input: 1, output: 3, cacheRead: 0.1, cacheWrite: 1 },
  })

  expect(pricing.shared).toEqual({ input: 1, output: 3, cacheRead: 0.1, cacheWrite: 1 })
  expect(pricing["provider-a/shared"]).toMatchObject({ input: 4, output: 16 })
  expect(pricing["provider-b/shared"]).toMatchObject({ input: 8, output: 32 })
})

test("ModelMetadataResolver maps omitted legacy context cache rates to zero like OpenCode", async () => {
  const client = {
    provider: {
      async list() {
        return {
          all: [
            {
              id: "anthropic",
              models: {
                "claude-sonnet-4-20250514": {
                  id: "claude-sonnet-4-20250514",
                  cost: {
                    input: 4,
                    output: 16,
                    context_over_200k: { input: 8, output: 24 },
                  },
                },
              },
            },
          ],
        }
      },
    },
  }

  const resolver = new ModelMetadataResolver(client)
  const pricing = await resolver.mergePricingData({
    "anthropic/claude-sonnet-4-20250514": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  })

  expect(pricing["anthropic/claude-sonnet-4-20250514"]?.contextOver200k).toEqual({
    input: 8,
    output: 24,
    cacheRead: 0,
    cacheWrite: 0,
  })
})
