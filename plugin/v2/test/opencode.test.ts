import { expect, test } from "bun:test"

import {
  captureRequestSnapshot,
  hasCompactedHistory,
  listChildSessions,
  normalizeMessages,
  RequestSnapshotStore,
  type OpenCodeMessage,
} from "../tokenscope-lib/opencode.js"

const time = { created: 1 }
const usage = { input: 100, output: 20, reasoning: 5, cache: { read: 1_000, write: 50 } }

function messages(items: unknown[]): OpenCodeMessage[] {
  return items as OpenCodeMessage[]
}

test("normalizeMessages maps user, synthetic and system messages to text parts", () => {
  const normalized = normalizeMessages(
    messages([
      { id: "msg_1", type: "user", time, text: "hello" },
      { id: "msg_2", type: "synthetic", time, text: "subagent finished" },
      { id: "msg_3", type: "system", time, text: "Today's date is now: Tue" },
    ])
  )

  expect(normalized).toEqual([
    { info: { id: "msg_1", role: "user" }, parts: [{ type: "text", text: "hello" }] },
    { info: { id: "msg_2", role: "user" }, parts: [{ type: "text", text: "subagent finished" }] },
    { info: { id: "msg_3", role: "system" }, parts: [{ type: "text", text: "Today's date is now: Tue" }] },
  ])
})

test("normalizeMessages maps assistant content, usage and the model reference", () => {
  const [assistant] = normalizeMessages(
    messages([
      {
        id: "msg_1",
        type: "assistant",
        time,
        agent: "build",
        model: { id: "claude-sonnet-4", providerID: "anthropic" },
        tokens: usage,
        cost: 0.02,
        content: [
          { type: "reasoning", text: "thinking" },
          { type: "text", text: "done" },
          {
            type: "tool",
            id: "call_1",
            name: "read",
            time,
            state: {
              status: "completed",
              input: { filePath: "a.ts" },
              content: [
                { type: "text", text: "line one" },
                { type: "file", uri: "file:///a.png", mime: "image/png" },
                { type: "text", text: "line two" },
              ],
            },
          },
          {
            type: "tool",
            id: "call_2",
            name: "shell",
            time,
            state: { status: "error", input: { command: "false" }, error: { type: "unknown", message: "exit 1" } },
          },
          { type: "tool", id: "call_3", name: "grep", time, state: { status: "streaming", input: '{"pat' } },
        ],
      },
    ])
  )

  expect(assistant?.info).toEqual({
    id: "msg_1",
    role: "assistant",
    agent: "build",
    model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
    tokens: usage,
    cost: 0.02,
  })
  expect(assistant?.parts).toEqual([
    { type: "reasoning", text: "thinking" },
    { type: "text", text: "done" },
    {
      type: "tool",
      tool: "read",
      state: { status: "completed", input: { filePath: "a.ts" }, output: "line one\nline two", metadata: undefined },
    },
    {
      type: "tool",
      tool: "shell",
      state: { status: "error", input: { command: "false" }, output: "exit 1", metadata: undefined },
    },
    { type: "tool", tool: "grep", state: { status: "streaming" } },
  ])
})

test("normalizeMessages represents user-invoked skills and shell commands as tool output", () => {
  const normalized = normalizeMessages(
    messages([
      { id: "msg_1", type: "skill", time, skill: "review", name: "Review", text: "<skill_content>...</skill_content>" },
      {
        id: "msg_2",
        type: "shell",
        time,
        shellID: "sh_1",
        command: "ls",
        status: "exited",
        exit: 0,
        output: { output: "a.ts\nb.ts", cursor: 9, size: 9, truncated: false },
      },
    ])
  )

  expect(normalized[0]?.parts).toEqual([
    {
      type: "tool",
      tool: "skill",
      state: {
        status: "completed",
        input: { id: "review" },
        output: "<skill_content>...</skill_content>",
        metadata: { name: "Review" },
      },
    },
  ])
  expect(normalized[1]?.parts).toEqual([
    { type: "tool", tool: "shell", state: { status: "completed", input: { command: "ls" }, output: "a.ts\nb.ts" } },
  ])
})

test("normalizeMessages keeps compaction usage and drops bookkeeping messages", () => {
  const raw = messages([
    {
      id: "msg_1",
      type: "compaction",
      time,
      status: "completed",
      reason: "auto",
      model: { id: "claude-haiku", providerID: "anthropic" },
      summary: "Earlier we fixed the parser.",
      tokens: usage,
      cost: 0.001,
    },
    { id: "msg_2", type: "compaction", time, status: "running", reason: "manual", summary: "" },
    { id: "msg_3", type: "agent-switched", time, agent: "plan" },
    { id: "msg_4", type: "model-switched", time, model: { id: "gpt-5.4", providerID: "openai" } },
    { id: "msg_5", type: "idle", time, outcome: "succeeded" },
  ])

  expect(normalizeMessages(raw)).toEqual([
    {
      info: {
        id: "msg_1",
        role: "assistant",
        model: { providerID: "anthropic", modelID: "claude-haiku" },
        tokens: usage,
        cost: 0.001,
      },
      parts: [{ type: "text", text: "Earlier we fixed the parser." }],
    },
  ])
  expect(hasCompactedHistory(raw)).toBe(true)
  expect(hasCompactedHistory(raw.slice(1))).toBe(false)
})

test("listChildSessions filters by parent and follows pagination cursors", async () => {
  const calls: unknown[] = []
  const session = {
    async list(input: { parentID?: string; cursor?: string; limit?: number }) {
      calls.push(input)
      if (input.cursor === "page-2") {
        return { data: [{ id: "ses_c", agent: "general" }], cursor: { next: null } }
      }
      return {
        data: [
          { id: "ses_a", title: "Find usages", agent: "explore" },
          { id: "ses_b", title: "Write tests" },
        ],
        cursor: { next: "page-2" },
      }
    },
  }

  const children = await listChildSessions(session as any, "ses_parent")

  expect(calls).toEqual([
    { parentID: "ses_parent", limit: 100 },
    { cursor: "page-2", limit: 100 },
  ])
  expect(children).toEqual([
    { id: "ses_a", title: "Find usages", agent: "explore" },
    { id: "ses_b", title: "Write tests", agent: undefined },
    { id: "ses_c", title: undefined, agent: "general" },
  ])
})

test("captureRequestSnapshot copies system parts, instruction sources and tool definitions", () => {
  const snapshot = captureRequestSnapshot({
    system: [
      { type: "text", text: "You are OpenCode." },
      {
        type: "text",
        text: "Today's date: Tue\n\n<env>...</env>",
        metadata: {
          experimental: {
            instructions: [
              { key: "core/date", text: "Today's date: Tue" },
              { key: "core/environment", text: "<env>...</env>" },
              { key: 42, text: "ignored" },
            ],
          },
        },
      },
    ],
    tools: {
      read: { description: "Read a file", input: { type: "object", properties: { filePath: { type: "string" } } } },
    },
  } as any)

  expect(snapshot).toEqual({
    system: [
      { text: "You are OpenCode.", instructions: undefined },
      {
        text: "Today's date: Tue\n\n<env>...</env>",
        instructions: [
          { key: "core/date", text: "Today's date: Tue" },
          { key: "core/environment", text: "<env>...</env>" },
        ],
      },
    ],
    tools: [
      { id: "read", description: "Read a file", schema: { type: "object", properties: { filePath: { type: "string" } } } },
    ],
  })
})

test("RequestSnapshotStore keeps the latest snapshot per session and evicts the least recently updated", () => {
  const store = new RequestSnapshotStore()
  const snapshot = (text: string) => ({ system: [{ text }], tools: [] })

  for (let index = 0; index < 32; index++) store.set(`ses_${index}`, snapshot(`v1-${index}`))
  store.set("ses_0", snapshot("v2-0"))
  store.set("ses_new", snapshot("new"))

  expect(store.get("ses_0")?.system[0]?.text).toBe("v2-0")
  expect(store.get("ses_1")).toBeUndefined()
  expect(store.get("ses_2")?.system[0]?.text).toBe("v1-2")
  expect(store.get("ses_new")?.system[0]?.text).toBe("new")
})
