import { expect, test } from "bun:test"

import { ContextAnalyzer } from "../tokenscope-lib/context.js"
import type { RequestSnapshot, SessionMessage, TokenModel, TokenscopeConfig } from "../tokenscope-lib/types.js"
import { WarningCollector } from "../tokenscope-lib/warnings.js"

const tokenModel: TokenModel = { name: "test", spec: { kind: "approx" } }
const pricing = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
const config: TokenscopeConfig = {
  enableContextBreakdown: true,
  enableToolSchemaEstimation: true,
  enableCacheEfficiency: true,
  enableSubagentAnalysis: true,
  enableDetailedSubagentCostBreakdown: false,
  enableSkillAnalysis: true,
}

// Counts whitespace-separated words so expected token counts are easy to read.
const tokenizer = {
  async countTokens(content: string) {
    return content.trim().split(/\s+/).filter(Boolean).length
  },
} as any

const snapshot: RequestSnapshot = {
  system: [
    { text: "You are OpenCode the coding agent" },
    {
      text: "joined instruction text",
      instructions: [
        { key: "core/date", text: "Today's date: Tue" },
        { key: "core/environment", text: "<env> Working directory: /tmp/project </env>" },
        {
          key: "core/instructions",
          text: "Instructions from: /tmp/project/AGENTS.md\nBe terse\n\nInstructions from: /home/me/.config/opencode/AGENTS.md\nNo emojis",
        },
        { key: "api/deploy-target", text: "production cluster" },
        { key: "core/skill-guidance", text: "Skills provide specialized instructions" },
        { key: "core/mcp-guidance", text: "MCP servers available" },
      ],
    },
  ],
  tools: [
    {
      id: "read",
      description: "Read a file",
      schema: { type: "object", properties: { filePath: { type: "string" }, offset: { type: "number" } } },
    },
    {
      id: "edit",
      description: "Edit a file",
      schema: { type: "object", properties: { edits: { type: "array", items: { type: "object" } } } },
    },
  ],
}

function assistant(id: string, tokens: SessionMessage["info"]["tokens"], parts: SessionMessage["parts"] = []): SessionMessage {
  return {
    info: { id, role: "assistant", model: { providerID: "anthropic", modelID: "claude-sonnet-4" }, tokens, cost: 0 },
    parts,
  }
}

const transcript: SessionMessage[] = [
  { info: { id: "msg_user", role: "user" }, parts: [{ type: "text", text: "fix the bug" }] },
  assistant("msg_1", { input: 100, output: 10, reasoning: 0, cache: { read: 0, write: 2_000 } }, [
    { type: "tool", tool: "read", state: { status: "completed", input: { filePath: "a.ts" }, output: "contents" } },
    { type: "tool", tool: "edit", state: { status: "completed", input: { filePath: "a.ts", edits: [{}] }, output: "ok" } },
  ]),
  assistant("msg_2", { input: 50, output: 20, reasoning: 0, cache: { read: 2_000, write: 0 } }),
]

test("context breakdown is measured per source when a model request was captured", async () => {
  const warnings = new WarningCollector()
  const analyzer = new ContextAnalyzer(tokenizer, warnings)

  const { contextBreakdown } = await analyzer.analyze({
    sessionID: "ses_test",
    messages: transcript,
    snapshot,
    tokenModel,
    pricing,
    config,
  })

  expect(contextBreakdown?.baseSystemPrompt).toEqual({ tokens: 6, identified: true })
  expect(contextBreakdown?.environmentContext).toEqual({
    tokens: 3 + 5,
    identified: true,
    components: ["core/date", "core/environment"],
  })
  expect(contextBreakdown?.customInstructions).toEqual({
    tokens: 10 + 2,
    identified: true,
    sources: ["/tmp/project/AGENTS.md", "/home/me/.config/opencode/AGENTS.md", "api/deploy-target"],
  })
  expect(contextBreakdown?.guidance).toEqual({
    tokens: 4 + 3,
    identified: true,
    sources: ["core/skill-guidance", "core/mcp-guidance"],
  })
  expect(contextBreakdown?.toolDefinitions.toolCount).toBe(2)
  expect(contextBreakdown?.toolDefinitions.tokens).toBeGreaterThan(0)
  expect(contextBreakdown?.totalCachedContext).toBe(6 + 8 + 12 + 7 + contextBreakdown!.toolDefinitions.tokens)
  expect(warnings.list()).toEqual([])
})

test("tool schema sizes are tokenized from the captured tool definitions", async () => {
  const analyzer = new ContextAnalyzer(tokenizer)

  const { toolEstimates, contextBreakdown } = await analyzer.analyze({
    sessionID: "ses_test",
    messages: transcript,
    snapshot,
    tokenModel,
    pricing,
    config,
  })

  expect(toolEstimates?.map((estimate) => estimate.name).sort()).toEqual(["edit", "read"])
  expect(toolEstimates?.every((estimate) => estimate.source === "model-request")).toBe(true)
  expect(toolEstimates?.find((estimate) => estimate.name === "read")).toMatchObject({
    argumentCount: 2,
    hasComplexArgs: false,
  })
  expect(toolEstimates?.find((estimate) => estimate.name === "edit")).toMatchObject({
    argumentCount: 1,
    hasComplexArgs: true,
  })
  expect(toolEstimates?.reduce((sum, estimate) => sum + estimate.estimatedTokens, 0)).toBe(
    contextBreakdown!.toolDefinitions.tokens
  )
})

test("context falls back to cache-write and transcript estimates, with a warning, when no request was captured", async () => {
  const warnings = new WarningCollector()
  const analyzer = new ContextAnalyzer(tokenizer, warnings)

  const { contextBreakdown, toolEstimates } = await analyzer.analyze({
    sessionID: "ses_other",
    messages: transcript,
    tokenModel,
    pricing,
    config,
  })

  // read: 200 base + 1 simple arg (30) + simple bonus (80); edit: 200 + 30 + 60 + complex bonus (120)
  expect(toolEstimates).toEqual([
    { name: "edit", enabled: true, estimatedTokens: 410, argumentCount: 2, hasComplexArgs: true, source: "transcript" },
    { name: "read", enabled: true, estimatedTokens: 310, argumentCount: 1, hasComplexArgs: false, source: "transcript" },
  ])
  expect(contextBreakdown?.totalCachedContext).toBe(2_000)
  expect(contextBreakdown?.toolDefinitions).toEqual({ tokens: 720, identified: false, toolCount: 2 })
  expect(contextBreakdown?.environmentContext.tokens).toBe(150)
  expect(contextBreakdown?.baseSystemPrompt).toEqual({ tokens: 2_000 - 720 - 150, identified: false })
  expect(warnings.list()).toHaveLength(1)
  expect(warnings.list()[0]).toContain("No model request has been observed for session ses_other")
})

test("cache efficiency is computed from transcript telemetry", async () => {
  const analyzer = new ContextAnalyzer(tokenizer)

  const { cacheEfficiency, contextBreakdown, toolEstimates } = await analyzer.analyze({
    sessionID: "ses_test",
    messages: transcript,
    tokenModel,
    pricing,
    config: { ...config, enableContextBreakdown: false, enableToolSchemaEstimation: false },
  })

  expect(contextBreakdown).toBeUndefined()
  expect(toolEstimates).toBeUndefined()
  expect(cacheEfficiency).toMatchObject({
    cacheReadTokens: 2_000,
    freshInputTokens: 150,
    cacheWriteTokens: 2_000,
    totalInputTokens: 4_150,
  })
  expect(cacheEfficiency?.cacheHitRate).toBeCloseTo((2_000 / 2_150) * 100)
})
