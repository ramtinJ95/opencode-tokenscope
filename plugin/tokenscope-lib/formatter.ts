// OutputFormatter - generates visual reports from token analysis

import type {
  TokenAnalysis,
  CategoryEntry,
  CostEstimate,
  SubagentAnalysis,
  ContextBreakdown,
  ToolSchemaEstimate,
  CacheEfficiency,
  TokenscopeConfig,
  SkillAnalysis,
} from "./types.js"
import { CostCalculator } from "./cost.js"
import { formatCostEstimateLines, formatDetailedSubagentBreakdownLines } from "./formatter-cost-sections.js"
import {
  collectTopEntries,
  formatCategoryBar,
  formatNumber,
  TOOL_LABEL_WIDTH,
  TOP_CONTRIBUTOR_LABEL_WIDTH,
} from "./formatter-helpers.js"
import {
  formatAvailableSkills,
  formatAvailableSubagents,
  formatCacheEfficiency,
  formatContextBreakdown,
  formatLoadedSkills,
  formatToolEstimates,
} from "./formatter-insight-sections.js"

export class OutputFormatter {
  private config: TokenscopeConfig | null = null

  constructor(private costCalculator: CostCalculator) {}

  setConfig(config: TokenscopeConfig): void {
    this.config = config
  }

  format(analysis: TokenAnalysis): string {
    const inputCategories = [
      { label: "SYSTEM", tokens: analysis.categories.system.totalTokens },
      { label: "USER", tokens: analysis.categories.user.totalTokens },
      { label: "TOOLS", tokens: analysis.categories.tools.totalTokens },
    ]
    const outputCategories = [
      { label: "ASSISTANT", tokens: analysis.categories.assistant.totalTokens },
      { label: "REASONING", tokens: analysis.categories.reasoning.totalTokens },
    ]
    const topEntries = collectTopEntries(analysis, 5)
    const hasInferredSystemEstimate = analysis.categories.system.entries.some((entry) =>
      entry.label.toLowerCase().includes("inferred")
    )

    const toolStats = new Map<string, { tokens: number; calls: number }>()
    for (const [toolName, calls] of analysis.toolCallCounts.entries()) {
      toolStats.set(toolName, { tokens: 0, calls })
    }
    for (const entry of analysis.categories.tools.allEntries) {
      const existing = toolStats.get(entry.label) || { tokens: 0, calls: 0 }
      toolStats.set(entry.label, { ...existing, tokens: entry.tokens })
    }
    const toolEntries = Array.from(toolStats.entries())
      .map(([label, stats]) => ({ label, tokens: stats.tokens, calls: stats.calls }))
      .sort((a, b) => b.tokens - a.tokens)

    const costEstimate = this.costCalculator.calculateCost(analysis)

    return this.formatVisualOutput(
      analysis.sessionID,
      analysis.model.name,
      analysis.warnings,
      analysis.totalTokens,
      analysis.inputTokens,
      analysis.outputTokens,
      analysis.reasoningTokens,
      analysis.cacheReadTokens,
      analysis.cacheWriteTokens,
      analysis.assistantMessageCount,
      analysis.apiCallCount,
      analysis.callsWithCacheRead,
      analysis.callsWithCacheWrite,
      analysis.mostRecentInput,
      analysis.mostRecentOutput,
      analysis.mostRecentReasoning,
      analysis.mostRecentCacheRead,
      analysis.mostRecentCacheWrite,
      analysis.mostRecentProviderTotalTokens,
      inputCategories,
      outputCategories,
      topEntries,
      toolEntries,
      hasInferredSystemEstimate,
      costEstimate,
      analysis.subagentAnalysis,
      analysis.contextBreakdown,
      analysis.toolEstimates,
      analysis.cacheEfficiency,
      analysis.skillAnalysis
    )
  }

  private formatVisualOutput(
    sessionID: string,
    modelName: string,
    warnings: string[],
    totalTokens: number,
    inputTokens: number,
    outputTokens: number,
    reasoningTokens: number,
    cacheReadTokens: number,
    cacheWriteTokens: number,
    assistantMessageCount: number,
    apiCallCount: number,
    callsWithCacheRead: number,
    callsWithCacheWrite: number,
    mostRecentInput: number,
    mostRecentOutput: number,
    mostRecentReasoning: number,
    mostRecentCacheRead: number,
    mostRecentCacheWrite: number,
    mostRecentProviderTotalTokens: number | undefined,
    inputCategories: Array<{ label: string; tokens: number }>,
    outputCategories: Array<{ label: string; tokens: number }>,
    topEntries: CategoryEntry[],
    toolEntries: Array<{ label: string; tokens: number; calls: number }>,
    hasInferredSystemEstimate: boolean,
    cost: CostEstimate,
    subagentAnalysis?: SubagentAnalysis,
    contextBreakdown?: ContextBreakdown,
    toolEstimates?: ToolSchemaEstimate[],
    cacheEfficiency?: CacheEfficiency,
    skillAnalysis?: SkillAnalysis
  ): string {
    const lines: string[] = []
    const sessionTotal = inputTokens + cacheReadTokens + cacheWriteTokens + outputTokens + reasoningTokens
    const mainCost = cost.isSubscription ? cost.estimatedSessionCost : cost.apiSessionCost
    const subagentDisplayCost = (apiCost: number, estimatedCost: number) => (apiCost > 0 ? apiCost : estimatedCost)
    const subagentTotalDisplayCost =
      subagentAnalysis?.subagents.reduce(
        (sum, subagent) => sum + subagentDisplayCost(subagent.apiCost, subagent.estimatedCost),
        0
      ) ?? 0
    const hasActualSubagentCost = subagentAnalysis?.subagents.some((subagent) => subagent.apiCost > 0) ?? false
    const hasEstimatedSubagentCost = subagentAnalysis?.subagents.some((subagent) => subagent.apiCost <= 0) ?? false
    const subagentCostBasis = hasActualSubagentCost
      ? hasEstimatedSubagentCost
        ? "displayed subagent costs use actual child API cost when available, otherwise estimated API-rate cost"
        : "displayed subagent costs use actual child API cost"
      : "displayed subagent costs use estimated API-rate cost"

    // Header
    lines.push(`\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550`)
    lines.push(`Token Analysis: Session ${sessionID}`)
    lines.push(`Model: ${modelName}`)
    lines.push(`\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550`)
    lines.push(``)

    if (warnings.length > 0) {
      lines.push(`WARNINGS`)
      lines.push(`\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`)
      for (const warning of warnings) {
        lines.push(`- ${warning}`)
      }
      lines.push(``)
    }

    // 1. TOKEN BREAKDOWN BY CATEGORY
    lines.push(`TOKEN BREAKDOWN BY CATEGORY`)
    lines.push(`\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`)
    lines.push(`Estimated using tokenizer analysis of message content:`)
    lines.push(``)

    const inputTotal = inputCategories.reduce((sum, cat) => sum + cat.tokens, 0)
    lines.push(`Input Categories:`)
    for (const category of inputCategories) {
      const barLine = formatCategoryBar(category.label, category.tokens, inputTotal)
      if (barLine) lines.push(`  ${barLine}`)
    }
    lines.push(``)
    lines.push(`  Subtotal: ${formatNumber(inputTotal)} estimated input tokens`)
    if (hasInferredSystemEstimate) {
      lines.push(`  Note: inferred system/overhead values are heuristic estimates from API telemetry.`)
    }
    lines.push(``)

    const outputTotal = outputCategories.reduce((sum, cat) => sum + cat.tokens, 0)
    lines.push(`Output Categories:`)
    for (const category of outputCategories) {
      const barLine = formatCategoryBar(category.label, category.tokens, outputTotal)
      if (barLine) lines.push(`  ${barLine}`)
    }
    lines.push(``)
    lines.push(`  Subtotal: ${formatNumber(outputTotal)} estimated output tokens`)
    lines.push(``)
    lines.push(`Local Total: ${formatNumber(totalTokens)} tokens (estimated)`)

    // 2. TOOL USAGE BREAKDOWN (right after token breakdown)
    if (toolEntries.length > 0) {
      const toolsTotalTokens = inputCategories.find((c) => c.label === "TOOLS")?.tokens || 0
      lines.push(``)
      lines.push(`TOOL USAGE BREAKDOWN`)
      lines.push(`\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`)
      for (const tool of toolEntries) {
        const barLine = formatCategoryBar(tool.label, tool.tokens, toolsTotalTokens, TOOL_LABEL_WIDTH)
        if (barLine) {
          const calls = `${tool.calls}x`.padStart(5)
          lines.push(`${barLine} ${calls}`)
        }
      }
    }

    // 3. TOP CONTRIBUTORS
    if (topEntries.length > 0) {
      lines.push(``)
      lines.push(`TOP CONTRIBUTORS`)
      lines.push(`\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`)
      for (const entry of topEntries) {
        const percentage = ((entry.tokens / totalTokens) * 100).toFixed(1)
        const label = `\u2022 ${entry.label}`.padEnd(TOP_CONTRIBUTOR_LABEL_WIDTH)
        const formattedTokens = formatNumber(entry.tokens)
        lines.push(`${label} ${formattedTokens} tokens (${percentage}%)`)
      }
    }

    // 4. MOST RECENT API CALL
    lines.push(``)
    lines.push(`\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550`)
    lines.push(`MOST RECENT API CALL`)
    lines.push(`\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`)
    lines.push(``)
    lines.push(`Raw telemetry from last API response:`)
    lines.push(`  Input (fresh):     ${formatNumber(mostRecentInput).padStart(10)} tokens`)
    lines.push(`  Cache read:        ${formatNumber(mostRecentCacheRead).padStart(10)} tokens`)
    if (mostRecentCacheWrite > 0) {
      lines.push(`  Cache write:       ${formatNumber(mostRecentCacheWrite).padStart(10)} tokens`)
    }
    lines.push(`  Output:            ${formatNumber(mostRecentOutput).padStart(10)} tokens`)
    if (mostRecentReasoning > 0) {
      lines.push(`  Reasoning:         ${formatNumber(mostRecentReasoning).padStart(10)} tokens`)
    }
    if (mostRecentProviderTotalTokens !== undefined) {
      lines.push(`  Provider total:    ${formatNumber(mostRecentProviderTotalTokens).padStart(10)} tokens`)
    }
    if (cost.apiMostRecentCost > 0) {
      lines.push(`  Cost:              $${cost.apiMostRecentCost.toFixed(4)}`)
    }
    lines.push(`  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`)
    lines.push(
      `  Total:             ${formatNumber(mostRecentInput + mostRecentCacheRead + mostRecentCacheWrite + mostRecentOutput + mostRecentReasoning).padStart(10)} tokens`
    )

    // 5. SESSION TOTALS
    lines.push(``)
    lines.push(`\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550`)
    lines.push(`SESSION TOTALS (All ${apiCallCount} API calls)`)
    lines.push(`\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`)
    lines.push(``)
    if (assistantMessageCount !== apiCallCount) {
      lines.push(`Assistant messages observed: ${assistantMessageCount} (structural count)`)
      lines.push(``)
    }

    lines.push(`Total tokens processed across the entire session (for cost calculation):`)
    lines.push(``)
    lines.push(`  Input tokens:      ${formatNumber(inputTokens).padStart(10)} (fresh tokens across all calls)`)
    lines.push(`  Cache read:        ${formatNumber(cacheReadTokens).padStart(10)} (cached tokens across all calls)`)
    lines.push(`  Cache write:       ${formatNumber(cacheWriteTokens).padStart(10)} (tokens written to cache)`)
    lines.push(`  Output tokens:     ${formatNumber(outputTokens).padStart(10)} (all model responses)`)
    if (reasoningTokens > 0) {
      lines.push(`  Reasoning tokens:  ${formatNumber(reasoningTokens).padStart(10)} (thinking/reasoning)`)
    }
    lines.push(`  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`)
    lines.push(`  Session Total:     ${formatNumber(sessionTotal).padStart(10)} tokens (for billing)`)
    if (apiCallCount > 0) {
      lines.push(`  Cache read calls:  ${callsWithCacheRead.toString().padStart(10)} / ${apiCallCount}`)
      lines.push(`  Cache write calls: ${callsWithCacheWrite.toString().padStart(10)} / ${apiCallCount}`)
    }

    // 6. SESSION COST / ESTIMATED SESSION COST
    lines.push(``)
    lines.push(`\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550`)
    if (cost.isSubscription) {
      lines.push(`ESTIMATED SESSION COST (API Key Pricing)`)
      lines.push(`\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`)
      lines.push(``)
      lines.push(`You appear to be on a subscription plan, so the public token cost estimate is shown below.`)
      lines.push(`Here's what this session would cost with direct API access:`)
      lines.push(``)
      lines.push(...formatCostEstimateLines(cost))
      lines.push(`\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`)
      lines.push(`ESTIMATED TOTAL: $${cost.estimatedSessionCost.toFixed(4)}`)
      lines.push(``)
      lines.push(`Note: This estimate uses live OpenCode model metadata when available, then bundled models.json pricing.`)
      lines.push(`Actual API costs may vary based on provider and context size.`)
    } else {
      lines.push(`SESSION COST`)
      lines.push(`\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`)
      lines.push(``)
      lines.push(`Token usage breakdown:`)
      lines.push(`  Input tokens:      ${formatNumber(inputTokens).padStart(10)}`)
      lines.push(`  Output tokens:     ${formatNumber(outputTokens).padStart(10)}`)
      if (reasoningTokens > 0) {
        lines.push(`  Reasoning tokens:  ${formatNumber(reasoningTokens).padStart(10)}`)
      }
      if (cacheReadTokens > 0) {
        lines.push(`  Cache read:        ${formatNumber(cacheReadTokens).padStart(10)}`)
      }
      if (cacheWriteTokens > 0) {
        lines.push(`  Cache write:       ${formatNumber(cacheWriteTokens).padStart(10)}`)
      }
      if (cost.perModelCosts.length > 1) {
        lines.push(``)
        lines.push(`Per-model estimated API pricing:`)
        lines.push(...formatCostEstimateLines(cost))
      }
      lines.push(``)
      lines.push(`\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`)
      lines.push(`ACTUAL COST (from API):  $${cost.apiSessionCost.toFixed(4)}`)
      const diff = Math.abs(cost.apiSessionCost - cost.estimatedSessionCost)
      const diffPercent = cost.apiSessionCost > 0 ? (diff / cost.apiSessionCost) * 100 : 0
      if (diffPercent > 5) {
        lines.push(
          `Estimated cost:          $${cost.estimatedSessionCost.toFixed(4)} (${diffPercent > 0 ? (cost.estimatedSessionCost > cost.apiSessionCost ? "+" : "-") : ""}${diffPercent.toFixed(1)}% diff)`
        )
      }
      lines.push(``)
      lines.push(`Note: Actual cost is OpenCode-recorded provider cost. Estimates use live OpenCode model metadata when available, then bundled models.json pricing.`)
    }

    // 7. CONTEXT BREAKDOWN (if enabled and available)
    if (this.config?.enableContextBreakdown && contextBreakdown && contextBreakdown.totalCachedContext > 0) {
      lines.push(...formatContextBreakdown(contextBreakdown))
    }

    // 7.5 SKILLS ANALYSIS (if enabled and available)
    if (this.config?.enableSkillAnalysis && skillAnalysis) {
      if (skillAnalysis.availableSkills.length > 0) {
        lines.push(...formatAvailableSkills(skillAnalysis))
      }
      if (skillAnalysis.availableSubagents.length > 0) {
        lines.push(...formatAvailableSubagents(skillAnalysis))
      }
      if (skillAnalysis.loadedSkills.length > 0) {
        lines.push(...formatLoadedSkills(skillAnalysis))
      }
    }

    // 8. TOOL DEFINITION COSTS (if enabled and available)
    if (this.config?.enableToolSchemaEstimation && toolEstimates && toolEstimates.length > 0) {
      lines.push(...formatToolEstimates(toolEstimates))
    }

    // 9. CACHE EFFICIENCY (if enabled and available)
    if (this.config?.enableCacheEfficiency && cacheEfficiency && cacheEfficiency.totalInputTokens > 0) {
      lines.push(...formatCacheEfficiency(cacheEfficiency, cost, modelName))
    }

    // 10. SUBAGENT COSTS (if any)
    if (subagentAnalysis && subagentAnalysis.subagents.length > 0) {
      const subagentLabelWidth = 25

      lines.push(``)
      lines.push(`\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550`)
      lines.push(
        `SUBAGENT COSTS (${subagentAnalysis.subagents.length} child sessions, ${subagentAnalysis.totalApiCalls} API calls)`
      )
      lines.push(`\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`)
      lines.push(``)
      if (this.config?.enableDetailedSubagentCostBreakdown) {
        lines.push(`Detailed lines show token buckets plus estimated API-rate splits; ${subagentCostBasis}.`)
        lines.push(``)
      }
      for (const subagent of subagentAnalysis.subagents) {
        const label = `${subagent.agentType}`.padEnd(subagentLabelWidth)
        const costStr = `$${subagentDisplayCost(subagent.apiCost, subagent.estimatedCost).toFixed(4)}`
        const tokensStr = `(${formatNumber(subagent.totalTokens)} tokens, ${subagent.apiCallCount} calls)`
        lines.push(`  ${label} ${costStr.padStart(10)}  ${tokensStr}`)
        if (this.config?.enableDetailedSubagentCostBreakdown) {
          lines.push(
            ...formatDetailedSubagentBreakdownLines({
              freshInputTokens: subagent.inputTokens,
              cacheReadTokens: subagent.cacheReadTokens,
              cacheWriteTokens: subagent.cacheWriteTokens,
              outputTokens: subagent.outputTokens,
              reasoningTokens: subagent.reasoningTokens,
              actualCost: subagent.apiCost > 0 ? subagent.apiCost : undefined,
              estimatedTotalCost: subagent.estimatedCost,
              estimatedInputCost: subagent.estimatedInputCost,
              estimatedCacheReadCost: subagent.estimatedCacheReadCost,
              estimatedCacheWriteCost: subagent.estimatedCacheWriteCost,
              estimatedOutputCost: subagent.estimatedOutputCost,
            })
          )
        }
      }
      lines.push(`\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`)
      lines.push(
        `Subagent Total:${" ".repeat(subagentLabelWidth - 14)} $${subagentTotalDisplayCost.toFixed(4)}  (${formatNumber(subagentAnalysis.totalTokens)} tokens, ${subagentAnalysis.totalApiCalls} calls)`
      )
      if (this.config?.enableDetailedSubagentCostBreakdown) {
        lines.push(
          ...formatDetailedSubagentBreakdownLines(
            {
              freshInputTokens: subagentAnalysis.totalInputTokens,
              cacheReadTokens: subagentAnalysis.totalCacheReadTokens,
              cacheWriteTokens: subagentAnalysis.totalCacheWriteTokens,
              outputTokens: subagentAnalysis.totalOutputTokens,
              reasoningTokens: subagentAnalysis.totalReasoningTokens,
              actualCost: subagentAnalysis.totalApiCost > 0 ? subagentAnalysis.totalApiCost : undefined,
              estimatedTotalCost: subagentAnalysis.totalEstimatedCost,
              estimatedInputCost: subagentAnalysis.estimatedInputCost,
              estimatedCacheReadCost: subagentAnalysis.estimatedCacheReadCost,
              estimatedCacheWriteCost: subagentAnalysis.estimatedCacheWriteCost,
              estimatedOutputCost: subagentAnalysis.estimatedOutputCost,
            },
            "  "
          )
        )
      }
    }

    // 11. SUMMARY (always last)
    lines.push(``)
    lines.push(`\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550`)
    lines.push(`SUMMARY`)
    lines.push(`\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`)
    lines.push(``)
    lines.push(`                          Cost        Tokens          API Calls`)

    if (subagentAnalysis && subagentAnalysis.subagents.length > 0) {
      const grandTotalCost = mainCost + subagentTotalDisplayCost
      const grandTotalTokens = sessionTotal + subagentAnalysis.totalTokens
      const grandTotalApiCalls = apiCallCount + subagentAnalysis.totalApiCalls

      lines.push(
        `  Main session:      $${mainCost.toFixed(4).padStart(10)}    ${formatNumber(sessionTotal).padStart(10)}         ${apiCallCount.toString().padStart(5)}`
      )
      lines.push(
        `  Subagents:         $${subagentTotalDisplayCost.toFixed(4).padStart(10)}    ${formatNumber(subagentAnalysis.totalTokens).padStart(10)}         ${subagentAnalysis.totalApiCalls.toString().padStart(5)}`
      )
      lines.push(`\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`)
      lines.push(
        `  TOTAL:             $${grandTotalCost.toFixed(4).padStart(10)}    ${formatNumber(grandTotalTokens).padStart(10)}         ${grandTotalApiCalls.toString().padStart(5)}`
      )
    } else {
      lines.push(
        `  Session:           $${mainCost.toFixed(4).padStart(10)}    ${formatNumber(sessionTotal).padStart(10)}         ${apiCallCount.toString().padStart(5)}`
      )
    }

    lines.push(``)
    lines.push(`\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550`)

    return lines.join("\n")
  }


}
