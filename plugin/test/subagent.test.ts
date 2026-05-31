import { expect, test } from "bun:test"

import { CostCalculator } from "../tokenscope-lib/cost.js"
import { SubagentAnalyzer } from "../tokenscope-lib/subagent.js"

test("SubagentAnalyzer estimates child session cost using per-call context tiers", async () => {
  const client = {
    session: {
      async children(input: any) {
        if (input?.path?.id === "ses_parent") return [{ id: "ses_child", title: "@explore subagent" }]
        if (input?.path?.id === "ses_child") return []
        throw new Error("bad shape")
      },
      async messages(input: any) {
        if (input?.path?.id !== "ses_child") throw new Error("bad shape")

        return [
          {
            info: { id: "msg_1", role: "assistant", providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
            parts: [
              {
                type: "step-finish",
                tokens: { input: 100_000, output: 100, reasoning: 0, cache: { read: 0, write: 0 } },
                cost: 0,
              },
              {
                type: "step-finish",
                tokens: { input: 100_000, output: 100, reasoning: 0, cache: { read: 0, write: 0 } },
                cost: 0,
              },
              {
                type: "step-finish",
                tokens: { input: 100_000, output: 100, reasoning: 0, cache: { read: 0, write: 0 } },
                cost: 0,
              },
            ],
          },
        ]
      },
    },
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

  const analysis = await new SubagentAnalyzer(client, costCalculator).analyzeChildSessions("ses_parent")

  expect(analysis.subagents).toHaveLength(1)
  expect(analysis.subagents[0]?.estimatedCost).toBeCloseTo(0.3006)
})
