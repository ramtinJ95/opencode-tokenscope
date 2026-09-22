import { describe, expect, test } from "bun:test"

import { buildProviderPricing, createV2Client, toV1Messages } from "../tokenscope-lib/v2-adapter.js"

describe("toV1Messages", () => {
  test("maps a v2 user message to a v1 text part", () => {
    const [message] = toV1Messages([{ type: "user", id: "msg_user", text: "hello" }])

    expect(message.info.role).toBe("user")
    expect(message.parts).toEqual([{ type: "text", text: "hello" }])
  })

  test("maps assistant content and tool results to the v1 shape", () => {
    const [message] = toV1Messages([
      {
        type: "assistant",
        id: "msg_a",
        agent: "build",
        model: { id: "deepseek-flash", providerID: "deepseek" },
        tokens: { input: 10, output: 5, reasoning: 1, cache: { read: 2, write: 0 } },
        cost: 0.5,
        content: [
          { type: "reasoning", text: "thinking" },
          { type: "text", text: "answer" },
          {
            type: "tool",
            id: "call_1",
            name: "shell",
            state: {
              status: "completed",
              input: { command: "ls" },
              content: [{ type: "text", text: "file-a\nfile-b" }],
            },
          },
        ],
      },
    ])

    expect(message.info.role).toBe("assistant")
    expect(message.info.model).toEqual({ id: "deepseek-flash", providerID: "deepseek" })
    expect(message.info.tokens).toEqual({ input: 10, output: 5, reasoning: 1, cache: { read: 2, write: 0 } })
    expect(message.info.cost).toBe(0.5)
    expect(message.parts[0]).toEqual({ type: "reasoning", text: "thinking" })
    expect(message.parts[1]).toEqual({ type: "text", text: "answer" })
    expect(message.parts[2]).toEqual({
      type: "tool",
      tool: "shell",
      state: {
        status: "completed",
        input: { command: "ls" },
        output: "file-a\nfile-b",
        error: undefined,
        metadata: undefined,
        time: undefined,
      },
    })
  })

  test("keeps system text and surfaces loaded skills as tool results", () => {
    const messages = toV1Messages([
      { type: "system", id: "msg_s", text: "system context" },
      { type: "skill", id: "msg_skill", name: "glab", text: "skill body" },
    ])

    expect(messages[0].info.system).toBe("system context")
    expect(messages[0].parts).toEqual([])
    expect(messages[1].parts[0]).toEqual({
      type: "tool",
      tool: "skill",
      state: {
        status: "completed",
        input: { name: "glab" },
        output: "skill body",
        metadata: { name: "glab" },
      },
    })
  })
})

describe("createV2Client", () => {
  const ctx = {
    session: {
      async context() {
        return [{ type: "user", id: "msg_user", text: "hi" }]
      },
      async get() {
        return { id: "ses_1", tokens: { input: 1, output: 2 }, cost: 0.01 }
      },
      async list() {
        return { data: [{ id: "ses_child", title: "child", agent: "explore" }] }
      },
    },
    tool: {
      async list() {
        return [{ name: "read", description: "Read a file", input: { type: "object", properties: {} } }]
      },
    },
    model: {
      async list() {
        return {
          data: [
            {
              id: "deepseek-flash",
              modelID: "deepseek-flash",
              providerID: "deepseek",
              limit: { context: 128000 },
              cost: [
                { input: 0.5, output: 1.5, cache: { read: 0.05, write: 0 } },
                { tier: { type: "context", size: 200000 }, input: 1, output: 2, cache: { read: 0.1, write: 0 } },
              ],
            },
          ],
        }
      },
    },
    agent: {
      async list() {
        return { data: [{ name: "build" }] }
      },
    },
    skill: {
      async list() {
        return { data: [{ name: "glab" }] }
      },
    },
  }

  test("returns v1-shaped messages and session data", async () => {
    const client = createV2Client(ctx, "/tmp/project")

    const messages = await client.session.messages({ sessionID: "ses_1" })
    expect(messages.data[0].info.role).toBe("user")

    const session = await client.session.get({ sessionID: "ses_1" })
    expect(session.data.cost).toBe(0.01)

    const children = await client.session.children({ sessionID: "ses_1" })
    expect(children.data).toEqual([{ id: "ses_child", title: "child", agent: "explore" }])
  })

  test("maps tool definitions and provider pricing from the v2 catalogs", async () => {
    const client = createV2Client(ctx, "/tmp/project")

    const tools = await client.tool.list()
    expect(tools.data).toEqual([{ id: "read", description: "Read a file", jsonSchema: { type: "object", properties: {} } }])

    const providers = await client.provider.list()
    expect(providers.data.all).toHaveLength(1)
    expect(providers.data.all[0].id).toBe("deepseek")
    expect(providers.data.all[0].models["deepseek-flash"].cost.tiers).toEqual([
      { tier: { type: "context", size: 200000 }, input: 1, output: 2, cache: { read: 0.1, write: 0 } },
    ])
  })

  test("buildProviderPricing tolerates models without a cost array", () => {
    expect(buildProviderPricing([{ providerID: "acme", id: "m1" }])).toEqual([
      { id: "acme", models: { m1: { id: "m1", cost: undefined, limit: undefined } } },
    ])
  })
})
