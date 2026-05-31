import { expect, test } from "bun:test"

import { fetchSessionMessages, fetchToolList } from "../tokenscope-lib/opencode.js"

test("fetchSessionMessages falls back to the current SDK parameter shape", async () => {
  const calls: unknown[] = []
  const client = {
    session: {
      async messages(input: unknown, options?: unknown) {
        calls.push(options === undefined ? input : [input, options])
        if ((input as any)?.sessionID === "ses_current") return [{ ok: true }]
        throw new Error("bad shape")
      },
    },
  }

  const messages = await fetchSessionMessages(client, "ses_current")

  expect(messages).toEqual([{ ok: true }])
  expect(calls).toEqual([
    { path: { id: "ses_current" }, throwOnError: true },
    { path: { sessionID: "ses_current" }, throwOnError: true },
    [{ sessionID: "ses_current" }, { throwOnError: true }],
  ])
})

test("fetchSessionMessages continues past non-throwing error responses", async () => {
  const client = {
    session: {
      async messages(input: unknown) {
        if ((input as any)?.sessionID === "ses_current") return [{ ok: true }]
        return { error: { message: "not found" } }
      },
    },
  }

  await expect(fetchSessionMessages(client, "ses_current")).resolves.toEqual([{ ok: true }])
})

test("fetchToolList supports legacy and current SDK parameter shapes", async () => {
  const calls: unknown[] = []
  const client = {
    tool: {
      async list(input: unknown, options?: unknown) {
        calls.push(options === undefined ? input : [input, options])
        if ((input as any)?.provider === "anthropic" && (input as any)?.model === "claude-sonnet-4-20250514") {
          return [{ id: "read" }]
        }
        throw new Error("bad shape")
      },
    },
  }

  const tools = await fetchToolList(client, "anthropic", "claude-sonnet-4-20250514")

  expect(tools).toEqual([{ id: "read" }])
  expect(calls).toEqual([
    { query: { provider: "anthropic", model: "claude-sonnet-4-20250514" }, throwOnError: true },
    [{ provider: "anthropic", model: "claude-sonnet-4-20250514" }, { throwOnError: true }],
  ])
})

test("fetchToolList continues past non-throwing error responses", async () => {
  const client = {
    tool: {
      async list(input: unknown) {
        if ((input as any)?.provider === "anthropic") return [{ id: "read" }]
        return { error: { message: "bad query" } }
      },
    },
  }

  await expect(fetchToolList(client, "anthropic", "claude-sonnet-4-20250514")).resolves.toEqual([{ id: "read" }])
})

test("fetchToolList forwards workspace routing parameters", async () => {
  const calls: unknown[] = []
  const client = {
    tool: {
      async list(input: unknown) {
        calls.push(input)
        return [{ id: "read" }]
      },
    },
  }

  await fetchToolList(client, "anthropic", "claude-sonnet-4-20250514", { directory: "/tmp/project" })

  expect(calls[0]).toEqual({
    query: { directory: "/tmp/project", provider: "anthropic", model: "claude-sonnet-4-20250514" },
    throwOnError: true,
  })
})
