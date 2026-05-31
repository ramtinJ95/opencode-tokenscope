import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { TokenAnalyzerPlugin } from "../tokenscope.ts"

const REPORT_FILENAME = "token-usage-output.txt"

type RunOptions = {
  argSessionID?: string
  contextSessionID?: string
  includeSubagents?: boolean
  sessionInfo?: Record<string, unknown>
}

async function withTempCwd<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const previousCwd = process.cwd()
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tokenscope-sessionid-"))

  process.chdir(directory)
  try {
    return await run(directory)
  } finally {
    process.chdir(previousCwd)
    await fs.rm(directory, { recursive: true, force: true })
  }
}

async function runTokenscope(options: RunOptions = {}) {
  return await withTempCwd(async (directory) => {
    const calls: Array<Record<string, string>> = []
    const plugin = await TokenAnalyzerPlugin({
      client: {
        session: {
          get: options.sessionInfo
            ? async () => options.sessionInfo
            : undefined,
          messages: async ({ path }: { path: Record<string, string> }) => {
            calls.push(path)
            return []
          },
          children: async () => [],
        },
      },
      serverUrl: "http://localhost",
      directory,
    })

    const summary = await plugin.tool.tokenscope.execute(
      {
        sessionID: options.argSessionID,
        limitMessages: 10,
        includeSubagents: options.includeSubagents ?? true,
      },
      {
        sessionID: options.contextSessionID ?? "ses_current",
        messageID: "msg_test",
        agent: "test-agent",
        directory,
        worktree: directory,
        abort: new AbortController().signal,
        metadata() {},
        async ask() {},
      }
    )

    const report = await fs.readFile(path.join(directory, REPORT_FILENAME), "utf8")
    return { calls, summary, report }
  })
}

test.serial("falls back to the current session when sessionID is an empty string", async () => {
  const { calls, summary, report } = await runTokenscope({ argSessionID: "" })

  expect(calls).toEqual([{ id: "ses_current" }])
  expect(summary).toContain("Session ses_current has no messages yet.")
  expect(report).toContain("Token Analysis: Session ses_current")
})

test.serial("falls back to the current session when sessionID is whitespace only", async () => {
  const { calls, summary, report } = await runTokenscope({ argSessionID: "   \n\t  " })

  expect(calls).toEqual([{ id: "ses_current" }])
  expect(summary).toContain("Session ses_current has no messages yet.")
  expect(report).toContain("Token Analysis: Session ses_current")
})

test.serial("prefers an explicit non-empty sessionID over the current session", async () => {
  const { calls, summary, report } = await runTokenscope({
    argSessionID: "ses_explicit",
    contextSessionID: "ses_current",
  })

  expect(calls).toEqual([{ id: "ses_explicit" }])
  expect(summary).toContain("Session ses_explicit has no messages yet.")
  expect(report).toContain("Token Analysis: Session ses_explicit")
})

test.serial("reports persisted aggregate totals when session messages are empty", async () => {
  const { summary, report } = await runTokenscope({
    includeSubagents: false,
    sessionInfo: {
      id: "ses_current",
      model: { providerID: "openai", id: "gpt-5.4-mini", variant: "default" },
      tokens: { input: 1_000, output: 500, reasoning: 25, cache: { read: 200, write: 100 } },
      cost: 0.0123,
    },
  })

  expect(summary).toContain("Token analysis complete!")
  expect(summary).toContain("Session telemetry total: 1,825")
  expect(report).toContain("Token Analysis: Session ses_current")
  expect(report).toContain("Local Total: 1,825 tokens (from persisted session aggregate)")
  expect(report).toContain("Note: no message content was available for local category analysis.")
  expect(report).not.toContain("MOST RECENT API CALL")
  expect(report).toContain("SESSION TOTALS (Persisted OpenCode aggregate)")
  expect(report).toContain("Input tokens:           1,000")
  expect(report).toContain("ACTUAL COST (from API):  $0.0123")
  expect(report).not.toContain("Pricing for 'openai/gpt-5.4-mini' was not found")
})
