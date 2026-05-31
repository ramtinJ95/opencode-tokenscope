import { expect, test } from "bun:test"

import { ContextAnalyzer } from "../tokenscope-lib/context.js"
import type { ExportedSession, TokenModel } from "../tokenscope-lib/types.js"

const tokenModel: TokenModel = { name: "test", spec: { kind: "approx" } }

const tokenizer = {
  async countTokens(content: string) {
    return content.trim().split(/\s+/).filter(Boolean).length
  },
} as any

test("context breakdown ignores user system overrides as generated OpenCode context", async () => {
  const analyzer = new ContextAnalyzer(tokenizer)
  const exported: ExportedSession = {
    info: { id: "ses_test", title: "test" },
    messages: [
      {
        info: { id: "msg_user", role: "user", system: "You are a terse assistant." },
        parts: [{ type: "text" }],
      },
      {
        info: { id: "msg_assistant", role: "assistant" },
        parts: [
          {
            type: "step-finish",
            tokens: { input: 100, output: 10, cache: { read: 0, write: 2_000 }, reasoning: 0 },
          } as any,
        ],
      },
    ],
  }

  const breakdown = await (analyzer as any).analyzeContextBreakdown(exported, tokenModel, [
    { id: "read", description: "Read files", parameters: { type: "object", properties: { filePath: { type: "string" } } } },
  ])

  expect(breakdown.totalCachedContext).toBe(2_000)
  expect(breakdown.baseSystemPrompt.tokens).toBeGreaterThan(0)
  expect(breakdown.toolDefinitions.toolCount).toBe(1)
})

test("context breakdown preserves generated base prompt fragments and merges tool metadata", async () => {
  const analyzer = new ContextAnalyzer(tokenizer)
  const exported: ExportedSession = {
    info: { id: "ses_test", title: "test" },
    messages: [
      {
        info: {
          id: "msg_user",
          role: "user",
          tools: { read: true, write: false },
          system: [
            "You are opencode, an AI coding agent built for software engineering tasks. Follow project instructions carefully.",
            "<env>\nWorking directory: /tmp/project\nPlatform: darwin\n</env>",
          ],
        },
        parts: [{ type: "text" }],
      },
    ],
  }
  const tools = [
    { id: "read", description: "Read files", parameters: { type: "object", properties: { filePath: { type: "string" } } } },
    { id: "write", description: "Write files", parameters: { type: "object", properties: { filePath: { type: "string" } } } },
  ]

  await (analyzer as any).precomputeToolDefinitionTokens(tools, tokenModel)
  const breakdown = await (analyzer as any).analyzeContextBreakdown(exported, tokenModel, tools)

  expect(breakdown.baseSystemPrompt.tokens).toBeGreaterThan(0)
  expect(breakdown.environmentContext.tokens).toBeGreaterThan(0)
  expect(breakdown.toolDefinitions.toolCount).toBe(2)
  expect(breakdown.toolDefinitions.tokens).toBeGreaterThan(0)
})

test("tool schema estimates keep current OpenCode tool metadata visible despite permission overrides", async () => {
  const analyzer = new ContextAnalyzer(tokenizer)
  const exported: ExportedSession = {
    info: { id: "ses_test", title: "test" },
    messages: [
      {
        info: { id: "msg_user", role: "user", tools: { read: true, write: false } },
        parts: [{ type: "text" }],
      },
    ],
  }

  const estimates = await (analyzer as any).estimateToolSchemas(exported, tokenModel, [
    { id: "read", description: "Read files", parameters: { type: "object", properties: { filePath: { type: "string" } } } },
    { id: "write", description: "Write files", parameters: { type: "object", properties: { filePath: { type: "string" } } } },
  ])

  expect(estimates.find((estimate: any) => estimate.name === "read")?.enabled).toBe(true)
  expect(estimates.find((estimate: any) => estimate.name === "write")?.enabled).toBe(true)
})

test("single env-like user override still falls back to cache telemetry", async () => {
  const analyzer = new ContextAnalyzer(tokenizer)
  const exported: ExportedSession = {
    info: { id: "ses_test", title: "test" },
    messages: [
      {
        info: { id: "msg_user", role: "user", system: "<env>\nPlease explain what this XML tag means.\n</env>" },
        parts: [{ type: "text" }],
      },
      {
        info: { id: "msg_assistant", role: "assistant" },
        parts: [
          {
            type: "step-finish",
            tokens: { input: 100, output: 10, cache: { read: 0, write: 2_000 }, reasoning: 0 },
          } as any,
        ],
      },
    ],
  }

  const breakdown = await (analyzer as any).analyzeContextBreakdown(exported, tokenModel, [])

  expect(breakdown.totalCachedContext).toBe(2_000)
  expect(breakdown.environmentContext.identified).toBe(false)
})

test("context analysis selects the model from the first cache write call", () => {
  const analyzer = new ContextAnalyzer(tokenizer)
  const exported: ExportedSession = {
    info: { id: "ses_test", title: "test" },
    messages: [
      {
        info: { id: "msg_first", role: "assistant", model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" } },
        parts: [
          {
            type: "step-finish",
            tokens: { input: 100, output: 10, cache: { read: 0, write: 2_000 }, reasoning: 0 },
          } as any,
        ],
      },
      {
        info: { id: "msg_second", role: "assistant", model: { providerID: "openai", modelID: "gpt-5.4-mini" } },
        parts: [
          {
            type: "step-finish",
            tokens: { input: 100, output: 10, cache: { read: 2_000, write: 0 }, reasoning: 0 },
          } as any,
        ],
      },
    ],
  }

  expect((analyzer as any).firstCacheWriteModel(exported)).toEqual({
    providerID: "anthropic",
    modelID: "claude-sonnet-4-20250514",
  })
})
