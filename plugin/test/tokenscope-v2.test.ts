import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import plugin from "../tokenscope.ts"
import { tokenscopeV2 } from "../tokenscope-v2.ts"

function makeFakeContext(directory: string, registered: any[]) {
  return {
    location: { directory, project: { id: "proj", directory, canonical: directory } },
    tool: {
      async transform(callback: (editor: any) => void) {
        callback({
          add(tool: any) {
            registered.push(tool)
          },
        })
        return { async dispose() {} }
      },
      async list() {
        return []
      },
    },
    session: {
      async context() {
        return [
          { type: "user", id: "msg_user", text: "summarize this session" },
          {
            type: "assistant",
            id: "msg_assistant",
            agent: "build",
            model: { id: "gpt-4o", providerID: "openai" },
            tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 10, write: 0 } },
            cost: 0.002,
            content: [
              { type: "reasoning", text: "thinking about it" },
              { type: "text", text: "here is the answer" },
            ],
          },
        ]
      },
      async get() {
        return {
          id: "ses_v2",
          cost: 0.002,
          tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 10, write: 0 } },
        }
      },
      async list() {
        return { data: [] }
      },
    },
    model: {
      async list() {
        return { data: [] }
      },
    },
    agent: {
      async list() {
        return { data: [] }
      },
    },
    skill: {
      async list() {
        return { data: [] }
      },
    },
  }
}

test("default export exposes both v2 (id/setup) and v1 (server) entrypoints", () => {
  expect(typeof (plugin as any).id).toBe("string")
  expect(typeof (plugin as any).setup).toBe("function")
  expect(typeof (plugin as any).server).toBe("function")
  expect(tokenscopeV2.id).toBe("tokenscope")
})

test.serial("v2 setup registers a tokenscope tool that runs the analysis", async () => {
  const previousCwd = process.cwd()
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tokenscope-v2-"))
  const registered: any[] = []

  process.chdir(directory)
  try {
    const ctx = makeFakeContext(directory, registered)
    await tokenscopeV2.setup(ctx as any)

    expect(registered).toHaveLength(1)
    expect(registered[0].name).toBe("tokenscope")
    expect(registered[0].input.type).toBe("object")

    const result = await registered[0].execute({}, { sessionID: "ses_v2", messageID: "msg_call" })
    expect(typeof result.content).toBe("string")
    expect(result.content).toContain("Token analysis complete!")

    const reportPath = result.content.match(/saved to: (.+)/)?.[1]
    expect(reportPath).toBeDefined()

    const report = await fs.readFile(reportPath.trim(), "utf8")
    expect(report).toContain("Token Analysis: Session ses_v2")
    await fs.rm(path.dirname(reportPath.trim()), { recursive: true, force: true })
  } finally {
    process.chdir(previousCwd)
    await fs.rm(directory, { recursive: true, force: true })
  }
})
