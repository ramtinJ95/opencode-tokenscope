import { expect, test } from "bun:test"

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { buildReportFilename, buildSuccessSummary, createReportPath, writeReport } from "../tokenscope-lib/report.js"

test("buildReportFilename isolates sessions and sanitizes path separators", () => {
  expect(buildReportFilename("ses/../../other", "msg:test", "run/id")).toBe(
    "token-usage-output-ses_.._.._other-msg_test-run_id.txt"
  )
})

test("createReportPath uses a private temporary directory and private file", async () => {
  const reportPath = await createReportPath("ses_test", "msg_test", "nonce")
  const reportDirectory = path.dirname(reportPath)

  try {
    expect(reportDirectory.startsWith(path.join(os.tmpdir(), "opencode", "tokenscope-"))).toBe(true)
    expect(path.basename(reportPath)).toBe("token-usage-output-ses_test-msg_test-nonce.txt")
    expect(await writeReport(reportPath, "private report")).toBeNull()
    expect(await fs.readFile(reportPath, "utf8")).toBe("private report")
    if (process.platform !== "win32") {
      expect((await fs.stat(reportDirectory)).mode & 0o777).toBe(0o700)
      expect((await fs.stat(reportPath)).mode & 0o777).toBe(0o600)
    }
  } finally {
    await fs.rm(reportDirectory, { recursive: true, force: true })
  }
})

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
