// OpenCode v2 plugin entrypoint.
//
// OpenCode v2 loads a default-exported definition with a stable `id` and a
// `setup(ctx)` function. Tools are registered through `ctx.tool.transform`
// with a JSON Schema input, and the executor returns structured content.

import type { Plugin } from "@opencode/plugin"

import { runTokenAnalysis } from "./tokenscope-lib/run.js"
import { createV2Client } from "./tokenscope-lib/v2-adapter.js"
import { resolveSessionID } from "./tokenscope-lib/session-workflow.js"

const TOOL_DESCRIPTION =
  "Analyze token usage across the current session with detailed breakdowns by category (system, user, assistant, tools, reasoning). " +
  "Provides visual charts, identifies top token consumers, and includes costs from subagent (Task tool) child sessions."

const TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    sessionID: {
      type: "string",
      description: "Optional explicit session ID. Leave unset to analyze the current session.",
    },
    limitMessages: {
      type: "number",
      minimum: 1,
      maximum: 10,
      description: "Entries shown per category (default 3).",
    },
    includeSubagents: {
      type: "boolean",
      description: "Include token costs from subagent child sessions (default: true).",
    },
  },
  additionalProperties: false,
} as const

export interface TokenscopeV2Plugin {
  id: string
  setup: (ctx: Plugin.Context) => Promise<void>
}

export const tokenscopeV2: TokenscopeV2Plugin = {
  id: "tokenscope",

  async setup(ctx: Plugin.Context) {
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "tokenscope",
        description: TOOL_DESCRIPTION,
        input: TOOL_INPUT_SCHEMA,
        async execute(input: any, toolContext: any) {
          const directory = ctx.location?.directory ?? process.cwd()
          const client = createV2Client(ctx, directory)

          const content = await runTokenAnalysis({
            client,
            directory,
            sessionID: resolveSessionID(input?.sessionID, toolContext?.sessionID),
            messageID: toolContext?.messageID,
            limitMessages: input?.limitMessages,
            includeSubagents: input?.includeSubagents,
          })

          return { content }
        },
      })
    })
  },
}

export default tokenscopeV2
