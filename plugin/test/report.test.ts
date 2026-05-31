import { expect, test } from "bun:test"

import { buildSuccessSummary } from "../tokenscope-lib/report.js"

test("buildSuccessSummary shell-quotes the report path", () => {
  const summary = buildSuccessSummary("/tmp/project $(touch owned)/token'usage-output.txt", {
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    warnings: [],
  } as any)

  expect(summary).toContain("Use: cat '/tmp/project $(touch owned)/token'\\''usage-output.txt'")
  expect(summary).not.toContain('cat "/tmp/project $(touch owned)')
})
