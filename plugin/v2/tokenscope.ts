// OpenCode Token Analyzer Plugin - Main Entry Point (OpenCode V2 plugin API)

// The plugin SDK is imported for types only, so this module loads without the SDK installed.
import type { Plugin } from "@opencode/plugin"

import type { ModelPricing, TokenscopeConfig } from "./tokenscope-lib/types.js"
import { DEFAULT_ENTRY_LIMIT, loadModelPricing, loadTokenscopeConfig } from "./tokenscope-lib/config.js"
import { TokenizerManager } from "./tokenscope-lib/tokenizer.js"
import { ModelResolver, ContentCollector, TokenAnalysisEngine } from "./tokenscope-lib/analyzer.js"
import { CostCalculator } from "./tokenscope-lib/cost.js"
import { SubagentAnalyzer } from "./tokenscope-lib/subagent.js"
import { OutputFormatter } from "./tokenscope-lib/formatter.js"
import { ContextAnalyzer } from "./tokenscope-lib/context.js"
import { SkillAnalyzer } from "./tokenscope-lib/skill.js"
import {
  captureRequestSnapshot,
  hasCompactedHistory,
  normalizeMessages,
  RequestSnapshotStore,
  type OpenCodeContext,
} from "./tokenscope-lib/opencode.js"
import { ModelMetadataResolver } from "./tokenscope-lib/metadata.js"
import { WarningCollector, formatErrorMessage } from "./tokenscope-lib/warnings.js"
import { buildFailureReport, buildSuccessSummary, createReportPath, writeReport } from "./tokenscope-lib/report.js"
import {
  addModelSupportWarnings,
  addPerModelPricingWarnings,
  addSessionAggregateWarnings,
  attachConfiguredAnalyses,
} from "./tokenscope-lib/session-workflow.js"

const PLUGIN_ID = "tokenscope"
const TOOL_NAME = "tokenscope"
const COMMAND_NAME = "tokenscope"

const TOOL_DESCRIPTION =
  "Analyze token usage across the current session with detailed breakdowns by category (system, user, assistant, tools, reasoning). " +
  "Provides visual charts, identifies top token consumers, and includes costs from subagent child sessions."

const TOOL_INPUT = {
  type: "object",
  properties: {
    sessionID: {
      type: "string",
      description: "Optional explicit session ID. Leave unset to analyze the current session.",
    },
    limitMessages: {
      type: "integer",
      minimum: 1,
      maximum: 10,
      description: `How many top entries to list per category (default: ${DEFAULT_ENTRY_LIMIT})`,
    },
    includeSubagents: {
      type: "boolean",
      description: "Include token costs from subagent child sessions (default: true)",
    },
  },
  additionalProperties: false,
}

const COMMAND_DESCRIPTION = "Analyze token usage across the current session with detailed breakdowns by category"

const COMMAND_PROMPT = [
  `Call the ${TOOL_NAME} tool directly without delegating to other agents.`,
  "Leave sessionID unset unless the user explicitly asked to analyze a different session.",
  "Then read the exact unique report path returned by TokenScope.",
  "Return that file verbatim without additional text or formatting.",
].join("\n")

interface TokenscopeArgs {
  sessionID?: string
  limitMessages?: number
  includeSubagents?: boolean
}

interface TokenscopeRuntime {
  ctx: OpenCodeContext
  snapshots: RequestSnapshotStore
  // Set when capturing a model request failed, so reports can say why measured context is missing.
  captureFailure: { message?: string }
  pricingData: Record<string, ModelPricing>
  config: TokenscopeConfig
}

function readArgs(input: unknown): TokenscopeArgs {
  const args = (input ?? {}) as Record<string, unknown>
  return {
    sessionID: typeof args.sessionID === "string" && args.sessionID.trim() ? args.sessionID.trim() : undefined,
    limitMessages: typeof args.limitMessages === "number" ? args.limitMessages : undefined,
    includeSubagents: typeof args.includeSubagents === "boolean" ? args.includeSubagents : undefined,
  }
}

async function runTokenscope(
  runtime: TokenscopeRuntime,
  args: TokenscopeArgs,
  invocation: { sessionID: string; messageID: string }
): Promise<string> {
  const { ctx, snapshots, pricingData, config } = runtime
  const sessionID = args.sessionID ?? invocation.sessionID
  const warnings = new WarningCollector()

  // Reports go to a private per-invocation file under OpenCode's temporary directory, which
  // agents may read without an external-directory prompt. Analyzed worktrees stay untouched.
  let outputPath: string
  try {
    outputPath = await createReportPath(sessionID, invocation.messageID)
  } catch (error) {
    return `TokenScope could not create a private temporary report location: ${formatErrorMessage(error)}`
  }

  try {
    const session = await ctx.session.get({ sessionID })
    const rawMessages = await ctx.session.context({ sessionID })
    const messages = normalizeMessages(rawMessages)

    if (messages.length === 0) {
      const output = buildFailureReport(sessionID, warnings.list(), `Session ${sessionID} has no messages yet.`)
      const writeError = await writeReport(outputPath, output)
      if (writeError) {
        return `Session ${sessionID} has no messages yet, and TokenScope also failed to write ${outputPath}. ${writeError}`
      }
      return `Session ${sessionID} has no messages yet. A short report was saved to: ${outputPath}`
    }

    if (runtime.captureFailure.message) {
      warnings.add(
        `TokenScope could not capture a model request, so measured context may be missing: ${runtime.captureFailure.message}`,
        "request-capture"
      )
    }

    const snapshot = snapshots.get(sessionID)
    const tokenizerManager = new TokenizerManager(warnings)
    const analysisEngine = new TokenAnalysisEngine(tokenizerManager, new ContentCollector())
    const { model: tokenModel, providerID, modelID } = new ModelResolver().resolveModelAndProvider(messages)
    const metadataResolver = new ModelMetadataResolver(ctx.model, warnings)
    const costCalculator = new CostCalculator(await metadataResolver.mergePricingData(pricingData))
    const formatter = new OutputFormatter(costCalculator)
    formatter.setConfig(config)
    const pricingModelName = costCalculator.buildLookupKey(providerID, modelID) || tokenModel.name

    addModelSupportWarnings(warnings, costCalculator, tokenModel, providerID, modelID, pricingModelName)

    const analysis = await analysisEngine.analyze(
      sessionID,
      messages,
      tokenModel,
      args.limitMessages ?? DEFAULT_ENTRY_LIMIT,
      snapshot
    )
    analysis.pricingModelName = pricingModelName

    addSessionAggregateWarnings(warnings, analysis, session, { compacted: hasCompactedHistory(rawMessages) })
    addPerModelPricingWarnings(warnings, costCalculator, analysis, pricingModelName)
    await attachConfiguredAnalyses({
      analysis,
      messages,
      sessionID,
      snapshot,
      sessionPermissions: session.permissions,
      tokenModel,
      pricingModelName,
      includeSubagents: args.includeSubagents,
      config,
      costCalculator,
      subagentAnalyzer: new SubagentAnalyzer(ctx.session, costCalculator, warnings),
      contextAnalyzer: new ContextAnalyzer(tokenizerManager, warnings),
      skillAnalyzer: new SkillAnalyzer(ctx, tokenizerManager, warnings),
    })

    analysis.warnings = warnings.list()

    const writeError = await writeReport(outputPath, formatter.format(analysis))
    if (writeError) {
      return writeError
    }

    return buildSuccessSummary(outputPath, analysis)
  } catch (error) {
    const fatalMessage = formatErrorMessage(error)
    warnings.add(`TokenScope returned a fallback report instead of failing the tool call: ${fatalMessage}`, `fatal:${sessionID}`)

    const output = buildFailureReport(sessionID, warnings.list(), fatalMessage)
    const writeError = await writeReport(outputPath, output)
    if (writeError) {
      return `TokenScope hit an error and also failed to write ${outputPath}. ${writeError}`
    }

    return `TokenScope hit an error. A fallback report was saved to: ${outputPath}`
  }
}

const plugin: Plugin.Plugin = {
  id: PLUGIN_ID,
  async setup(ctx) {
    const runtime: TokenscopeRuntime = {
      ctx,
      snapshots: new RequestSnapshotStore(),
      captureFailure: {},
      pricingData: await loadModelPricing(),
      config: await loadTokenscopeConfig(ctx.options),
    }

    // Remember each session's latest system prompt and tool definitions so reports measure the
    // real request context. This hook runs on every model request, so it must never fail one.
    await ctx.session.hook("context", (event) => {
      try {
        runtime.snapshots.set(event.sessionID, captureRequestSnapshot(event))
      } catch (error) {
        runtime.captureFailure.message = formatErrorMessage(error)
      }
    })

    await ctx.tool.transform((editor) => {
      editor.add({
        name: TOOL_NAME,
        description: TOOL_DESCRIPTION,
        input: TOOL_INPUT,
        // Expose the tool directly instead of only through Code Mode, so /tokenscope can call it.
        options: { codemode: false },
        execute: async (input, context) => ({
          content: await runTokenscope(runtime, readArgs(input), context),
        }),
      })
    })

    await ctx.command.transform((editor) => {
      editor.add({
        name: COMMAND_NAME,
        description: COMMAND_DESCRIPTION,
        execute: async ({ sessionID, prompt, delivery }) => {
          const request = prompt.text.trim()
          await ctx.session.prompt({
            ...prompt,
            sessionID,
            text: request ? `${COMMAND_PROMPT}\n\n${request}` : COMMAND_PROMPT,
            delivery,
          })
        },
      })
    })
  },
}

export default plugin
