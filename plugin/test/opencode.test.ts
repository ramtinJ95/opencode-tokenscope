import { expect, test } from "bun:test"

import { fetchProviderList, fetchSessionChildren, fetchSessionMessages, fetchToolList } from "../tokenscope-lib/opencode.js"

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

  const messages = await fetchSessionMessages(client, "ses_current", { directory: "/tmp/project" })

  expect(messages).toEqual([{ ok: true }])
  expect(calls).toEqual([
    { path: { id: "ses_current" }, query: { directory: "/tmp/project" }, throwOnError: true },
    { path: { sessionID: "ses_current" }, query: { directory: "/tmp/project" }, throwOnError: true },
    [{ sessionID: "ses_current", directory: "/tmp/project" }, { throwOnError: true }],
  ])
})

test("fetchSessionMessages omits empty routing parameters", async () => {
  const calls: unknown[] = []
  const client = {
    session: {
      async messages(input: unknown) {
        calls.push(input)
        return [{ ok: true }]
      },
    },
  }

  await fetchSessionMessages(client, "ses_current")

  expect(calls[0]).toEqual({ path: { id: "ses_current" }, throwOnError: true })
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

test("fetchSessionChildren forwards directory routing across supported SDK shapes", async () => {
  const calls: unknown[] = []
  const client = {
    session: {
      async children(input: unknown, options?: unknown) {
        calls.push(options === undefined ? input : [input, options])
        if ((input as any)?.sessionID === "ses_parent") return [{ id: "ses_child" }]
        throw new Error("bad shape")
      },
    },
  }

  const children = await fetchSessionChildren(client, "ses_parent", { directory: "/tmp/project" })

  expect(children).toEqual([{ id: "ses_child" }])
  expect(calls).toEqual([
    { path: { id: "ses_parent" }, query: { directory: "/tmp/project" }, throwOnError: true },
    { path: { sessionID: "ses_parent" }, query: { directory: "/tmp/project" }, throwOnError: true },
    [{ sessionID: "ses_parent", directory: "/tmp/project" }, { throwOnError: true }],
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

test("fetchToolList forwards directory routing to direct SDK shape", async () => {
  const calls: unknown[] = []
  const client = {
    tool: {
      async list(input: unknown, options?: unknown) {
        calls.push(options === undefined ? input : [input, options])
        if ((input as any)?.provider === "anthropic") return [{ id: "read" }]
        throw new Error("bad shape")
      },
    },
  }

  await fetchToolList(client, "anthropic", "claude-sonnet-4-20250514", { directory: "/tmp/project" })

  expect(calls).toEqual([
    {
      query: { directory: "/tmp/project", provider: "anthropic", model: "claude-sonnet-4-20250514" },
      throwOnError: true,
    },
    [{ directory: "/tmp/project", provider: "anthropic", model: "claude-sonnet-4-20250514" }, { throwOnError: true }],
  ])
})

test("fetchProviderList forwards directory routing through direct parameters when supported", async () => {
  const calls: unknown[] = []
  const client = {
    provider: {
      async list(input: unknown, options?: unknown) {
        calls.push(options === undefined ? input : [input, options])
        if ((input as any)?.directory === "/tmp/project" && (options as any)?.throwOnError) return { all: [] }
        throw new Error("bad shape")
      },
    },
  }

  await fetchProviderList(client, { directory: "/tmp/project" })

  expect(calls).toEqual([
    [{ directory: "/tmp/project" }, { throwOnError: true }],
  ])
})

test("fetchProviderList forwards directory routing through query parameters for legacy clients", async () => {
  const calls: unknown[] = []
  const client = {
    provider: {
      async list(input: unknown) {
        calls.push(input)
        if ((input as any)?.query?.directory === "/tmp/project") return { all: [] }
        throw new Error("bad shape")
      },
    },
  }

  await fetchProviderList(client, { directory: "/tmp/project" })

  expect(calls).toEqual([
    { directory: "/tmp/project" },
    { query: { directory: "/tmp/project" }, throwOnError: true },
  ])
})

test("fetchProviderList does not fall back to un-routed metadata when routing is requested", async () => {
  const calls: unknown[] = []
  const client = {
    provider: {
      async list(input: unknown, options?: unknown) {
        calls.push(options === undefined ? input : [input, options])
        throw new Error("bad shape")
      },
    },
  }

  await expect(fetchProviderList(client, { directory: "/tmp/project" })).rejects.toThrow("bad shape")

  expect(calls).toEqual([
    [{ directory: "/tmp/project" }, { throwOnError: true }],
    { query: { directory: "/tmp/project" }, throwOnError: true },
  ])
})
