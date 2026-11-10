import { expect, test } from "bun:test"

import { DEFAULT_TOKENSCOPE_CONFIG } from "../tokenscope-lib/config.js"
import { CostCalculator } from "../tokenscope-lib/cost.js"
import type { TokenAnalysis } from "../tokenscope-lib/types.js"
import { toError } from "../tokenscope-lib/rpc.js"
import { apportion, buildReportView } from "../tokenscope-lib/view.js"
import { buildFormatterFixtureAnalysis } from "./formatter.fixture.js"

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
const tokensOf = (rows: Array<{ tokens: number }>) => rows.map((row) => row.tokens)

function category(label: string, entries: Array<{ label: string; tokens: number }>) {
  return { label, totalTokens: sum(tokensOf(entries)), entries, allEntries: entries }
}

// A session whose last request was captured: the system prompt and tool definitions are measured.
// Local estimates add up to 10,000 tokens (system 2,500 + tool definitions 1,500 + content 6,000).
function measuredAnalysis(lastRequest: { input: number; output: number }): TokenAnalysis {
  return {
    ...buildFormatterFixtureAnalysis(),
    warnings: [],
    categories: {
      system: category("system", [
        { label: "System#prompt1", tokens: 2_000 },
        { label: "System#core/environment", tokens: 500 },
      ]),
      user: category("user", [{ label: "User#1", tokens: 1_000 }]),
      assistant: category("assistant", [{ label: "Assistant#1", tokens: 700 }]),
      tools: category("tools", [
        { label: "read", tokens: 3_000 },
        { label: "grep", tokens: 1_000 },
      ]),
      reasoning: category("reasoning", [{ label: "Reasoning#1", tokens: 300 }]),
    },
    toolCallCounts: new Map([
      ["read", 4],
      ["grep", 1],
    ]),
    mostRecentInput: lastRequest.input,
    mostRecentCacheRead: 0,
    mostRecentCacheWrite: 0,
    mostRecentOutput: lastRequest.output,
    mostRecentReasoning: 0,
    contextBreakdown: {
      baseSystemPrompt: { tokens: 2_000, identified: true },
      toolDefinitions: { tokens: 1_500, identified: true, toolCount: 12 },
      environmentContext: { tokens: 500, identified: true, components: ["core/environment"] },
      customInstructions: { tokens: 0, identified: true, sources: [] },
      guidance: { tokens: 0, identified: true, sources: [] },
      totalCachedContext: 4_000,
    },
  }
}

// Every view built here must survive the host's RPC output check: JSON values only, so no property
// may be set to undefined.
function view(analysis: TokenAnalysis, config = DEFAULT_TOKENSCOPE_CONFIG) {
  const report = buildReportView(analysis, new CostCalculator({}).calculateCost(analysis), config)
  expect(JSON.parse(JSON.stringify(report))).toStrictEqual(report)
  return report
}

test("apportion keeps proportions and adds up to the total exactly", () => {
  expect(apportion([1, 1, 1], 100)).toEqual([34, 33, 33])
  expect(apportion([2_500, 1_500, 6_000], 8_777)).toEqual([2_194, 1_317, 5_266])
  expect(sum(apportion([3, 7, 11, 13], 9_999))).toBe(9_999)
  expect(apportion([0, 5], 9)).toEqual([0, 9])
  expect(apportion([0, 0], 9)).toEqual([0, 0])
})

test("the context window split is scaled to the context recorded for the last request", () => {
  const report = view(measuredAnalysis({ input: 8_500, output: 277 }))

  // 8,777 recorded against a 10,000 token local estimate.
  expect(report.content.scale).toBeCloseTo(0.8777)
  expect(report.content.total).toBe(8_777)
  expect(sum(tokensOf(report.content.rows))).toBe(8_777)
  expect(report.content.rows).toEqual([
    { label: "System prompt", tokens: 2_194 },
    { label: "Tool definitions", tokens: 1_317 },
    { label: "User", tokens: 878 },
    { label: "Tool output", tokens: 3_511 },
    { label: "Assistant", tokens: 614 },
    { label: "Reasoning", tokens: 263 },
  ])

  // Every other breakdown follows the same scale and adds up to its row.
  expect(report.tools).toEqual([
    { name: "read", tokens: 2_633, calls: 4 },
    { name: "grep", tokens: 878, calls: 1 },
  ])
  expect(sum(tokensOf(report.context!.components))).toBe(report.context!.total)
  expect(report.context!.total).toBe(2_194 + 1_317)
  expect(report.topContributors[0]).toEqual({ label: "read", tokens: 2_633 })
  expect(report.warnings).toEqual([])
})

test("recorded usage is never scaled", () => {
  const analysis = measuredAnalysis({ input: 8_500, output: 277 })
  const report = view(analysis)

  expect(report.lastStep.input).toBe(8_500)
  expect(report.lastStep.output).toBe(277)
  expect(report.recorded.input).toBe(analysis.inputTokens)
  expect(report.recorded.cacheRead).toBe(analysis.cacheReadTokens)
})

test("a split too far from the recorded context stays unscaled and says so", () => {
  const report = view(measuredAnalysis({ input: 40_000, output: 500 }))

  expect(report.content.scale).toBeUndefined()
  expect(report.content.total).toBe(10_000)
  expect(report.tools[0]).toEqual({ name: "read", tokens: 3_000, calls: 4 })
  expect(report.context!.total).toBe(4_000)
  expect(report.warnings).toHaveLength(1)
  expect(report.warnings[0]).toContain("local content estimate (10000 tokens)")
  expect(report.warnings[0]).toContain("(40500 tokens)")
})

test("without a captured request the split is an unscaled estimate with no tool definitions", () => {
  // The fixture's context breakdown is estimated from the first cache write, not measured.
  const analysis = { ...measuredAnalysis({ input: 8_500, output: 277 }) }
  analysis.contextBreakdown = buildFormatterFixtureAnalysis().contextBreakdown

  const report = view(analysis)

  expect(report.content.scale).toBeUndefined()
  expect(report.content.rows.map((row) => row.label)).not.toContain("Tool definitions")
  expect(report.content.total).toBe(8_500)
  expect(report.context!.measured).toBe(false)
  expect(report.warnings).toEqual([])
})

test("with the context breakdown disabled the split is not scaled", () => {
  const report = view(measuredAnalysis({ input: 8_500, output: 277 }), {
    ...DEFAULT_TOKENSCOPE_CONFIG,
    enableContextBreakdown: false,
  })

  expect(report.content.scale).toBeUndefined()
  expect(report.context).toBeUndefined()
})

test("a session with no completed request is not scaled", () => {
  const report = view(measuredAnalysis({ input: 0, output: 0 }))

  expect(report.content.scale).toBeUndefined()
  expect(report.content.total).toBe(10_000)
  expect(report.warnings).toEqual([])
})

test("RPC failures become errors that keep their message", () => {
  const declared = { type: "empty_session", message: "Session ses_1 has no messages yet.", data: {} }
  const error = toError(declared)
  expect(error).toBeInstanceOf(Error)
  expect(error.message).toBe("Session ses_1 has no messages yet.")
  expect(error.cause).toBe(declared)

  expect(toError({ type: "rpc.unavailable", message: "RPC is unavailable: tokenscope" }).message).toBe(
    "RPC is unavailable: tokenscope. The TokenScope server plugin is not loaded for this session's project."
  )

  const thrown = new Error("boom")
  expect(toError(thrown)).toBe(thrown)
  expect(toError("plain text").message).toBe("plain text")
  expect(toError(undefined).message).toBe("undefined")
})
