// OpenCode Token Analyzer Plugin - Main Entry Point

import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import path from "path"
import fs from "fs/promises"
import os from "os"

import type { SessionMessage } from "./tokenscope-lib/types"
import { DEFAULT_ENTRY_LIMIT, loadModelPricing, loadTokenscopeConfig } from "./tokenscope-lib/config"
import { TokenizerManager } from "./tokenscope-lib/tokenizer"
import { ModelResolver, ContentCollector, TokenAnalysisEngine } from "./tokenscope-lib/analyzer"
import { CostCalculator } from "./tokenscope-lib/cost"
import { SubagentAnalyzer } from "./tokenscope-lib/subagent"
import { OutputFormatter } from "./tokenscope-lib/formatter"
import { ContextAnalyzer } from "./tokenscope-lib/context"
import { SkillAnalyzer } from "./tokenscope-lib/skill"
import { fetchSessionMessages, unwrapResponseData } from "./tokenscope-lib/opencode"
import { WarningCollector, formatErrorMessage } from "./tokenscope-lib/warnings"

const REPORT_FILENAME = "token-usage-output.txt"

type OutputPathOptions = {
  outputPath?: string
  envOutputPath?: string
  sessionID?: string
  modelName?: string
  now?: Date
}

function formatDateParts(now: Date): { date: string; time: string; datetime: string; datetimeCompact: string } {
  const iso = now.toISOString()
  const [datePart, timePartRaw] = iso.split("T")
  const timePart = (timePartRaw ?? "").split(".")[0] ?? "00:00:00"
  const safeTime = timePart.replace(/:/g, "-")
  const compactDate = datePart.replace(/-/g, "")
  const hhmm = safeTime.split("-").slice(0, 2).join("")
  return {
    date: datePart,
    time: safeTime,
    datetime: `${datePart}_${safeTime}`,
    datetimeCompact: `${compactDate}_${hhmm}`,
  }
}

function sanitizePathToken(value: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9._-]+/g, "-")
  const collapsed = normalized.replace(/-+/g, "-").replace(/^-|-$/g, "")
  return collapsed || "unknown"
}

function expandHomeDirectory(rawPath: string): string {
  if (rawPath === "~") return os.homedir()
  if (rawPath.startsWith("~/")) return path.join(os.homedir(), rawPath.slice(2))
  return rawPath
}

function resolveOutputPath(options: OutputPathOptions): string {
  const now = options.now ?? new Date()
  const { date, time, datetime, datetimeCompact } = formatDateParts(now)
  const session = sanitizePathToken(options.sessionID ?? "unknown-session")
  const model = sanitizePathToken(options.modelName ?? "unknown-model")

  const configuredPath = options.outputPath ?? options.envOutputPath
  const template = (configuredPath ?? REPORT_FILENAME).trim() || REPORT_FILENAME
  const withPlaceholders = template
    .replace(/%date%/g, date)
    .replace(/%time%/g, time)
    .replace(/%datetime%/g, datetime)
    .replace(/%datetime_compact%/g, datetimeCompact)
    .replace(/%session%/g, session)
    .replace(/%model%/g, model)

  const expanded = expandHomeDirectory(withPlaceholders)
  const resolved = path.isAbsolute(expanded) ? expanded : path.resolve(process.cwd(), expanded)

  if (!resolved || resolved.includes("\0")) {
    throw new Error("Invalid outputPath: resolved path is empty or contains invalid characters")
  }

  return resolved
}

async function writeReport(outputPath: string, output: string): Promise<string | null> {
  try {
    const outputDir = path.dirname(outputPath)
    await fs.mkdir(outputDir, { recursive: true })

    try {
      await fs.unlink(outputPath)
    } catch {}

    await fs.writeFile(outputPath, output, { encoding: "utf8", flag: "w" })
    return null
  } catch (error) {
    return `Failed to write token analysis to ${outputPath}: ${formatErrorMessage(error)}`
  }
}

function buildFailureReport(sessionID: string | undefined, warnings: string[], fatalMessage: string): string {
  const lines: string[] = []
  const timestamp = new Date().toISOString()

  lines.push("═══════════════════════════════════════════════════════════════════════════")
  lines.push(`Token Analysis: Session ${sessionID ?? "unknown"}`)
  lines.push("Status: Partial / failed analysis")
  lines.push("═══════════════════════════════════════════════════════════════════════════")
  lines.push("")
  lines.push(`Timestamp: ${timestamp}`)
  lines.push("")
  lines.push("TokenScope hit a non-fatal error and returned this fallback report so the OpenCode session stays usable.")
  lines.push("")
  lines.push(`Fatal error: ${fatalMessage}`)

  if (warnings.length > 0) {
    lines.push("")
    lines.push("Warnings:")
    for (const warning of warnings) {
      lines.push(`- ${warning}`)
    }
  }

  lines.push("")
  lines.push("Try again after switching to a supported model or updating the plugin.")
  return lines.join("\n")
}

function normalizeSessionID(sessionID?: string): string | undefined {
  const normalized = sessionID?.trim()
  return normalized ? normalized : undefined
}

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
          outputPath: tool.schema
            .string()
            .optional()
            .describe(
              "Optional output path for the report. Supports %date%, %time%, %datetime%, %datetime_compact%, %session%, and %model% placeholders. If omitted, TOKENSCOPE_OUTPUT_FILE is used when set."
            ),
        },
        async execute(args, context) {
          const warnings = new WarningCollector()
          const tokenizerManager = new TokenizerManager(warnings)
          const analysisEngine = new TokenAnalysisEngine(tokenizerManager, contentCollector)
          const subagentAnalyzer = new SubagentAnalyzer(client, costCalculator, warnings)
          const contextAnalyzer = new ContextAnalyzer(tokenizerManager, warnings)
          const skillAnalyzer = new SkillAnalyzer(client, tokenizerManager, serverUrl, directory, warnings)
          const formatter = new OutputFormatter(costCalculator)
          formatter.setConfig(config)

          const sessionID = normalizeSessionID(args.sessionID) ?? normalizeSessionID(context.sessionID)
          const resolveReportPath = (modelName?: string) =>
            resolveOutputPath({
              outputPath: args.outputPath,
              envOutputPath: process.env.TOKENSCOPE_OUTPUT_FILE,
              sessionID,
              modelName,
            })
          const resolveReportPathSafe = (modelName?: string): { path?: string; error?: string } => {
            try {
              return { path: resolveReportPath(modelName) }
            } catch (error) {
              return { error: `Invalid outputPath: ${formatErrorMessage(error)}` }
            }
          }

          if (!sessionID) {
            const pathResult = resolveReportPathSafe()
            if (!pathResult.path) return pathResult.error ?? "Invalid outputPath"
            const outputPath = pathResult.path
            const output = buildFailureReport(undefined, warnings.list(), "No session ID available for token analysis")
            const writeError = await writeReport(outputPath, output)
            if (writeError) {
              return `TokenScope could not run: no session ID was available, and the fallback report could not be written. ${writeError}`
            }
            return `TokenScope could not run because no session ID was available. A fallback report was saved to: ${outputPath}`
          }

          try {
            const response = await fetchSessionMessages(client, sessionID)
            const messages: SessionMessage[] = unwrapResponseData<SessionMessage[]>(response ?? [])

            if (!Array.isArray(messages) || messages.length === 0) {
              const pathResult = resolveReportPathSafe()
              if (!pathResult.path) return pathResult.error ?? "Invalid outputPath"
              const outputPath = pathResult.path
              const output = buildFailureReport(sessionID, warnings.list(), `Session ${sessionID} has no messages yet.`)
              const writeError = await writeReport(outputPath, output)
              if (writeError) {
                return `Session ${sessionID} has no messages yet, and TokenScope also failed to write ${outputPath}. ${writeError}`
              }
              return `Session ${sessionID} has no messages yet. A short report was saved to: ${outputPath}`
            }

            const { model: tokenModel, providerID, modelID } = modelResolver.resolveModelAndProvider(messages)
            const pricingModelName = costCalculator.buildLookupKey(providerID, modelID) || tokenModel.name
            const pathResult = resolveReportPathSafe(modelID || tokenModel.name)
            if (!pathResult.path) return pathResult.error ?? "Invalid outputPath"
            const outputPath = pathResult.path

            if (tokenModel.spec.kind === "approx") {
              warnings.add(
                `Model '${providerID}/${modelID}' is not currently supported by a model-specific tokenizer. Token counts use an approximate character-based fallback.`,
                `unsupported-tokenizer:${providerID}:${modelID}`
              )
            }

            if (!costCalculator.hasPricing(pricingModelName)) {
              warnings.add(
                `Pricing for '${pricingModelName}' was not found in models.json. Cost estimates use the default fallback rates ($1/M input, $3/M output, no cache pricing).`,
                `missing-pricing:${pricingModelName}`
              )
            }

            const analysis = await analysisEngine.analyze(
              sessionID,
              messages,
              tokenModel,
              args.limitMessages ?? DEFAULT_ENTRY_LIMIT
            )
            analysis.pricingModelName = pricingModelName

            // Subagent analysis (respects config)
            const shouldIncludeSubagents = args.includeSubagents !== false && config.enableSubagentAnalysis
            if (shouldIncludeSubagents) {
              analysis.subagentAnalysis = await subagentAnalyzer.analyzeChildSessions(sessionID)
            }

            // Context analysis (context breakdown, tool estimates, cache efficiency)
            const pricing = costCalculator.getPricing(pricingModelName)
            const contextResult = await contextAnalyzer.analyze(sessionID, tokenModel, pricing, config, messages)

            // Merge context analysis results into main analysis
            if (contextResult.contextBreakdown) {
              analysis.contextBreakdown = contextResult.contextBreakdown
            }
            if (contextResult.toolEstimates) {
              analysis.toolEstimates = contextResult.toolEstimates
            }
            if (contextResult.cacheEfficiency) {
              analysis.cacheEfficiency = contextResult.cacheEfficiency
            }

            // Skill analysis (respects config)
            if (config.enableSkillAnalysis) {
              analysis.skillAnalysis = await skillAnalyzer.analyze(messages, providerID, modelID, tokenModel, config)
            }

            analysis.warnings = warnings.list()

            const output = formatter.format(analysis)
            const writeError = await writeReport(outputPath, output)
            if (writeError) {
              return writeError
            }

            const timestamp = new Date().toISOString()
            const localEstimatedTokens = analysis.totalTokens
            const mainSessionTelemetryTokens =
              analysis.inputTokens +
              analysis.outputTokens +
              analysis.reasoningTokens +
              analysis.cacheReadTokens +
              analysis.cacheWriteTokens
            const formattedLocalEstimated = new Intl.NumberFormat("en-US").format(localEstimatedTokens)
            const formattedMainTelemetry = new Intl.NumberFormat("en-US").format(mainSessionTelemetryTokens)

            let summaryMsg =
              `Token analysis complete! Full report saved to: ${outputPath}` +
              `\n\nTimestamp: ${timestamp}` +
              `\nLocal estimated content tokens: ${formattedLocalEstimated}` +
              `\nSession telemetry total: ${formattedMainTelemetry}`

            if (analysis.subagentAnalysis && analysis.subagentAnalysis.subagents.length > 0) {
              const subagentTokens = new Intl.NumberFormat("en-US").format(analysis.subagentAnalysis.totalTokens)
              const grandTotal = new Intl.NumberFormat("en-US").format(
                mainSessionTelemetryTokens + analysis.subagentAnalysis.totalTokens
              )
              summaryMsg += `\nSubagent sessions: ${analysis.subagentAnalysis.subagents.length} (${subagentTokens} tokens)`
              summaryMsg += `\nGrand total: ${grandTotal} tokens`
            }

            if (analysis.warnings.length > 0) {
              summaryMsg += `\nWarnings: ${analysis.warnings.length} (see report for details)`
            }

            summaryMsg += `\n\nUse: cat ${REPORT_FILENAME} (or read the file) to view the complete analysis.`

            return summaryMsg
          } catch (error) {
            const pathResult = resolveReportPathSafe()
            if (!pathResult.path) return pathResult.error ?? "Invalid outputPath"
            const outputPath = pathResult.path
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
