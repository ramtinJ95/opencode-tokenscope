// OpenCode Token Analyzer Plugin - Main Entry Point

import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import path from "path"
import fs from "fs/promises"

import type { SessionMessage } from "./tokenscope-lib/types"
import { DEFAULT_ENTRY_LIMIT, loadModelPricing } from "./tokenscope-lib/config"
import { TokenizerManager } from "./tokenscope-lib/tokenizer"
import { ModelResolver, ContentCollector, TokenAnalysisEngine } from "./tokenscope-lib/analyzer"
import { CostCalculator } from "./tokenscope-lib/cost"
import { SubagentAnalyzer } from "./tokenscope-lib/subagent"
import { OutputFormatter } from "./tokenscope-lib/formatter"
import { ContextAnalyzer } from "./tokenscope-lib/context"

export const TokenAnalyzerPlugin: Plugin = async ({ client }) => {
  const pricingData = await loadModelPricing()

  const tokenizerManager = new TokenizerManager()
  const modelResolver = new ModelResolver()
  const contentCollector = new ContentCollector()
  const analysisEngine = new TokenAnalysisEngine(tokenizerManager, contentCollector)
  const costCalculator = new CostCalculator(pricingData)
  const subagentAnalyzer = new SubagentAnalyzer(client, costCalculator, pricingData)
  const contextAnalyzer = new ContextAnalyzer(client, tokenizerManager)
  const formatter = new OutputFormatter(costCalculator)

  return {
    tool: {
      tokenscope: tool({
        description:
          "Analyze token usage across the current session with detailed breakdowns by category (system, user, assistant, tools, reasoning). " +
          "Provides visual charts, identifies top token consumers, and includes costs from subagent (Task tool) child sessions. " +
          "Also analyzes static context: tool definitions with token counts, system prompt breakdown, request composition, and cache efficiency metrics.",
        args: {
          sessionID: tool.schema.string().optional(),
          limitMessages: tool.schema.number().int().min(1).max(10).optional(),
          includeSubagents: tool.schema
            .boolean()
            .optional()
            .describe("Include token costs from subagent child sessions (default: true)"),
        },
        async execute(args, context) {
          const sessionID = args.sessionID ?? context.sessionID
          if (!sessionID) {
            throw new Error("No session ID available for token analysis")
          }

          const response = await client.session.messages({ path: { id: sessionID } })
          const messages: SessionMessage[] = ((response as any)?.data ?? response ?? []) as SessionMessage[]

          if (!Array.isArray(messages) || messages.length === 0) {
            return `Session ${sessionID} has no messages yet.`
          }

          const tokenModel = modelResolver.resolveTokenModel(messages)
          const analysis = await analysisEngine.analyze(
            sessionID,
            messages,
            tokenModel,
            args.limitMessages ?? DEFAULT_ENTRY_LIMIT
          )

          if (args.includeSubagents !== false) {
            analysis.subagentAnalysis = await subagentAnalyzer.analyzeChildSessions(sessionID)
          }

          // Analyze context: tool definitions, system prompt breakdown, efficiency
          try {
            analysis.contextAnalysis = await contextAnalyzer.analyze(
              messages,
              tokenModel,
              analysis.mostRecentInput,
              analysis.mostRecentCacheRead,
              analysis.mostRecentCacheWrite
            )
          } catch (error) {
            console.error("Context analysis failed (non-fatal):", error)
            // Continue without context analysis - it's supplementary data
          }

          const output = formatter.format(analysis)
          const outputPath = path.join(process.cwd(), "token-usage-output.txt")

          try {
            try {
              await fs.unlink(outputPath)
            } catch {}
            await fs.writeFile(outputPath, output, { encoding: "utf8", flag: "w" })
          } catch (error) {
            throw new Error(`Failed to write token analysis to ${outputPath}: ${error}`)
          }

          const timestamp = new Date().toISOString()
          const formattedTotal = new Intl.NumberFormat("en-US").format(analysis.totalTokens)

          let summaryMsg = `Token analysis complete! Full report saved to: ${outputPath}\n\nTimestamp: ${timestamp}\nMain session tokens: ${formattedTotal}`

          if (analysis.subagentAnalysis && analysis.subagentAnalysis.subagents.length > 0) {
            const subagentTokens = new Intl.NumberFormat("en-US").format(analysis.subagentAnalysis.totalTokens)
            const grandTotal = new Intl.NumberFormat("en-US").format(
              analysis.totalTokens + analysis.subagentAnalysis.totalTokens
            )
            summaryMsg += `\nSubagent sessions: ${analysis.subagentAnalysis.subagents.length} (${subagentTokens} tokens)`
            summaryMsg += `\nGrand total: ${grandTotal} tokens`
          }

          summaryMsg += `\n\nUse: cat token-usage-output.txt (or read the file) to view the complete analysis.`

          return summaryMsg
        },
      }),
    },
  }
}
