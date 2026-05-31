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
    contextOver200k: {
      input: 6,
      output: 22.5,
      cacheRead: 0.6,
      cacheWrite: 7.5,
    },
  })
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

test("ModelMetadataResolver merges partial 200K context pricing against normal cache rates", async () => {
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
    cacheRead: 0.3,
    cacheWrite: 3.75,
  })
})
