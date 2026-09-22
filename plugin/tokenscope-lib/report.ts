import fs from "fs/promises"
import { randomUUID } from "node:crypto"
import os from "node:os"
import path from "node:path"

import type { TokenAnalysis } from "./types.js"
import { formatErrorMessage } from "./warnings.js"

function safeFilenamePart(value: string | undefined, fallback: string): string {
  const normalized = value?.trim().replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "")
  return normalized?.slice(0, 100) || fallback
}

export function buildReportFilename(sessionID?: string, invocationID?: string, nonce = randomUUID()): string {
  const session = safeFilenamePart(sessionID, "unknown-session")
  const invocation = safeFilenamePart(invocationID, "unknown-invocation")
  const unique = safeFilenamePart(nonce, "unknown-run")
  return `token-usage-output-${session}-${invocation}-${unique}.txt`
}

async function ensurePrivateRoot(candidate: string): Promise<string | null> {
  try {
    await fs.mkdir(candidate, { recursive: true, mode: 0o700 })
    const stat = await fs.lstat(candidate)
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      return null
    }
    if (process.platform !== "win32") {
      if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
        return null
      }
      if ((stat.mode & 0o022) !== 0) {
        return null
      }
    }
    return candidate
  } catch {
    return null
  }
}

/**
 * Candidate private report roots, in preference order.
 *
 * The first entry matches OpenCode v1's own temp directory. Some OpenCode
 * installations create `$TMPDIR/opencode` with group/other write access, which
 * is unsafe for session text, so we fall back to a user-owned directory rather
 * than failing the analysis.
 */
function reportRootCandidates(): string[] {
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined
  const suffix = uid === undefined ? "" : `-${uid}`
  return [
    path.join(os.tmpdir(), "opencode"),
    path.join(os.tmpdir(), `opencode-tokenscope${suffix}`),
    path.join(os.homedir(), ".cache", "opencode-tokenscope", "tmp"),
  ]
}

export async function createReportPath(
  sessionID?: string,
  invocationID?: string,
  nonce = randomUUID()
): Promise<string> {
  let root: string | null = null

  for (const candidate of reportRootCandidates()) {
    root = await ensurePrivateRoot(candidate)
    if (root) break
  }

  if (!root) {
    throw new Error("Could not find a writable private directory for the TokenScope report")
  }

  const directory = await fs.mkdtemp(path.join(root, "tokenscope-"))
  return path.join(directory, buildReportFilename(sessionID, invocationID, nonce))
}

export async function writeReport(outputPath: string, output: string): Promise<string | null> {
  const tempPath = `${outputPath}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(tempPath, output, { encoding: "utf8", flag: "wx", mode: 0o600 })
    await fs.rename(tempPath, outputPath)
    return null
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {})
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
    `\nRetained local content estimate: ${formattedLocalEstimated}` +
    `\nRecorded telemetry total: ${formattedMainTelemetry}` +
    `\nSnapshot boundary: completed provider steps before this TokenScope tool invocation finishes`

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
