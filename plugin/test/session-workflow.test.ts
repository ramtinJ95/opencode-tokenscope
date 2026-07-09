import { expect, test } from "bun:test"

import { addSessionAggregateWarnings } from "../tokenscope-lib/session-workflow.js"
import { WarningCollector } from "../tokenscope-lib/warnings.js"

test("session aggregate reconciliation stays quiet when message telemetry matches", () => {
  const warnings = new WarningCollector()
  addSessionAggregateWarnings(
    warnings,
    {
      sessionID: "ses_test",
      inputTokens: 10,
      outputTokens: 2,
      reasoningTokens: 1,
      cacheReadTokens: 20,
      cacheWriteTokens: 3,
      sessionCost: 0.001,
    } as any,
    {
      id: "ses_test",
      cost: 0.001,
      tokens: { input: 10, output: 2, reasoning: 1, cache: { read: 20, write: 3 } },
    }
  )

  expect(warnings.list()).toEqual([])
})

test("session aggregate reconciliation warns on mismatch and active revert", () => {
  const warnings = new WarningCollector()
  addSessionAggregateWarnings(
    warnings,
    {
      sessionID: "ses_test",
      inputTokens: 10,
      outputTokens: 2,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      sessionCost: 0.001,
    } as any,
    {
      id: "ses_test",
      cost: 0.002,
      tokens: { input: 20, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
      revert: { messageID: "msg_cutoff" },
    }
  )

  expect(warnings.list()).toHaveLength(2)
  expect(warnings.list()[0]).toContain("did not reconcile")
  expect(warnings.list()[1]).toContain("active revert at message msg_cutoff")
})

test("active reverts stay visible when aggregate buckets are unavailable", () => {
  const warnings = new WarningCollector()
  addSessionAggregateWarnings(
    warnings,
    { sessionID: "ses_test" } as any,
    { id: "ses_test", revert: { messageID: "msg_cutoff" } }
  )

  expect(warnings.list()).toHaveLength(2)
  expect(warnings.list()[0]).toContain("did not expose aggregate token buckets")
  expect(warnings.list()[1]).toContain("active revert at message msg_cutoff")
})
