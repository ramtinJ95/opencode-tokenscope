// Builds the structured report that UI parts render natively (see rpc.ts). The text report in
// formatter.ts presents the same analysis; both read the numbers computed by the analyzers. The
// text report prints the local estimates as they are, while this view scales them to recorded usage.

import type { ContextBreakdown, CostEstimate, TokenAnalysis, TokenscopeConfig } from "./types.js"
import type { ReportRow, ReportView } from "./rpc.js"
import { calculateModelAwareCacheEfficiency, collectToolUsage, collectTopEntries } from "./formatter-helpers.js"

const TOP_CONTRIBUTOR_COUNT = 5
const MAX_DETAIL_LINES = 4

// The provider reports one token count per request, not what it was made of, so the split by
// source can only come from local tokenization. That tokenizer is not the provider's: its counts
// drift with the model's vocabulary and with how tool definitions and message framing are
// serialized. The split is therefore scaled so it adds up to the context OpenCode recorded.
//
// Outside this range the local inventory is missing content it cannot see (attachments, for
// example). Scaling would spread that over unrelated rows, so the split stays unscaled and says so.
const MIN_SCALE = 0.5
const MAX_SCALE = 2

// Splits `total` across `weights` in proportion, as whole numbers that add up to `total` exactly.
export function apportion(weights: number[], total: number): number[] {
  const sum = weights.reduce((acc, weight) => acc + weight, 0)
  if (sum <= 0) return weights.map(() => 0)

  const exact = weights.map((weight) => (weight / sum) * total)
  const shares = exact.map(Math.floor)
  const remainder = total - shares.reduce((acc, share) => acc + share, 0)
  // Largest remainders first; ties keep the original order.
  const order = exact.map((value, index) => ({ index, fraction: value - Math.floor(value) }))
  order.sort((a, b) => b.fraction - a.fraction || a.index - b.index)
  for (const { index } of order.slice(0, remainder)) shares[index] += 1

  return shares
}

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

type Categories = TokenAnalysis["categories"]
const CATEGORY_KEYS = ["system", "user", "tools", "assistant", "reasoning"] as const

// Scales the tool definitions and every content entry in one pass, so each list derived from them
// (the rows by source, the per-tool output, the top contributors) shows the same number for the
// same thing and the whole adds up to `total`.
function scaleContent(categories: Categories, toolDefinitions: number, total: number) {
  const shares = apportion(
    [toolDefinitions, ...CATEGORY_KEYS.flatMap((key) => categories[key].allEntries.map((entry) => entry.tokens))],
    total
  )

  let next = 1
  const scaled = { ...categories }
  for (const key of CATEGORY_KEYS) {
    const allEntries = categories[key].allEntries.map((entry) => ({ ...entry, tokens: shares[next++] }))
    scaled[key] = {
      ...categories[key],
      allEntries,
      entries: allEntries.slice(0, categories[key].entries.length),
      totalTokens: allEntries.reduce((sum, entry) => sum + entry.tokens, 0),
    }
  }

  return { categories: scaled, toolDefinitions: shares[0] }
}

// Scales the always-sent context so it adds up to `total` with its tool definitions at `toolDefinitions`.
function scaleBreakdown(breakdown: ContextBreakdown, toolDefinitions: number, total: number): ContextBreakdown {
  const [base, environment, instructions, guidance] = apportion(
    [
      breakdown.baseSystemPrompt.tokens,
      breakdown.environmentContext.tokens,
      breakdown.customInstructions.tokens,
      breakdown.guidance.tokens,
    ],
    total - toolDefinitions
  )

  return {
    ...breakdown,
    baseSystemPrompt: { ...breakdown.baseSystemPrompt, tokens: base },
    toolDefinitions: { ...breakdown.toolDefinitions, tokens: toolDefinitions },
    environmentContext: { ...breakdown.environmentContext, tokens: environment },
    customInstructions: { ...breakdown.customInstructions, tokens: instructions },
    guidance: { ...breakdown.guidance, tokens: guidance },
    totalCachedContext: total,
  }
}

export function buildReportView(analysis: TokenAnalysis, cost: CostEstimate, config: TokenscopeConfig): ReportView {
  const recordedTokens =
    analysis.inputTokens +
    analysis.cacheReadTokens +
    analysis.cacheWriteTokens +
    analysis.outputTokens +
    analysis.reasoningTokens
  const mainCost = cost.usesEstimatedCost ? cost.estimatedSessionCost : cost.apiSessionCost

  const breakdown = config.enableContextBreakdown ? analysis.contextBreakdown : undefined
  // Tool definitions are part of every request but not of the transcript, so they are only known
  // when the request itself was captured. Without them the split is incomplete and is not scaled.
  const measured = breakdown?.toolDefinitions.identified === true
  const toolDefinitions = measured ? breakdown.toolDefinitions.tokens : 0
  const estimated =
    toolDefinitions + CATEGORY_KEYS.reduce((sum, key) => sum + analysis.categories[key].totalTokens, 0)
  // The context after the last completed request: what it was sent plus what it produced.
  const recordedContext =
    analysis.mostRecentInput +
    analysis.mostRecentCacheRead +
    analysis.mostRecentCacheWrite +
    analysis.mostRecentOutput +
    analysis.mostRecentReasoning

  const warnings = [...analysis.warnings]
  let scale: number | undefined
  if (measured && estimated > 0 && recordedContext > 0) {
    const factor = recordedContext / estimated
    if (factor >= MIN_SCALE && factor <= MAX_SCALE) {
      scale = factor
    } else {
      warnings.push(
        `The local content estimate (${estimated} tokens) is too far from the context OpenCode recorded for the ` +
          `last request (${recordedContext} tokens) to be scaled to it. The context window split is an unscaled ` +
          "local estimate."
      )
    }
  }

  const content =
    scale === undefined
      ? { categories: analysis.categories, toolDefinitions }
      : scaleContent(analysis.categories, toolDefinitions, recordedContext)
  const shown: TokenAnalysis = { ...analysis, categories: content.categories }

  const view: ReportView = {
    sessionID: analysis.sessionID,
    generatedAt: Date.now(),
    model: analysis.model.name,
    tokenizer: analysis.model.spec.kind,
    warnings,
    content: {
      rows: nonEmpty([
        { label: "System prompt", tokens: content.categories.system.totalTokens },
        { label: "Tool definitions", tokens: content.toolDefinitions },
        { label: "User", tokens: content.categories.user.totalTokens },
        { label: "Tool output", tokens: content.categories.tools.totalTokens },
        { label: "Assistant", tokens: content.categories.assistant.totalTokens },
        { label: "Reasoning", tokens: content.categories.reasoning.totalTokens },
      ]),
      total: scale === undefined ? estimated : recordedContext,
      scale,
    },
    tools: collectToolUsage(shown).map((tool) => ({ name: tool.label, tokens: tool.tokens, calls: tool.calls })),
    topContributors: collectTopEntries(shown, TOP_CONTRIBUTOR_COUNT).map((entry) => ({
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

  if (breakdown && breakdown.totalCachedContext > 0) {
    // The always-sent context is the system prompt plus the tool definitions. Mid-session system
    // updates are part of the system prompt row but not of this breakdown.
    const sameAsRows = breakdown.totalCachedContext === analysis.categories.system.totalTokens + toolDefinitions
    const shownBreakdown =
      scale === undefined
        ? breakdown
        : scaleBreakdown(
            breakdown,
            content.toolDefinitions,
            sameAsRows
              ? content.categories.system.totalTokens + content.toolDefinitions
              : Math.max(content.toolDefinitions, Math.round(breakdown.totalCachedContext * scale))
          )
    view.context = {
      measured: breakdown.baseSystemPrompt.identified,
      total: shownBreakdown.totalCachedContext,
      components: contextRows(shownBreakdown),
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
