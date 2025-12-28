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
} from "./types"
import { CostCalculator } from "./cost"

export class OutputFormatter {
  private readonly BAR_WIDTH = 30
  private readonly TOKEN_SPACING = 11
  private readonly CATEGORY_LABEL_WIDTH = 9
  private readonly TOOL_LABEL_WIDTH = 20
  private readonly TOP_CONTRIBUTOR_LABEL_WIDTH = 30
  private readonly CONTEXT_LABEL_WIDTH = 22
  private readonly TOOL_ESTIMATE_LABEL_WIDTH = 18
  private readonly SKILL_NAME_WIDTH = 22
  private readonly SKILL_DESC_WIDTH = 45

  private config: TokenscopeConfig | null = null

  constructor(private costCalculator: CostCalculator) {}

  setConfig(config: TokenscopeConfig): void {
    this.config = config
  }

  private formatCategoryBar(
    label: string,
    tokens: number,
    total: number,
    labelWidth: number = this.CATEGORY_LABEL_WIDTH
  ): string {
    if (tokens === 0) return ""

    const percentage = total > 0 ? ((tokens / total) * 100).toFixed(1) : "0.0"
    const percentageNum = parseFloat(percentage)
    const barWidth = Math.round((percentageNum / 100) * this.BAR_WIDTH)
    const bar = "\u2588".repeat(barWidth) + "\u2591".repeat(Math.max(0, this.BAR_WIDTH - barWidth))
    const labelPadded = label.padEnd(labelWidth)
    const formattedTokens = this.formatNumber(tokens)

    let pct = percentage
    if (percentageNum < 10) {
      pct = " " + pct
    }

    const tokensPart = `(${formattedTokens})`
    const spacesNeeded = Math.max(1, this.TOKEN_SPACING - tokensPart.length)
    const spacing = " ".repeat(spacesNeeded)

    return `${labelPadded} ${bar} ${spacing}${pct}% ${tokensPart}`
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
    const topEntries = this.collectTopEntries(analysis, 5)

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
      analysis.totalTokens,
      analysis.inputTokens,
      analysis.outputTokens,
      analysis.reasoningTokens,
      analysis.cacheReadTokens,
      analysis.cacheWriteTokens,
      analysis.assistantMessageCount,
      analysis.mostRecentInput,
      analysis.mostRecentOutput,
      analysis.mostRecentReasoning,
      analysis.mostRecentCacheRead,
      analysis.mostRecentCacheWrite,
      inputCategories,
      outputCategories,
      topEntries,
      toolEntries,
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
    totalTokens: number,
    inputTokens: number,
    outputTokens: number,
    reasoningTokens: number,
    cacheReadTokens: number,
    cacheWriteTokens: number,
    assistantMessageCount: number,
    mostRecentInput: number,
    mostRecentOutput: number,
    mostRecentReasoning: number,
    mostRecentCacheRead: number,
    mostRecentCacheWrite: number,
    inputCategories: Array<{ label: string; tokens: number }>,
    outputCategories: Array<{ label: string; tokens: number }>,
    topEntries: CategoryEntry[],
    toolEntries: Array<{ label: string; tokens: number; calls: number }>,
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

    // Header
    lines.push(`\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550`)
    lines.push(`Token Analysis: Session ${sessionID}`)
    lines.push(`Model: ${modelName}`)
    lines.push(`\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550`)
    lines.push(``)

    // 1. TOKEN BREAKDOWN BY CATEGORY
    lines.push(`TOKEN BREAKDOWN BY CATEGORY`)
    lines.push(`\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`)
    lines.push(`Estimated using tokenizer analysis of message content:`)
    lines.push(``)

    const inputTotal = inputCategories.reduce((sum, cat) => sum + cat.tokens, 0)
    lines.push(`Input Categories:`)
    for (const category of inputCategories) {
      const barLine = this.formatCategoryBar(category.label, category.tokens, inputTotal)
      if (barLine) lines.push(`  ${barLine}`)
    }
    lines.push(``)
    lines.push(`  Subtotal: ${this.formatNumber(inputTotal)} estimated input tokens`)
    lines.push(``)

    const outputTotal = outputCategories.reduce((sum, cat) => sum + cat.tokens, 0)
    lines.push(`Output Categories:`)
    for (const category of outputCategories) {
      const barLine = this.formatCategoryBar(category.label, category.tokens, outputTotal)
      if (barLine) lines.push(`  ${barLine}`)
    }
    lines.push(``)
    lines.push(`  Subtotal: ${this.formatNumber(outputTotal)} estimated output tokens`)
    lines.push(``)
    lines.push(`Local Total: ${this.formatNumber(totalTokens)} tokens (estimated)`)

    // 2. TOOL USAGE BREAKDOWN (right after token breakdown)
    if (toolEntries.length > 0) {
      const toolsTotalTokens = inputCategories.find((c) => c.label === "TOOLS")?.tokens || 0
      lines.push(``)
      lines.push(`TOOL USAGE BREAKDOWN`)
      lines.push(`\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`)
      for (const tool of toolEntries) {
        const barLine = this.formatCategoryBar(tool.label, tool.tokens, toolsTotalTokens, this.TOOL_LABEL_WIDTH)
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
        const label = `\u2022 ${entry.label}`.padEnd(this.TOP_CONTRIBUTOR_LABEL_WIDTH)
        const formattedTokens = this.formatNumber(entry.tokens)
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
    lines.push(`  Input (fresh):     ${this.formatNumber(mostRecentInput).padStart(10)} tokens`)
    lines.push(`  Cache read:        ${this.formatNumber(mostRecentCacheRead).padStart(10)} tokens`)
    if (mostRecentCacheWrite > 0) {
      lines.push(`  Cache write:       ${this.formatNumber(mostRecentCacheWrite).padStart(10)} tokens`)
    }
    lines.push(`  Output:            ${this.formatNumber(mostRecentOutput).padStart(10)} tokens`)
    if (mostRecentReasoning > 0) {
      lines.push(`  Reasoning:         ${this.formatNumber(mostRecentReasoning).padStart(10)} tokens`)
    }
    lines.push(`  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`)
    lines.push(
      `  Total:             ${this.formatNumber(mostRecentInput + mostRecentCacheRead + mostRecentCacheWrite + mostRecentOutput + mostRecentReasoning).padStart(10)} tokens`
    )

    // 5. SESSION TOTALS
    lines.push(``)
    lines.push(`\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550`)
    lines.push(`SESSION TOTALS (All ${assistantMessageCount} API calls)`)
    lines.push(`\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`)
    lines.push(``)
    lines.push(`Total tokens processed across the entire session (for cost calculation):`)
    lines.push(``)
    lines.push(`  Input tokens:      ${this.formatNumber(inputTokens).padStart(10)} (fresh tokens across all calls)`)
    lines.push(`  Cache read:        ${this.formatNumber(cacheReadTokens).padStart(10)} (cached tokens across all calls)`)
    lines.push(`  Cache write:       ${this.formatNumber(cacheWriteTokens).padStart(10)} (tokens written to cache)`)
    lines.push(`  Output tokens:     ${this.formatNumber(outputTokens).padStart(10)} (all model responses)`)
    if (reasoningTokens > 0) {
      lines.push(`  Reasoning tokens:  ${this.formatNumber(reasoningTokens).padStart(10)} (thinking/reasoning)`)
    }
    lines.push(`  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`)
    lines.push(`  Session Total:     ${this.formatNumber(sessionTotal).padStart(10)} tokens (for billing)`)

    // 6. SESSION COST / ESTIMATED SESSION COST
    lines.push(``)
    lines.push(`\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550`)
    if (cost.isSubscription) {
      lines.push(`ESTIMATED SESSION COST (API Key Pricing)`)
      lines.push(`\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`)
      lines.push(``)
      lines.push(`You appear to be on a subscription plan (API cost is $0).`)
      lines.push(`Here's what this session would cost with direct API access:`)
      lines.push(``)
      lines.push(
        `  Input tokens:      ${this.formatNumber(inputTokens).padStart(10)} \u00d7 $${cost.pricePerMillionInput.toFixed(2)}/M  = $${cost.estimatedInputCost.toFixed(4)}`
      )
      lines.push(
        `  Output tokens:     ${this.formatNumber(outputTokens + reasoningTokens).padStart(10)} \u00d7 $${cost.pricePerMillionOutput.toFixed(2)}/M  = $${cost.estimatedOutputCost.toFixed(4)}`
      )
      if (cacheReadTokens > 0 && cost.pricePerMillionCacheRead > 0) {
        lines.push(
          `  Cache read:        ${this.formatNumber(cacheReadTokens).padStart(10)} \u00d7 $${cost.pricePerMillionCacheRead.toFixed(2)}/M  = $${cost.estimatedCacheReadCost.toFixed(4)}`
        )
      }
      if (cacheWriteTokens > 0 && cost.pricePerMillionCacheWrite > 0) {
        lines.push(
          `  Cache write:       ${this.formatNumber(cacheWriteTokens).padStart(10)} \u00d7 $${cost.pricePerMillionCacheWrite.toFixed(2)}/M  = $${cost.estimatedCacheWriteCost.toFixed(4)}`
        )
      }
      lines.push(`\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`)
      lines.push(`ESTIMATED TOTAL: $${cost.estimatedSessionCost.toFixed(4)}`)
      lines.push(``)
      lines.push(`Note: This estimate uses standard API pricing from models.json.`)
      lines.push(`Actual API costs may vary based on provider and context size.`)
    } else {
      lines.push(`SESSION COST`)
      lines.push(`\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`)
      lines.push(``)
      lines.push(`Token usage breakdown:`)
      lines.push(`  Input tokens:      ${this.formatNumber(inputTokens).padStart(10)}`)
      lines.push(`  Output tokens:     ${this.formatNumber(outputTokens).padStart(10)}`)
      if (reasoningTokens > 0) {
        lines.push(`  Reasoning tokens:  ${this.formatNumber(reasoningTokens).padStart(10)}`)
      }
      if (cacheReadTokens > 0) {
        lines.push(`  Cache read:        ${this.formatNumber(cacheReadTokens).padStart(10)}`)
      }
      if (cacheWriteTokens > 0) {
        lines.push(`  Cache write:       ${this.formatNumber(cacheWriteTokens).padStart(10)}`)
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
      lines.push(`Note: Actual cost from OpenCode includes provider-specific pricing`)
      lines.push(`and 200K+ context adjustments.`)
    }

    // 7. CONTEXT BREAKDOWN (if enabled and available)
    if (this.config?.enableContextBreakdown && contextBreakdown && contextBreakdown.totalCachedContext > 0) {
      lines.push(...this.formatContextBreakdown(contextBreakdown))
    }

    // 7.5 SKILLS ANALYSIS (if enabled and available)
    if (this.config?.enableSkillAnalysis && skillAnalysis) {
      if (skillAnalysis.availableSkills.length > 0) {
        lines.push(...this.formatAvailableSkills(skillAnalysis))
      }
      if (skillAnalysis.loadedSkills.length > 0) {
        lines.push(...this.formatLoadedSkills(skillAnalysis))
      }
    }

    // 8. TOOL DEFINITION COSTS (if enabled and available)
    if (this.config?.enableToolSchemaEstimation && toolEstimates && toolEstimates.length > 0) {
      lines.push(...this.formatToolEstimates(toolEstimates))
    }

    // 9. CACHE EFFICIENCY (if enabled and available)
    if (this.config?.enableCacheEfficiency && cacheEfficiency && cacheEfficiency.totalInputTokens > 0) {
      lines.push(...this.formatCacheEfficiency(cacheEfficiency, cost, modelName))
    }

    // 10. SUBAGENT COSTS (if any)
    if (subagentAnalysis && subagentAnalysis.subagents.length > 0) {
      const subagentLabelWidth = 25
      const subagentTotalCost = cost.isSubscription
        ? subagentAnalysis.totalEstimatedCost
        : subagentAnalysis.totalApiCost

      lines.push(``)
      lines.push(`\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550`)
      lines.push(
        `SUBAGENT COSTS (${subagentAnalysis.subagents.length} child sessions, ${subagentAnalysis.totalApiCalls} API calls)`
      )
      lines.push(`\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`)
      lines.push(``)
      for (const subagent of subagentAnalysis.subagents) {
        const label = `${subagent.agentType}`.padEnd(subagentLabelWidth)
        const costStr = cost.isSubscription
          ? `$${subagent.estimatedCost.toFixed(4)}`
          : `$${subagent.apiCost.toFixed(4)}`
        const tokensStr = `(${this.formatNumber(subagent.totalTokens)} tokens, ${subagent.assistantMessageCount} calls)`
        lines.push(`  ${label} ${costStr.padStart(10)}  ${tokensStr}`)
      }
      lines.push(`\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`)
      lines.push(
        `Subagent Total:${" ".repeat(subagentLabelWidth - 14)} $${subagentTotalCost.toFixed(4)}  (${this.formatNumber(subagentAnalysis.totalTokens)} tokens, ${subagentAnalysis.totalApiCalls} calls)`
      )
    }

    // 11. SUMMARY (always last)
    lines.push(``)
    lines.push(`\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550`)
    lines.push(`SUMMARY`)
    lines.push(`\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`)
    lines.push(``)
    lines.push(`                          Cost        Tokens          API Calls`)

    if (subagentAnalysis && subagentAnalysis.subagents.length > 0) {
      const subagentTotalCost = cost.isSubscription
        ? subagentAnalysis.totalEstimatedCost
        : subagentAnalysis.totalApiCost
      const grandTotalCost = mainCost + subagentTotalCost
      const grandTotalTokens = sessionTotal + subagentAnalysis.totalTokens
      const grandTotalApiCalls = assistantMessageCount + subagentAnalysis.totalApiCalls

      lines.push(
        `  Main session:      $${mainCost.toFixed(4).padStart(10)}    ${this.formatNumber(sessionTotal).padStart(10)}         ${assistantMessageCount.toString().padStart(5)}`
      )
      lines.push(
        `  Subagents:         $${subagentTotalCost.toFixed(4).padStart(10)}    ${this.formatNumber(subagentAnalysis.totalTokens).padStart(10)}         ${subagentAnalysis.totalApiCalls.toString().padStart(5)}`
      )
      lines.push(`\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`)
      lines.push(
        `  TOTAL:             $${grandTotalCost.toFixed(4).padStart(10)}    ${this.formatNumber(grandTotalTokens).padStart(10)}         ${grandTotalApiCalls.toString().padStart(5)}`
      )
    } else {
      lines.push(
        `  Session:           $${mainCost.toFixed(4).padStart(10)}    ${this.formatNumber(sessionTotal).padStart(10)}         ${assistantMessageCount.toString().padStart(5)}`
      )
    }

    lines.push(``)
    lines.push(`\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550`)

    return lines.join("\n")
  }

  private formatContextBreakdown(breakdown: ContextBreakdown): string[] {
    const lines: string[] = []
    const total = breakdown.totalCachedContext

    // Check if this is estimated from cache tokens vs actual system prompts
    const isEstimated = !breakdown.baseSystemPrompt.identified

    lines.push(``)
    lines.push(`\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550`)
    if (isEstimated) {
      lines.push(`CONTEXT BREAKDOWN (Estimated from cache_write tokens)`)
    } else {
      lines.push(`CONTEXT BREAKDOWN (From system prompt analysis)`)
    }
    lines.push(`\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`)
    lines.push(``)

    // Base System Prompt
    if (breakdown.baseSystemPrompt.tokens > 0) {
      const bar = this.formatContextBar("Base System Prompt", breakdown.baseSystemPrompt.tokens, total)
      lines.push(`  ${bar}`)
    }

    // Tool Definitions
    if (breakdown.toolDefinitions.tokens > 0) {
      const label =
        breakdown.toolDefinitions.toolCount > 0
          ? `Tool Definitions (${breakdown.toolDefinitions.toolCount})`
          : "Tool Definitions"
      const bar = this.formatContextBar(label, breakdown.toolDefinitions.tokens, total)
      lines.push(`  ${bar}`)
    }

    // Environment Context
    if (breakdown.environmentContext.tokens > 0) {
      const bar = this.formatContextBar("Environment Context", breakdown.environmentContext.tokens, total)
      lines.push(`  ${bar}`)
    }

    // Project Tree
    if (breakdown.projectTree.tokens > 0) {
      const label =
        breakdown.projectTree.fileCount > 0
          ? `Project Tree (~${breakdown.projectTree.fileCount} files)`
          : "Project Tree"
      const bar = this.formatContextBar(label, breakdown.projectTree.tokens, total)
      lines.push(`  ${bar}`)
    }

    // Custom Instructions
    if (breakdown.customInstructions.tokens > 0) {
      const bar = this.formatContextBar("Custom Instructions", breakdown.customInstructions.tokens, total)
      lines.push(`  ${bar}`)
      if (breakdown.customInstructions.sources.length > 0) {
        for (const source of breakdown.customInstructions.sources.slice(0, 3)) {
          lines.push(`      \u2192 ${source}`)
        }
      }
    }

    lines.push(`  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`)
    lines.push(`  Total Cached Context:${" ".repeat(34)}~${this.formatNumber(total)} tokens`)
    lines.push(``)
    if (isEstimated) {
      lines.push(`  Note: Breakdown estimated from first cache_write. Actual distribution may vary.`)
    } else {
      lines.push(`  Note: Values from tokenizing actual system prompt content.`)
    }

    return lines
  }

  private formatContextBar(label: string, tokens: number, total: number): string {
    const percentage = total > 0 ? ((tokens / total) * 100).toFixed(1) : "0.0"
    const percentageNum = parseFloat(percentage)
    const barWidth = Math.round((percentageNum / 100) * this.BAR_WIDTH)
    const bar = "\u2588".repeat(barWidth) + "\u2591".repeat(Math.max(0, this.BAR_WIDTH - barWidth))
    const labelPadded = label.padEnd(this.CONTEXT_LABEL_WIDTH)

    return `${labelPadded} ${bar}   ~${this.formatNumber(tokens).padStart(6)} tokens`
  }

  private formatToolEstimates(estimates: ToolSchemaEstimate[]): string[] {
    const lines: string[] = []
    const enabledEstimates = estimates.filter((e) => e.enabled)
    const totalTokens = enabledEstimates.reduce((sum, e) => sum + e.estimatedTokens, 0)

    lines.push(``)
    lines.push(`\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550`)
    lines.push(`TOOL DEFINITION COSTS (Estimated from argument analysis)`)
    lines.push(`\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`)
    lines.push(``)
    lines.push(`  ${"Tool".padEnd(this.TOOL_ESTIMATE_LABEL_WIDTH)} ${"Est. Tokens".padStart(12)}   Args   Complexity`)
    lines.push(`  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`)

    for (const estimate of enabledEstimates) {
      const name = estimate.name.padEnd(this.TOOL_ESTIMATE_LABEL_WIDTH)
      const tokens = `~${this.formatNumber(estimate.estimatedTokens)}`.padStart(12)
      const args = estimate.argumentCount.toString().padStart(5)
      const complexity = estimate.hasComplexArgs ? "complex (arrays/objects)" : "simple"
      lines.push(`  ${name} ${tokens}   ${args}   ${complexity}`)
    }

    lines.push(`  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`)
    lines.push(
      `  Total:${" ".repeat(this.TOOL_ESTIMATE_LABEL_WIDTH - 6)} ~${this.formatNumber(totalTokens).padStart(11)} tokens (${enabledEstimates.length} enabled tools)`
    )
    lines.push(``)
    lines.push(`  Note: Estimates inferred from tool call arguments in this session.`)
    lines.push(`        Actual schema tokens may vary +/-20%.`)

    return lines
  }

  private formatCacheEfficiency(efficiency: CacheEfficiency, cost: CostEstimate, modelName: string): string[] {
    const lines: string[] = []
    const total = efficiency.totalInputTokens

    lines.push(``)
    lines.push(`\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550`)
    lines.push(`CACHE EFFICIENCY`)
    lines.push(`\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`)
    lines.push(``)
    lines.push(`  Token Distribution:`)

    // Cache Read bar
    const cacheReadPct = total > 0 ? ((efficiency.cacheReadTokens / total) * 100).toFixed(1) : "0.0"
    const cacheReadBar = this.formatEfficiencyBar(efficiency.cacheReadTokens, total)
    lines.push(`    Cache Read:        ${this.formatNumber(efficiency.cacheReadTokens).padStart(10)} tokens   ${cacheReadBar}  ${cacheReadPct}%`)

    // Fresh Input bar
    const freshPct = total > 0 ? ((efficiency.freshInputTokens / total) * 100).toFixed(1) : "0.0"
    const freshBar = this.formatEfficiencyBar(efficiency.freshInputTokens, total)
    lines.push(`    Fresh Input:       ${this.formatNumber(efficiency.freshInputTokens).padStart(10)} tokens   ${freshBar}  ${freshPct}%`)

    lines.push(`  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`)
    lines.push(`  Cache Hit Rate:      ${efficiency.cacheHitRate.toFixed(1)}%`)
    lines.push(``)

    // Cost analysis
    lines.push(
      `  Cost Analysis (${modelName} @ $${cost.pricePerMillionInput.toFixed(2)}/M input, $${cost.pricePerMillionCacheRead.toFixed(2)}/M cache read):`
    )
    lines.push(
      `    Without caching:   $${efficiency.costWithoutCaching.toFixed(4)}  (${this.formatNumber(total)} tokens x $${cost.pricePerMillionInput.toFixed(2)}/M)`
    )
    lines.push(
      `    With caching:      $${efficiency.costWithCaching.toFixed(4)}  (fresh x $${cost.pricePerMillionInput.toFixed(2)}/M + cached x $${cost.pricePerMillionCacheRead.toFixed(2)}/M)`
    )
    lines.push(`  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`)
    lines.push(`  Cost Savings:        $${efficiency.costSavings.toFixed(4)}  (${efficiency.savingsPercent.toFixed(1)}% reduction)`)
    lines.push(
      `  Effective Rate:      $${efficiency.effectiveRate.toFixed(2)}/M tokens  (vs. $${efficiency.standardRate.toFixed(2)}/M standard)`
    )

    return lines
  }

  private formatEfficiencyBar(value: number, total: number): string {
    const percentage = total > 0 ? (value / total) * 100 : 0
    const barWidth = Math.round((percentage / 100) * this.BAR_WIDTH)
    return "\u2588".repeat(barWidth) + "\u2591".repeat(Math.max(0, this.BAR_WIDTH - barWidth))
  }

  private formatAvailableSkills(analysis: SkillAnalysis): string[] {
    const lines: string[] = []
    const total = analysis.totalAvailableTokens

    lines.push(``)
    lines.push(`\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550`)
    lines.push(`AVAILABLE SKILLS (in tool definitions)`)
    lines.push(`\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`)
    lines.push(``)
    lines.push(`These skills are listed in the skill tool description and consume tokens on every API call.`)
    lines.push(``)

    // Header
    const nameHeader = "Skill".padEnd(this.SKILL_NAME_WIDTH)
    const descHeader = "Description".padEnd(this.SKILL_DESC_WIDTH)
    lines.push(`  ${nameHeader} ${descHeader} Tokens`)
    lines.push(`  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`)

    // Sort by tokens descending
    const sortedSkills = [...analysis.availableSkills].sort((a, b) => b.tokens - a.tokens)

    for (const skill of sortedSkills) {
      const name =
        skill.name.length > this.SKILL_NAME_WIDTH
          ? skill.name.substring(0, this.SKILL_NAME_WIDTH - 1) + "\u2026"
          : skill.name.padEnd(this.SKILL_NAME_WIDTH)

      const desc =
        skill.description.length > this.SKILL_DESC_WIDTH
          ? skill.description.substring(0, this.SKILL_DESC_WIDTH - 1) + "\u2026"
          : skill.description.padEnd(this.SKILL_DESC_WIDTH)

      const tokens = `~${this.formatNumber(skill.tokens)}`.padStart(7)

      lines.push(`  ${name} ${desc} ${tokens}`)
    }

    lines.push(`  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`)
    lines.push(`  Total: ~${this.formatNumber(total)} tokens (${analysis.availableSkills.length} skills available)`)
    lines.push(``)
    lines.push(
      `  Note: Full skill tool description is ~${this.formatNumber(analysis.skillToolDescriptionTokens)} tokens (includes boilerplate).`
    )

    return lines
  }

  private formatLoadedSkills(analysis: SkillAnalysis): string[] {
    const lines: string[] = []
    const total = analysis.totalLoadedTokens

    lines.push(``)
    lines.push(`\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550`)
    lines.push(`LOADED SKILLS (on-demand content)`)
    lines.push(`\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`)
    lines.push(``)
    lines.push(`Skills loaded during this session via the skill tool.`)
    lines.push(``)

    // Header
    const nameHeader = "Skill".padEnd(this.SKILL_NAME_WIDTH)
    lines.push(`  ${nameHeader} Message #     Tokens     Calls`)
    lines.push(`  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`)

    for (const skill of analysis.loadedSkills) {
      const name =
        skill.name.length > this.SKILL_NAME_WIDTH
          ? skill.name.substring(0, this.SKILL_NAME_WIDTH - 1) + "\u2026"
          : skill.name.padEnd(this.SKILL_NAME_WIDTH)

      const msgNum = `#${skill.firstMessageIndex}`.padStart(10)
      const tokens = this.formatNumber(skill.totalTokens).padStart(10)
      const calls = `${skill.callCount}x`.padStart(9)

      lines.push(`  ${name} ${msgNum} ${tokens} ${calls}`)
    }

    lines.push(`  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`)
    lines.push(
      `  Total: ${this.formatNumber(total)} tokens (${analysis.loadedSkills.length} skill${analysis.loadedSkills.length !== 1 ? "s" : ""} loaded)`
    )
    lines.push(``)
    lines.push(`  Note: Loaded skill content stays in context (protected from pruning).`)

    return lines
  }

  private collectTopEntries(analysis: TokenAnalysis, limit: number): CategoryEntry[] {
    const pool = [
      ...analysis.categories.system.allEntries,
      ...analysis.categories.user.allEntries,
      ...analysis.categories.assistant.allEntries,
      ...analysis.categories.tools.allEntries,
      ...analysis.categories.reasoning.allEntries,
    ]
      .filter((entry) => entry.tokens > 0)
      .sort((a, b) => b.tokens - a.tokens)

    return pool.slice(0, limit)
  }

  private formatNumber(value: number): string {
    return new Intl.NumberFormat("en-US").format(value)
  }
}
