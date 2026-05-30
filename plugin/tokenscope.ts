// OpenCode Token Analyzer Plugin - Main Entry Point

import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin/tool"
import path from "path"

import type { SessionInfo, SessionMessage } from "./tokenscope-lib/types.js"
import { DEFAULT_ENTRY_LIMIT, loadModelPricing, loadTokenscopeConfig } from "./tokenscope-lib/config.js"
import { TokenizerManager } from "./tokenscope-lib/tokenizer.js"
import { ModelResolver, ContentCollector, TokenAnalysisEngine } from "./tokenscope-lib/analyzer.js"
import { CostCalculator } from "./tokenscope-lib/cost.js"
import { SubagentAnalyzer } from "./tokenscope-lib/subagent.js"
import { OutputFormatter } from "./tokenscope-lib/formatter.js"
import { ContextAnalyzer } from "./tokenscope-lib/context.js"
import { SkillAnalyzer } from "./tokenscope-lib/skill.js"
import { fetchSessionMessages, tryFetchSessionInfo, unwrapResponseData } from "./tokenscope-lib/opencode.js"
import { WarningCollector, formatErrorMessage } from "./tokenscope-lib/warnings.js"
import { buildFailureReport, REPORT_FILENAME, writeReport } from "./tokenscope-lib/report.js"
import {
  addModelSupportWarnings,
  applySessionInfoTotals,
  buildAggregateOnlyAnalysis,
  finalizeAnalysisReport,
  hasSessionInfoAggregateActivity,
  resolveSessionID,
} from "./tokenscope-lib/session-workflow.js"

export const TokenAnalyzerPlugin: Plugin = async ({ client, serverUrl, directory }) => {
  const pricingData = await loadModelPricing()
  const config = await loadTokenscopeConfig()

  const modelResolver = new ModelResolver()
  const contentCollector = new ContentCollector()
  const costCalculator = new CostCalculator(pricingData)

  return {
    tool: {
      tokenscope: tool({
        description:
          "Analyze token usage across the current session with detailed breakdowns by category (system, user, assistant, tools, reasoning). " +
          "Provides visual charts, identifies top token consumers, and includes costs from subagent (Task tool) child sessions.",
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
          const outputPath = path.join(process.cwd(), REPORT_FILENAME)
          const warnings = new WarningCollector()
          const tokenizerManager = new TokenizerManager(warnings)
          const analysisEngine = new TokenAnalysisEngine(tokenizerManager, contentCollector)
          const subagentAnalyzer = new SubagentAnalyzer(client, costCalculator, warnings)
          const contextAnalyzer = new ContextAnalyzer(tokenizerManager, warnings)
          const skillAnalyzer = new SkillAnalyzer(client, tokenizerManager, serverUrl, directory, warnings)
          const formatter = new OutputFormatter(costCalculator)
          formatter.setConfig(config)

          const sessionID = resolveSessionID(args.sessionID, context.sessionID)
          if (!sessionID) {
            const output = buildFailureReport(undefined, warnings.list(), "No session ID available for token analysis")
            const writeError = await writeReport(outputPath, output)
            if (writeError) {
              return `TokenScope could not run: no session ID was available, and the fallback report could not be written. ${writeError}`
            }
            return `TokenScope could not run because no session ID was available. A fallback report was saved to: ${outputPath}`
          }

          try {
            const [sessionInfoResponse, response] = await Promise.all([
              tryFetchSessionInfo(client, sessionID),
              fetchSessionMessages(client, sessionID),
            ])
            const sessionInfo = sessionInfoResponse
              ? unwrapResponseData<SessionInfo | undefined>(sessionInfoResponse)
              : undefined
            const messages: SessionMessage[] = unwrapResponseData<SessionMessage[]>(response ?? [])

            if (!Array.isArray(messages)) {
              const output = buildFailureReport(sessionID, warnings.list(), `Session ${sessionID} has no messages yet.`)
              const writeError = await writeReport(outputPath, output)
              if (writeError) {
                return `Session ${sessionID} has no messages yet, and TokenScope also failed to write ${outputPath}. ${writeError}`
              }
              return `Session ${sessionID} has no messages yet. A short report was saved to: ${outputPath}`
            }

            if (messages.length === 0) {
              if (!hasSessionInfoAggregateActivity(sessionInfo)) {
                const output = buildFailureReport(sessionID, warnings.list(), `Session ${sessionID} has no messages yet.`)
                const writeError = await writeReport(outputPath, output)
                if (writeError) {
                  return `Session ${sessionID} has no messages yet, and TokenScope also failed to write ${outputPath}. ${writeError}`
                }
                return `Session ${sessionID} has no messages yet. A short report was saved to: ${outputPath}`
              }

              const modelProbeMessages: SessionMessage[] = sessionInfo
                ? [
                    {
                      info: {
                        id: sessionID,
                        role: "assistant",
                        providerID: sessionInfo.providerID ?? sessionInfo.model?.providerID,
                        modelID: sessionInfo.modelID ?? sessionInfo.model?.modelID ?? sessionInfo.model?.id,
                      },
                      parts: [],
                    },
                  ]
                : []
              const { model: tokenModel, providerID, modelID } = modelResolver.resolveModelAndProvider(modelProbeMessages)
              const pricingModelName = costCalculator.buildLookupKey(providerID, modelID) || tokenModel.name

              warnings.add(
                `Session ${sessionID} has no exported messages; TokenScope is using persisted OpenCode session token/cost aggregates only.`,
                `aggregate-only:${sessionID}`
              )
              addModelSupportWarnings(warnings, costCalculator, tokenModel, providerID, modelID, pricingModelName)

              const analysis = buildAggregateOnlyAnalysis({ sessionID, sessionInfo: sessionInfo!, tokenModel, pricingModelName })
              return await finalizeAnalysisReport({
                analysis,
                messages,
                sessionID,
                tokenModel,
                providerID,
                modelID,
                pricingModelName,
                includeSubagents: args.includeSubagents,
                config,
                costCalculator,
                subagentAnalyzer,
                contextAnalyzer,
                skillAnalyzer,
                warnings,
                formatter,
                outputPath,
              })
            }

            const { model: tokenModel, providerID, modelID } = modelResolver.resolveModelAndProvider(messages)
            const pricingModelName = costCalculator.buildLookupKey(providerID, modelID) || tokenModel.name

            addModelSupportWarnings(warnings, costCalculator, tokenModel, providerID, modelID, pricingModelName)

            const analysis = await analysisEngine.analyze(
              sessionID,
              messages,
              tokenModel,
              args.limitMessages ?? DEFAULT_ENTRY_LIMIT
            )
            analysis.pricingModelName = pricingModelName
            applySessionInfoTotals(analysis, sessionInfo)

            return await finalizeAnalysisReport({
              analysis,
              messages,
              sessionID,
              tokenModel,
              providerID,
              modelID,
              pricingModelName,
              includeSubagents: args.includeSubagents,
              config,
              costCalculator,
              subagentAnalyzer,
              contextAnalyzer,
              skillAnalyzer,
              warnings,
              formatter,
              outputPath,
            })
          } catch (error) {
            const fatalMessage = formatErrorMessage(error)
            warnings.add(
              `TokenScope returned a fallback report instead of aborting the session: ${fatalMessage}`,
              `fatal:${sessionID}`
            )

            const output = buildFailureReport(sessionID, warnings.list(), fatalMessage)
            const writeError = await writeReport(outputPath, output)
            if (writeError) {
              return `TokenScope hit an error but avoided crashing the session. It also failed to write ${outputPath}. ${writeError}`
            }

            return `TokenScope hit an error but avoided crashing the session. A fallback report was saved to: ${outputPath}`
          }
        },
      }),
    },
  }
}

// Default export for convenience
export default TokenAnalyzerPlugin
