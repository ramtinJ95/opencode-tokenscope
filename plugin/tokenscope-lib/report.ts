import fs from "fs/promises"

import type { TokenAnalysis } from "./types.js"
import { formatErrorMessage } from "./warnings.js"

export const REPORT_FILENAME = "token-usage-output.txt"

export async function writeReport(outputPath: string, output: string): Promise<string | null> {
  try {
    try {
      await fs.unlink(outputPath)
    } catch {}

    await fs.writeFile(outputPath, output, { encoding: "utf8", flag: "w" })
    return null
  } catch (error) {
    return `Failed to write token analysis to ${outputPath}: ${formatErrorMessage(error)}`
  }
}

function shellSingleQuote(value: string): string {
  const escaped = value.replace(/'/g, "'\\''")
  return `'${escaped}'`
}

export function buildFailureReport(sessionID: string | undefined, warnings: string[], fatalMessage: string): string {
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

export function buildSuccessSummary(outputPath: string, analysis: TokenAnalysis): string {
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

  summaryMsg += `\n\nUse: cat ${shellSingleQuote(outputPath)} (or read the file) to view the complete analysis.`

  return summaryMsg
}
