// OpenCode Token Analyzer Plugin - main entrypoint.
//
// The default export supports both OpenCode plugin APIs from one package:
//  - OpenCode v2 reads `id` + `setup(ctx)` (spread in from tokenscope-v2.ts).
//  - OpenCode v1 (>= 1.18.29) reads `server` and calls it with the v1 plugin
//    input. Older v1 releases should pin the 1.x line of this package.

import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin/tool"

import { runTokenAnalysis } from "./tokenscope-lib/run.js"
import { resolveSessionID } from "./tokenscope-lib/session-workflow.js"
import { tokenscopeV2 } from "./tokenscope-v2.js"

const TOOL_DESCRIPTION =
  "Analyze token usage across the current session with detailed breakdowns by category (system, user, assistant, tools, reasoning). " +
  "Provides visual charts, identifies top token consumers, and includes costs from subagent (Task tool) child sessions."

export const TokenAnalyzerPlugin: Plugin = async ({ client, serverUrl, directory }) => {
  return {
    tool: {
      tokenscope: tool({
        description: TOOL_DESCRIPTION,
        args: {
          sessionID: tool.schema
            .string()
            .optional()
            .describe("Optional explicit session ID. Leave unset to analyze the current session."),
          limitMessages: tool.schema.number().int().min(1).max(10).optional(),
          includeSubagents: tool.schema
            .boolean()
            .optional()
            .describe("Include token costs from subagent child sessions (default: true)"),
        },
        async execute(args, context) {
          return await runTokenAnalysis({
            client,
            directory: context.directory || directory || process.cwd(),
            serverUrl,
            sessionID: resolveSessionID(args.sessionID, context.sessionID),
            messageID: context.messageID,
            limitMessages: args.limitMessages,
            includeSubagents: args.includeSubagents,
          })
        },
      }),
    },
  }
}

// Combined entrypoint for OpenCode v1 and v2.
export default {
  ...tokenscopeV2,
  server: TokenAnalyzerPlugin,
}

export { tokenscopeV2 }
