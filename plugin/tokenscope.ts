// OpenCode Token Analyzer Plugin - Main Entry Point

import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import path from "path"
import fs from "fs/promises"

import type { SessionMessage } from "./tokenscope-lib/types"
import { DEFAULT_ENTRY_LIMIT, loadModelPricing, loadTokenscopeConfig } from "./tokenscope-lib/config"
import { TokenizerManager } from "./tokenscope-lib/tokenizer"
import { ModelResolver, ContentCollector, TokenAnalysisEngine } from "./tokenscope-lib/analyzer"
import { CostCalculator } from "./tokenscope-lib/cost"
import { SubagentAnalyzer } from "./tokenscope-lib/subagent"
import { OutputFormatter } from "./tokenscope-lib/formatter"
import { ContextAnalyzer } from "./tokenscope-lib/context"
import { SkillAnalyzer } from "./tokenscope-lib/skill"

export const TokenAnalyzerPlugin: Plugin = async ({ client }) => {
  const pricingData = await loadModelPricing()
  const config = await loadTokenscopeConfig()

  const tokenizerManager = new TokenizerManager()
  const modelResolver = new ModelResolver()
  const contentCollector = new ContentCollector()
  const analysisEngine = new TokenAnalysisEngine(tokenizerManager, contentCollector)
  const costCalculator = new CostCalculator(pricingData)
  const subagentAnalyzer = new SubagentAnalyzer(client, costCalculator)
  const contextAnalyzer = new ContextAnalyzer(tokenizerManager)
  const skillAnalyzer = new SkillAnalyzer(client, tokenizerManager)
  const formatter = new OutputFormatter(costCalculator)

  // Set config on formatter to control section rendering
  formatter.setConfig(config)

  return {
    tool: {
      tokenscope: tool({
        description:
          "Analyze token usage across the current session with detailed breakdowns by category (system, user, assistant, tools, reasoning). " +
          "Provides visual charts, identifies top token consumers, and includes costs from subagent (Task tool) child sessions.",
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

          const { model: tokenModel, providerID, modelID } = modelResolver.resolveModelAndProvider(messages)
          const analysis = await analysisEngine.analyze(
            sessionID,
            messages,
            tokenModel,
            args.limitMessages ?? DEFAULT_ENTRY_LIMIT
          )

          // Subagent analysis (respects config)
          const shouldIncludeSubagents = args.includeSubagents !== false && config.enableSubagentAnalysis
          if (shouldIncludeSubagents) {
            analysis.subagentAnalysis = await subagentAnalyzer.analyzeChildSessions(sessionID)
          }

          // Context analysis (context breakdown, tool estimates, cache efficiency)
          const pricing = costCalculator.getPricing(tokenModel.name)
          const contextResult = await contextAnalyzer.analyze(sessionID, tokenModel, pricing, config)

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
            analysis.skillAnalysis = await skillAnalyzer.analyze(
              messages,
              providerID,
              modelID,
              tokenModel,
              config
            )
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

// Default export for convenience
export default TokenAnalyzerPlugin
