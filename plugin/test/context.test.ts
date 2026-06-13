import { expect, test } from "bun:test"
import { chmod, mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"

import { ContextAnalyzer, createExportCommandRunner, defaultExportCommandRunner } from "../tokenscope-lib/context.js"
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

test("context export runs from the session directory", async () => {
  const calls: Array<{ sessionID: string; directory?: string }> = []
  const analyzer = new ContextAnalyzer(tokenizer, undefined, undefined, "/tmp/project", async (sessionID, directory) => {
    calls.push({ sessionID, directory })
    return JSON.stringify({ info: { id: sessionID, title: "test" }, messages: [] })
  })

  await analyzer.analyze(
    "ses_test",
    tokenModel,
    { input: 1, output: 3, cacheRead: 0, cacheWrite: 0 },
    {
      enableContextBreakdown: false,
      enableToolSchemaEstimation: false,
      enableCacheEfficiency: false,
      enableSubagentAnalysis: false,
      enableSkillAnalysis: false,
    }
  )

  expect(calls).toEqual([{ sessionID: "ses_test", directory: "/tmp/project" }])
})

test("default export runner captures only opencode export stdout", async () => {
  // This integration-style test proves the export runner's core contract on the
  // host OS: execute an `opencode export <session>` binary from PATH, use the
  // requested cwd, and return only stdout JSON while ignoring stderr progress.
  // The platform-specific Windows .cmd resolution is covered deterministically
  // in the injected-spawn unit test below.
  const tempRoot = await mkdtemp(path.join(tmpdir(), "tokenscope-opencode-"))
  const binDir = path.join(tempRoot, "bin")
  const previousPath = process.env.PATH

  await mkdir(binDir)

  if (process.platform === "win32") {
    await writeFile(
      path.join(binDir, "opencode.cmd"),
      "@echo off\r\necho Exporting session: %2 1>&2\r\necho {\"info\":{\"id\":\"%2\",\"title\":\"test\"},\"messages\":[]}\r\n"
    )
  } else {
    const opencodePath = path.join(binDir, "opencode")
    await writeFile(
      opencodePath,
      "#!/bin/sh\nprintf 'Exporting session: %s\\n' \"$2\" >&2\nprintf '{\"info\":{\"id\":\"%s\",\"title\":\"test\"},\"messages\":[]}' \"$2\"\n"
    )
    await chmod(opencodePath, 0o755)
  }

  process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ""}`
  try {
    const output = await defaultExportCommandRunner("ses_test", tempRoot)

    expect(JSON.parse(output)).toEqual({ info: { id: "ses_test", title: "test" }, messages: [] })
    expect(output).not.toContain("Exporting session")
  } finally {
    process.env.PATH = previousPath
  }
})

test("export runner enables shell on Windows so opencode command shims resolve", async () => {
  const calls: Array<{ command: string; args: string[]; options: any }> = []
  const fakeSpawn = (command: string, args: string[], options: any) => {
    calls.push({ command, args, options })

    const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough }
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()

    queueMicrotask(() => {
      child.stderr.end("Exporting session: ses_win\n")
      child.stdout.end('{"info":{"id":"ses_win","title":"test"},"messages":[]}')
      child.emit("close", 0, null)
    })

    return child
  }

  const runner = createExportCommandRunner(fakeSpawn as any, "win32")
  const output = await runner("ses_win", "C:\\project")

  expect(JSON.parse(output)).toEqual({ info: { id: "ses_win", title: "test" }, messages: [] })
  expect(output).not.toContain("Exporting session")
  expect(calls).toEqual([
    {
      command: "opencode",
      args: ["export", "ses_win"],
      options: {
        cwd: "C:\\project",
        shell: true,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    },
  ])
})
