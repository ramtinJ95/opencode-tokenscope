import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { TokenAnalyzerPlugin } from "../tokenscope.ts"

const REPORT_FILENAME = "token-usage-output.txt"

type RunOptions = {
  argSessionID?: string
  contextSessionID?: string
  outputPath?: string
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
          messages: async ({ path }: { path: Record<string, string> }) => {
            calls.push(path)
            return []
          },
        },
      },
      serverUrl: "http://localhost",
      directory,
    })

    const summary = await plugin.tool.tokenscope.execute(
        {
          sessionID: options.argSessionID,
          limitMessages: 10,
          includeSubagents: true,
          outputPath: options.outputPath,
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

test.serial("writes report to a custom absolute outputPath", async () => {
  await withTempCwd(async (directory) => {
    const customPath = path.join(directory, "reports", "tokens.txt")
    const { summary } = await runTokenscope({ outputPath: customPath })
    const report = await fs.readFile(customPath, "utf8")

    expect(summary).toContain(customPath)
    expect(report).toContain("Token Analysis: Session ses_current")
  })
})

test.serial("replaces placeholders in outputPath", async () => {
  await withTempCwd(async (directory) => {
    const template = path.join(directory, "reports", "%date%", "%session%-%model%.txt")
    const { summary } = await runTokenscope({ outputPath: template })

    const today = new Date().toISOString().split("T")[0]
    const expectedPath = path.join(directory, "reports", today, "ses_current-unknown-model.txt")
    const report = await fs.readFile(expectedPath, "utf8")

    expect(summary).toContain(expectedPath)
    expect(report).toContain("Token Analysis: Session ses_current")
  })
})

test.serial("uses TOKENSCOPE_OUTPUT_FILE when outputPath arg is not provided", async () => {
  await withTempCwd(async (directory) => {
    const previous = process.env.TOKENSCOPE_OUTPUT_FILE
    process.env.TOKENSCOPE_OUTPUT_FILE = path.join(directory, "env-reports", "%session%-%date%.txt")

    try {
      const { summary } = await runTokenscope({ contextSessionID: "ses_env" })
      const today = new Date().toISOString().split("T")[0]
      const expectedPath = path.join(directory, "env-reports", `ses_env-${today}.txt`)
      const report = await fs.readFile(expectedPath, "utf8")

      expect(summary).toContain(expectedPath)
      expect(report).toContain("Token Analysis: Session ses_env")
    } finally {
      if (previous === undefined) {
        delete process.env.TOKENSCOPE_OUTPUT_FILE
      } else {
        process.env.TOKENSCOPE_OUTPUT_FILE = previous
      }
    }
  })
})

test.serial("replaces %datetime_compact% placeholder", async () => {
  await withTempCwd(async (directory) => {
    const template = path.join(directory, "reports", "run-%datetime_compact%.txt")
    const { summary } = await runTokenscope({ outputPath: template, contextSessionID: "ses_compact" })

    const match = summary.match(/saved to:\s*(.+)$/m)
    expect(match).toBeTruthy()
    const resolvedPath = (match?.[1] ?? "").trim()
    expect(path.basename(resolvedPath)).toMatch(/^run-\d{8}_\d{4}\.txt$/)

    const report = await fs.readFile(resolvedPath, "utf8")
    expect(report).toContain("Token Analysis: Session ses_compact")
  })
})

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
