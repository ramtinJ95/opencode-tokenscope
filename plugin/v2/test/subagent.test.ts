import { expect, test } from "bun:test"

import { CostCalculator } from "../tokenscope-lib/cost.js"
import type { SessionReader } from "../tokenscope-lib/opencode.js"
import { SubagentAnalyzer } from "../tokenscope-lib/subagent.js"
import { WarningCollector } from "../tokenscope-lib/warnings.js"

const time = { created: 1 }

function assistantStep(id: string, input: number) {
  return {
    id,
    type: "assistant",
    time,
    agent: "explore",
    model: { id: "claude-sonnet-4-20250514", providerID: "anthropic" },
    tokens: { input, output: 100, reasoning: 0, cache: { read: 0, write: 0 } },
    cost: 0,
    content: [],
  }
}

function sessionReader(children: Record<string, unknown[]>, contexts: Record<string, unknown[]>): SessionReader {
  return {
    async list(input: { parentID?: string }) {
      return { data: children[input.parentID ?? ""] ?? [], cursor: {} }
    },
    async context(input: { sessionID: string }) {
      const messages = contexts[input.sessionID]
      if (!messages) throw new Error(`unknown session ${input.sessionID}`)
      return messages
    },
  } as unknown as SessionReader
}

const costCalculator = new CostCalculator({
  "anthropic/claude-sonnet-4-20250514": {
    input: 1,
    output: 2,
    cacheRead: 0.1,
    cacheWrite: 1,
    contextOver200k: { input: 2, output: 4, cacheRead: 0.2, cacheWrite: 2 },
  },
  default: { input: 1, output: 3, cacheRead: 0, cacheWrite: 0 },
})

test("SubagentAnalyzer estimates child session cost using per-call context tiers", async () => {
  const session = sessionReader(
    { ses_parent: [{ id: "ses_child", title: "Find usages", agent: "explore" }] },
    { ses_child: [assistantStep("msg_1", 100_000), assistantStep("msg_2", 100_000), assistantStep("msg_3", 100_000)] }
  )

  const analysis = await new SubagentAnalyzer(session, costCalculator).analyzeChildSessions("ses_parent")

  expect(analysis.subagents).toHaveLength(1)
  expect(analysis.subagents[0]?.agentType).toBe("explore")
  expect(analysis.subagents[0]?.title).toBe("Find usages")
  expect(analysis.subagents[0]?.apiCallCount).toBe(3)
  expect(analysis.subagents[0]?.estimatedCost).toBeCloseTo(0.3006)
  expect(analysis.subagents[0]?.estimatedInputCost).toBeCloseTo(0.3)
  expect(analysis.subagents[0]?.estimatedOutputCost).toBeCloseTo(0.0006)
  expect(analysis.subagents[0]?.estimatedCacheReadCost).toBe(0)
  expect(analysis.subagents[0]?.estimatedCacheWriteCost).toBe(0)
  expect(analysis.estimatedInputCost).toBeCloseTo(0.3)
  expect(analysis.estimatedOutputCost).toBeCloseTo(0.0006)
})

test("SubagentAnalyzer includes nested child sessions and reports children it cannot read", async () => {
  const warnings = new WarningCollector()
  const session = sessionReader(
    {
      ses_parent: [{ id: "ses_child" }, { id: "ses_broken", title: "Broken" }],
      ses_child: [{ id: "ses_grandchild", agent: "general" }],
    },
    { ses_child: [assistantStep("msg_1", 1_000)], ses_grandchild: [assistantStep("msg_2", 2_000)] }
  )

  const analysis = await new SubagentAnalyzer(session, costCalculator, warnings).analyzeChildSessions("ses_parent")

  expect(analysis.subagents.map((subagent) => [subagent.sessionID, subagent.agentType])).toEqual([
    ["ses_child", "subagent"],
    ["ses_grandchild", "general"],
  ])
  expect(analysis.totalInputTokens).toBe(3_000)
  expect(analysis.totalApiCalls).toBe(2)
  expect(warnings.list().join("\n")).toContain("ses_broken")
})

test("SubagentAnalyzer stops at child sessions it has already visited", async () => {
  const warnings = new WarningCollector()
  const session = sessionReader(
    { ses_parent: [{ id: "ses_child", agent: "explore" }], ses_child: [{ id: "ses_parent" }, { id: "ses_child" }] },
    { ses_child: [assistantStep("msg_1", 1_000)], ses_parent: [assistantStep("msg_2", 5_000)] }
  )

  const analysis = await new SubagentAnalyzer(session, costCalculator, warnings).analyzeChildSessions("ses_parent")

  expect(analysis.subagents.map((subagent) => subagent.sessionID)).toEqual(["ses_child"])
  expect(analysis.totalInputTokens).toBe(1_000)
  expect(warnings.list().join("\n")).toContain("duplicate or cyclic child session")
})
