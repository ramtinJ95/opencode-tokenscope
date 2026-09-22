// Shared TokenScope analysis workflow.
//
// Both entrypoints use this:
//  - tokenscope.ts   (OpenCode v1 plugin shape)
//  - tokenscope-v2.ts (OpenCode v2 plugin shape)
//
// The workflow only depends on the normalized `client` surface defined in
// opencode.ts, so a v1 SDK client and a v2 plugin-context adapter are
// interchangeable.

import type { SessionMessage } from "./types.js"
import { DEFAULT_ENTRY_LIMIT, loadModelPricing, loadTokenscopeConfig } from "./config.js"
import { TokenizerManager } from "./tokenizer.js"
import { ModelResolver, ContentCollector, TokenAnalysisEngine } from "./analyzer.js"
import { CostCalculator } from "./cost.js"
import { SubagentAnalyzer } from "./subagent.js"
import { OutputFormatter } from "./formatter.js"
import { ContextAnalyzer } from "./context.js"
import { SkillAnalyzer } from "./skill.js"
import { fetchSession, fetchSessionMessages, unwrapResponseData } from "./opencode.js"
import { ModelMetadataResolver } from "./metadata.js"
import { WarningCollector, formatErrorMessage } from "./warnings.js"
import { buildFailureReport, buildSuccessSummary, createReportPath, writeReport } from "./report.js"
import {
  addModelSupportWarnings,
  addPerModelPricingWarnings,
  addSessionAggregateWarnings,
  attachConfiguredAnalyses,
} from "./session-workflow.js"

export interface RunTokenAnalysisOptions {
  /** Normalized OpenCode client (v1 SDK client or v2 plugin-context adapter). */
  client: any
  /** Session id to analyze. Callers resolve "current session" before calling. */
  sessionID: string | undefined
  /** Directory the session belongs to (used for routing and report context). */
  directory: string
  /** Optional server URL used by v1 skill/agent fallback fetches. */
  serverUrl?: URL
  /** Invocation message id, used only to make report filenames unique. */
  messageID?: string
  /** Entries shown per category (1-10). */
  limitMessages?: number
  /** Include subagent child-session usage (default true). */
  includeSubagents?: boolean
}

export async function runTokenAnalysis(options: RunTokenAnalysisOptions): Promise<string> {
  const pricingData = await loadModelPricing()
  const config = await loadTokenscopeConfig()

  const sessionDirectory = options.directory || process.cwd()
  const warnings = new WarningCollector()
  const tokenizerManager = new TokenizerManager(warnings)
  const contentCollector = new ContentCollector()
  const analysisEngine = new TokenAnalysisEngine(tokenizerManager, contentCollector)
  const modelResolver = new ModelResolver()
  const routing = { directory: sessionDirectory }
  const contextAnalyzer = new ContextAnalyzer(tokenizerManager, warnings, options.client, sessionDirectory)
  const skillAnalyzer = new SkillAnalyzer(options.client, tokenizerManager, options.serverUrl, sessionDirectory, warnings)

  const sessionID = options.sessionID

  let outputPath: string
  try {
    outputPath = await createReportPath(sessionID, options.messageID)
  } catch (error) {
    return `TokenScope could not create a private temporary report location: ${formatErrorMessage(error)}`
  }

  if (!sessionID) {
    const output = buildFailureReport(undefined, warnings.list(), "No session ID available for token analysis")
    const writeError = await writeReport(outputPath, output)
    if (writeError) {
      return `TokenScope could not run: no session ID was available, and the fallback report could not be written. ${writeError}`
    }
    return `TokenScope could not run because no session ID was available. A fallback report was saved to: ${outputPath}`
  }

  try {
    const response = await fetchSessionMessages(options.client, sessionID, routing)
    const messages: SessionMessage[] = unwrapResponseData<SessionMessage[]>(response ?? [])

    if (!Array.isArray(messages) || messages.length === 0) {
      const output = buildFailureReport(sessionID, warnings.list(), `Session ${sessionID} has no messages yet.`)
      const writeError = await writeReport(outputPath, output)
      if (writeError) {
        return `Session ${sessionID} has no messages yet, and TokenScope also failed to write ${outputPath}. ${writeError}`
      }
      return `Session ${sessionID} has no messages yet. A short report was saved to: ${outputPath}`
    }

    const { model: tokenModel, providerID, modelID } = modelResolver.resolveModelAndProvider(messages)
    const metadataResolver = new ModelMetadataResolver(options.client, routing, warnings)
    const costCalculator = new CostCalculator(await metadataResolver.mergePricingData(pricingData))
    const subagentAnalyzer = new SubagentAnalyzer(options.client, costCalculator, warnings, routing)
    const formatter = new OutputFormatter(costCalculator)
    formatter.setConfig(config)
    const pricingModelName = costCalculator.buildLookupKey(providerID, modelID) || tokenModel.name

    addModelSupportWarnings(warnings, costCalculator, tokenModel, providerID, modelID, pricingModelName)

    const analysis = await analysisEngine.analyze(
      sessionID,
      messages,
      tokenModel,
      options.limitMessages ?? DEFAULT_ENTRY_LIMIT
    )
    analysis.pricingModelName = pricingModelName

    try {
      const sessionResponse = await fetchSession(options.client, sessionID, routing)
      addSessionAggregateWarnings(warnings, analysis, unwrapResponseData(sessionResponse ?? {}))
    } catch (error) {
      warnings.add(
        `Could not reconcile message telemetry with the OpenCode session aggregate: ${formatErrorMessage(error)}`,
        `session-aggregate-fetch:${sessionID}`
      )
    }

    addPerModelPricingWarnings(warnings, costCalculator, analysis, pricingModelName)
    await attachConfiguredAnalyses({
      analysis,
      messages,
      sessionID,
      tokenModel,
      providerID,
      modelID,
      pricingModelName,
      includeSubagents: options.includeSubagents,
      config,
      costCalculator,
      subagentAnalyzer,
      contextAnalyzer,
      skillAnalyzer,
    })

    analysis.warnings = warnings.list()

    const output = formatter.format(analysis)
    const writeError = await writeReport(outputPath, output)
    if (writeError) {
      return writeError
    }

    return buildSuccessSummary(outputPath, analysis)
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
}
