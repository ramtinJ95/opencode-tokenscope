// Builds the structured report that UI parts render natively (see rpc.ts). The text report in
// formatter.ts presents the same analysis; both read the numbers computed by the analyzers.

import type { ContextBreakdown, CostEstimate, TokenAnalysis, TokenscopeConfig } from "./types.js"
import type { ReportRow, ReportView } from "./rpc.js"
import { calculateModelAwareCacheEfficiency, collectToolUsage, collectTopEntries } from "./formatter-helpers.js"

const TOP_CONTRIBUTOR_COUNT = 5
const MAX_DETAIL_LINES = 4

function nonEmpty(rows: ReportRow[]): ReportRow[] {
  return rows.filter((row) => row.tokens > 0)
}

function contextRows(breakdown: ContextBreakdown): ReportRow[] {
  const detail = (sources: string[]) => (sources.length > 0 ? sources.slice(0, MAX_DETAIL_LINES) : undefined)
  const toolCount = breakdown.toolDefinitions.toolCount

  return nonEmpty([
    {
      label: breakdown.baseSystemPrompt.identified ? "Base system prompt" : "Other cached prompt",
      tokens: breakdown.baseSystemPrompt.tokens,
    },
    {
      label: toolCount > 0 ? `Tool definitions (${toolCount})` : "Tool definitions",
      tokens: breakdown.toolDefinitions.tokens,
    },
    { label: "Environment", tokens: breakdown.environmentContext.tokens },
    {
      label: "Custom instructions",
      tokens: breakdown.customInstructions.tokens,
      detail: detail(breakdown.customInstructions.sources),
    },
    { label: "Catalogs & guidance", tokens: breakdown.guidance.tokens, detail: detail(breakdown.guidance.sources) },
  ])
}

export function buildReportView(analysis: TokenAnalysis, cost: CostEstimate, config: TokenscopeConfig): ReportView {
  const recordedTokens =
    analysis.inputTokens +
    analysis.cacheReadTokens +
    analysis.cacheWriteTokens +
    analysis.outputTokens +
    analysis.reasoningTokens
  const mainCost = cost.usesEstimatedCost ? cost.estimatedSessionCost : cost.apiSessionCost

  const view: ReportView = {
    sessionID: analysis.sessionID,
    generatedAt: Date.now(),
    model: analysis.model.name,
    tokenizer: analysis.model.spec.kind,
    warnings: analysis.warnings,
    content: {
      input: nonEmpty([
        { label: "System", tokens: analysis.categories.system.totalTokens },
        { label: "User", tokens: analysis.categories.user.totalTokens },
        { label: "Tools", tokens: analysis.categories.tools.totalTokens },
      ]),
      output: nonEmpty([
        { label: "Assistant", tokens: analysis.categories.assistant.totalTokens },
        { label: "Reasoning", tokens: analysis.categories.reasoning.totalTokens },
      ]),
      total: analysis.totalTokens,
    },
    tools: collectToolUsage(analysis).map((tool) => ({ name: tool.label, tokens: tool.tokens, calls: tool.calls })),
    topContributors: collectTopEntries(analysis, TOP_CONTRIBUTOR_COUNT).map((entry) => ({
      label: entry.label,
      tokens: entry.tokens,
    })),
    steps: analysis.apiCallCount,
    lastStep: {
      input: analysis.mostRecentInput,
      cacheRead: analysis.mostRecentCacheRead,
      cacheWrite: analysis.mostRecentCacheWrite,
      output: analysis.mostRecentOutput,
      reasoning: analysis.mostRecentReasoning,
      cost: cost.apiMostRecentCost,
    },
    recorded: {
      input: analysis.inputTokens,
      cacheRead: analysis.cacheReadTokens,
      cacheWrite: analysis.cacheWriteTokens,
      output: analysis.outputTokens,
      reasoning: analysis.reasoningTokens,
      cost: cost.apiSessionCost,
    },
    costBasis: cost.usesEstimatedCost ? "estimated" : "recorded",
    cost: mainCost,
    total: { cost: mainCost, tokens: recordedTokens, steps: analysis.apiCallCount },
  }

  const breakdown = analysis.contextBreakdown
  if (config.enableContextBreakdown && breakdown && breakdown.totalCachedContext > 0) {
    view.context = {
      measured: breakdown.baseSystemPrompt.identified,
      total: breakdown.totalCachedContext,
      components: contextRows(breakdown),
    }
  }

  if (config.enableCacheEfficiency && analysis.cacheEfficiency && analysis.cacheEfficiency.totalInputTokens > 0) {
    const efficiency = calculateModelAwareCacheEfficiency(analysis.cacheEfficiency, cost)
    view.cache = {
      hitRate: efficiency.cacheHitRate,
      savings: efficiency.costSavings,
      savingsPercent: efficiency.savingsPercent,
    }
  }

  const subagents = analysis.subagentAnalysis
  if (subagents && subagents.subagents.length > 0) {
    // OpenCode's recorded child cost where it is nonzero, otherwise the API-rate estimate.
    const sessions = subagents.subagents.map((subagent) => ({
      title: subagent.title,
      agent: subagent.agentType,
      tokens: subagent.totalTokens,
      cost: subagent.apiCost > 0 ? subagent.apiCost : subagent.estimatedCost,
      steps: subagent.apiCallCount,
    }))
    const subagentCost = sessions.reduce((sum, session) => sum + session.cost, 0)

    view.subagents = { steps: subagents.totalApiCalls, tokens: subagents.totalTokens, cost: subagentCost, sessions }
    view.total = {
      cost: mainCost + subagentCost,
      tokens: recordedTokens + subagents.totalTokens,
      steps: analysis.apiCallCount + subagents.totalApiCalls,
    }
  }

  return view
}
