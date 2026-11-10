import { afterEach, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import plugin from "../tokenscope.ts"

const time = { created: 1 }
const noUsage = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }

// An unknown provider/model resolves to the approximate tokenizer, keeping these tests offline.
const model = { id: "house-model", providerID: "house" }

type Harness = Awaited<ReturnType<typeof loadPlugin>>

const tempDirectories: string[] = []

async function tempDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tokenscope-v2-"))
  tempDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })))
})

function sessionInfo(id: string, directory: string, overrides: Record<string, unknown> = {}) {
  return { id, projectID: "prj_1", cost: 0, tokens: noUsage, time: { created: 1, updated: 1 }, location: { directory }, ...overrides }
}

function assistant(id: string, tokens: typeof noUsage, content: unknown[] = []) {
  return { id, type: "assistant", time, agent: "build", model, tokens, cost: 0.01, content }
}

async function loadPlugin(input: {
  sessions: Record<string, ReturnType<typeof sessionInfo>>
  contexts: Record<string, unknown[]>
  options?: Record<string, unknown>
}) {
  const registered: { tool?: any; command?: any; rpc?: any; contextHook?: (event: any) => void } = {}
  const prompts: any[] = []
  const contextCalls: string[] = []
  const registration = { dispose: async () => {} }

  const ctx = {
    options: input.options ?? {},
    location: { directory: "/plugin-location" },
    session: {
      async hook(name: string, callback: (event: any) => void) {
        if (name === "context") registered.contextHook = callback
        return registration
      },
      async get({ sessionID }: { sessionID: string }) {
        const session = input.sessions[sessionID]
        if (!session) throw new Error(`Session not found: ${sessionID}`)
        return session
      },
      async context({ sessionID }: { sessionID: string }) {
        contextCalls.push(sessionID)
        return input.contexts[sessionID] ?? []
      },
      async list() {
        return { data: [], cursor: {} }
      },
      async prompt(prompt: unknown) {
        prompts.push(prompt)
      },
    },
    model: {
      async list() {
        return { location: { directory: "/plugin-location" }, data: [] }
      },
    },
    agent: {
      async list() {
        return { location: { directory: "/plugin-location" }, data: [] }
      },
    },
    skill: {
      async list() {
        return { location: { directory: "/plugin-location" }, data: [] }
      },
    },
    tool: {
      async transform(callback: (editor: any) => void) {
        callback({ add: (tool: any) => (registered.tool = tool) })
        return registration
      },
    },
    command: {
      async transform(callback: (editor: any) => void) {
        callback({ add: (command: any) => (registered.command = command) })
        return registration
      },
    },
    rpc: {
      async register(definition: any, handlers: any) {
        registered.rpc = { definition, handlers }
        return registration
      },
    },
  }

  await plugin.setup(ctx as any)

  const run = (args: Record<string, unknown>, callerSessionID = "ses_current"): Promise<{ content: string }> =>
    registered.tool.execute(args, {
      sessionID: callerSessionID,
      agent: "build",
      messageID: "msg_call",
      id: "call_1",
      signal: new AbortController().signal,
      progress: async () => {},
    })

  // Calls the report RPC the way the host does: declared errors come back as tagged values, and
  // output that is not made of JSON values only (a property set to undefined, say) is rejected.
  const report = async (input: Record<string, unknown>): Promise<any> => {
    const output = await registered.rpc.handlers.report(input, {
      signal: new AbortController().signal,
      error: (type: string, message: string, data: unknown) => ({ rpcError: type, message, data }),
    })
    expect(JSON.parse(JSON.stringify(output))).toStrictEqual(output)
    return output
  }

  return { registered, prompts, contextCalls, run, report }
}

// Reports are written to a private per-invocation file under OpenCode's temporary directory;
// the tool result names it. Reads the report, then removes the invocation directory.
async function readReport(content: string): Promise<string> {
  const reportPath = content.match(/saved to: (.+)/)?.[1]
  expect(reportPath).toBeDefined()
  expect(path.dirname(reportPath!).startsWith(path.join(os.tmpdir(), "opencode", "tokenscope-"))).toBe(true)
  const report = await fs.readFile(reportPath!, "utf8")
  await fs.rm(path.dirname(reportPath!), { recursive: true, force: true })
  return report
}

function captureRequest(harness: Harness, sessionID: string) {
  harness.registered.contextHook?.({
    sessionID,
    agent: "build",
    model,
    system: [
      { type: "text", text: "You are OpenCode, a coding agent." },
      {
        type: "text",
        text: "<env>Working directory: /tmp/project</env>",
        metadata: {
          experimental: { instructions: [{ key: "core/environment", text: "<env>Working directory: /tmp/project</env>" }] },
        },
      },
    ],
    messages: [],
    options: {},
    tools: {
      read: { description: "Read a file", input: { type: "object", properties: { filePath: { type: "string" } } } },
    },
  })
}

test("registers a V2 plugin with a directly callable tool and a /tokenscope-report command", async () => {
  const harness = await loadPlugin({ sessions: {}, contexts: {} })
  const { tool, command } = harness.registered

  expect(plugin.id).toBe("tokenscope")
  expect(tool.name).toBe("tokenscope")
  expect(tool.options).toEqual({ codemode: false })
  expect(tool.input.type).toBe("object")
  expect(Object.keys(tool.input.properties)).toEqual(["sessionID", "limitMessages", "includeSubagents"])
  expect(command.name).toBe("tokenscope-report")

  await command.execute({ sessionID: "ses_current", prompt: { text: "  focus on tools " }, delivery: "steer" })

  expect(harness.prompts).toHaveLength(1)
  expect(harness.prompts[0].sessionID).toBe("ses_current")
  expect(harness.prompts[0].delivery).toBe("steer")
  expect(harness.prompts[0].text).toContain("Call the tokenscope tool directly")
  expect(harness.prompts[0].text).toContain("read the exact unique report path returned by TokenScope")
  expect(harness.prompts[0].text.endsWith("focus on tools")).toBe(true)
})

test("analyzes the calling session and measures context from the captured model request", async () => {
  const directory = await tempDirectory()
  const harness = await loadPlugin({
    sessions: {
      ses_current: sessionInfo("ses_current", directory, {
        cost: 0.01,
        tokens: { input: 1_200, output: 80, reasoning: 0, cache: { read: 0, write: 900 } },
      }),
    },
    contexts: {
      ses_current: [
        { id: "msg_1", type: "user", time, text: "Please read the config file and summarize it." },
        assistant("msg_2", { input: 1_200, output: 80, reasoning: 0, cache: { read: 0, write: 900 } }, [
          { type: "text", text: "Reading it now." },
          {
            type: "tool",
            id: "call_0",
            name: "read",
            time,
            state: { status: "completed", input: { filePath: "config.json" }, content: [{ type: "text", text: '{"a":1}' }] },
          },
        ]),
      ],
    },
  })
  captureRequest(harness, "ses_current")

  // A blank sessionID means "the current session".
  const { content } = await harness.run({ sessionID: "   ", limitMessages: 5 })
  const report = await readReport(content)

  expect(harness.contextCalls).toEqual(["ses_current"])
  expect(content).toContain("Recorded telemetry total: 2,180")
  expect(report).toContain("Token Analysis: Session ses_current")
  expect(report).toContain("CONTEXT BREAKDOWN (Measured from the latest model request)")
  expect(report).toContain("Measured Request Context:")
  expect(report).not.toContain("First Cache Write:")
  expect(report).toContain("TOOL DEFINITION COSTS (Tokenized from the latest model request)")
  expect(report).toContain("System#prompt1")
  expect(report).not.toContain("No model request has been observed")
  // Message-derived usage matches the session aggregate, so there is nothing to reconcile.
  expect(report).not.toContain("did not reconcile")
  // The analyzed worktree is left untouched.
  expect(await fs.readdir(directory)).toEqual([])
})

test("warns when message-derived usage does not match the session aggregate", async () => {
  const directory = await tempDirectory()
  const harness = await loadPlugin({
    sessions: {
      ses_current: sessionInfo("ses_current", directory, {
        cost: 0.5,
        tokens: { input: 9_000, output: 100, reasoning: 0, cache: { read: 0, write: 0 } },
        revert: { messageID: "msg_reverted" },
      }),
    },
    contexts: {
      ses_current: [assistant("msg_1", { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } }, [{ type: "text", text: "ok" }])],
    },
  })
  captureRequest(harness, "ses_current")

  const report = await readReport((await harness.run({})).content)

  expect(report).toContain("Message-derived telemetry did not reconcile with OpenCode's session aggregate")
  expect(report).toContain("messages: 15 tokens / $0.010000; session: 9100 tokens / $0.500000")
  expect(report).toContain("Session has an active revert at message msg_reverted")
  expect(report).not.toContain("has been compacted")
})

test("analyzes an explicit session and says when context is estimated", async () => {
  const callerDirectory = await tempDirectory()
  const otherDirectory = await tempDirectory()
  const harness = await loadPlugin({
    sessions: {
      ses_current: sessionInfo("ses_current", callerDirectory),
      ses_explicit: sessionInfo("ses_explicit", otherDirectory),
    },
    contexts: {
      ses_explicit: [
        { id: "msg_1", type: "user", time, text: "hello there" },
        assistant("msg_2", { input: 500, output: 40, reasoning: 0, cache: { read: 0, write: 300 } }, [
          { type: "text", text: "hi" },
        ]),
      ],
    },
  })
  captureRequest(harness, "ses_current")

  const { content } = await harness.run({ sessionID: "ses_explicit" })
  const report = await readReport(content)

  expect(harness.contextCalls).toEqual(["ses_explicit"])
  expect(report).toContain("Token Analysis: Session ses_explicit")
  expect(report).toContain("No model request has been observed for session ses_explicit")
  expect(report).toContain("CONTEXT BREAKDOWN (Estimated from cache_write tokens)")
  expect(await fs.readdir(callerDirectory)).toEqual([])
  expect(await fs.readdir(otherDirectory)).toEqual([])
})

test("warns that only the active context is covered once a session has been compacted", async () => {
  const directory = await tempDirectory()
  const harness = await loadPlugin({
    sessions: {
      ses_current: sessionInfo("ses_current", directory, {
        cost: 1.2345,
        tokens: { input: 90_000, output: 9_000, reasoning: 1_000, cache: { read: 400_000, write: 0 } },
      }),
    },
    contexts: {
      ses_current: [
        {
          id: "msg_1",
          type: "compaction",
          time,
          status: "completed",
          reason: "auto",
          model,
          summary: "Earlier work was summarized.",
          tokens: { input: 2_000, output: 300, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0.002,
        },
        assistant("msg_2", { input: 700, output: 60, reasoning: 0, cache: { read: 0, write: 0 } }, [
          { type: "text", text: "continuing" },
        ]),
      ],
    },
  })
  captureRequest(harness, "ses_current")

  const report = await readReport((await harness.run({})).content)

  expect(report).toContain("Session has been compacted. OpenCode exposes only the active context")
  expect(report).toContain("messages: 3060 tokens / $0.012000; session: 500000 tokens / $1.234500")
  expect(report).not.toContain("did not reconcile")
})

test("the report RPC returns the same analysis as structured data for native UIs", async () => {
  const directory = await tempDirectory()
  const usage = { input: 1_200, output: 80, reasoning: 0, cache: { read: 300, write: 900 } }
  const harness = await loadPlugin({
    sessions: { ses_current: sessionInfo("ses_current", directory, { cost: 0.01, tokens: usage }) },
    contexts: {
      ses_current: [
        { id: "msg_1", type: "user", time, text: "Please read the config file and summarize it." },
        assistant("msg_2", usage, [
          { type: "text", text: "Reading it now." },
          {
            type: "tool",
            id: "call_0",
            name: "read",
            time,
            state: { status: "completed", input: { filePath: "config.json" }, content: [{ type: "text", text: '{"a":1}' }] },
          },
        ]),
      ],
    },
  })
  captureRequest(harness, "ses_current")

  expect(harness.registered.rpc.definition.id).toBe("tokenscope")
  const view = await harness.report({ sessionID: "ses_current" })

  expect(view.sessionID).toBe("ses_current")
  expect(view.steps).toBe(1)
  expect(view.recorded).toEqual({ input: 1_200, cacheRead: 300, cacheWrite: 900, output: 80, reasoning: 0, cost: 0.01 })
  expect(view.lastStep).toEqual(view.recorded)
  expect(view.costBasis).toBe("recorded")
  expect(view.total).toEqual({ cost: 0.01, costBasis: "recorded", tokens: 2_480, steps: 1 })
  expect(view.content.rows.map((row: any) => row.label)).toEqual([
    "System prompt",
    "Tool definitions",
    "User",
    "Tool output",
    "Assistant",
  ])
  expect(view.tools).toEqual([{ name: "read", tokens: view.content.rows[3].tokens, calls: 1 }])
  expect(view.context.measured).toBe(true)
  expect(view.context.total).toBe(view.context.components.reduce((sum: number, row: any) => sum + row.tokens, 0))
  expect(view.cache.hitRate).toBeCloseTo(20)
  // The payload crosses a JSON transport.
  expect(JSON.parse(JSON.stringify(view))).toEqual(view)
  // No report file is written and the analyzed worktree is left untouched.
  expect(await fs.readdir(directory)).toEqual([])
})

test("the report RPC fails explicitly for an empty or unreadable session", async () => {
  const directory = await tempDirectory()
  const harness = await loadPlugin({ sessions: { ses_current: sessionInfo("ses_current", directory) }, contexts: {} })

  expect(await harness.report({ sessionID: "ses_current" })).toEqual({
    rpcError: "empty_session",
    message: "Session ses_current has no messages yet.",
    data: {},
  })
  expect(await harness.report({ sessionID: "ses_missing" })).toEqual({
    rpcError: "analysis_failed",
    message: "Session not found: ses_missing",
    data: {},
  })
})

test("reports an empty session without failing the tool call", async () => {
  const directory = await tempDirectory()
  const harness = await loadPlugin({ sessions: { ses_current: sessionInfo("ses_current", directory) }, contexts: {} })

  const { content } = await harness.run({})

  expect(content).toContain("Session ses_current has no messages yet.")
  expect(await readReport(content)).toContain("Token Analysis: Session ses_current")
})

test("writes a fallback report when the requested session cannot be read", async () => {
  const directory = await tempDirectory()
  const harness = await loadPlugin({ sessions: { ses_current: sessionInfo("ses_current", directory) }, contexts: {} })

  const { content } = await harness.run({ sessionID: "ses_missing" })
  const report = await readReport(content)

  expect(content).toContain("TokenScope hit an error.")
  expect(report).toContain("Status: Partial / failed analysis")
  expect(report).toContain("Session not found: ses_missing")
})

test("a failing request capture never throws into the model request and is surfaced in the report", async () => {
  const directory = await tempDirectory()
  const harness = await loadPlugin({
    sessions: { ses_current: sessionInfo("ses_current", directory) },
    contexts: {
      ses_current: [assistant("msg_1", { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } }, [{ type: "text", text: "ok" }])],
    },
  })

  expect(() => harness.registered.contextHook?.({ sessionID: "ses_current", system: undefined, tools: {} })).not.toThrow()

  const { content } = await harness.run({})

  expect(await readReport(content)).toContain("TokenScope could not capture a model request")
})

test("plugin options override the file-based config", async () => {
  const directory = await tempDirectory()
  const harness = await loadPlugin({
    options: { enableContextBreakdown: false, enableToolSchemaEstimation: false, enableSkillAnalysis: "yes" },
    sessions: { ses_current: sessionInfo("ses_current", directory) },
    contexts: {
      ses_current: [assistant("msg_1", { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 100 } }, [{ type: "text", text: "ok" }])],
    },
  })
  captureRequest(harness, "ses_current")

  const report = await readReport((await harness.run({})).content)

  expect(report).not.toContain("CONTEXT BREAKDOWN")
  expect(report).not.toContain("TOOL DEFINITION COSTS")
  expect(report).toContain("CACHE EFFICIENCY")
})
