// OutputFormatter - generates visual reports from token analysis

import type {
  TokenAnalysis,
  CategoryEntry,
  CostEstimate,
  SubagentAnalysis,
  ContextAnalysis,
  ToolDefinitionsBreakdown,
  SystemPromptBreakdown,
  ContextEfficiency,
  RequestComposition,
} from "./types"
import { CostCalculator } from "./cost"

export class OutputFormatter {
  private readonly BAR_WIDTH = 30
  private readonly TOKEN_SPACING = 11
  private readonly CATEGORY_LABEL_WIDTH = 9
  private readonly TOOL_LABEL_WIDTH = 20
  private readonly TOP_CONTRIBUTOR_LABEL_WIDTH = 30
  private readonly CONTEXT_LABEL_WIDTH = 25

  constructor(private costCalculator: CostCalculator) {}

  private readonly DOUBLE_LINE = "\u2550".repeat(75)
  private readonly SINGLE_LINE = "\u2500".repeat(73)
  private readonly SHORT_LINE = "\u2500".repeat(37)

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
      analysis.contextAnalysis
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
    contextAnalysis?: ContextAnalysis
  ): string {
    const lines: string[] = []
    const sessionTotal = inputTokens + cacheReadTokens + cacheWriteTokens + outputTokens + reasoningTokens
    const mainCost = cost.isSubscription ? cost.estimatedSessionCost : cost.apiSessionCost

    // Header
    lines.push(this.DOUBLE_LINE)
    lines.push(`Token Analysis: Session ${sessionID}`)
    lines.push(`Model: ${modelName}`)
    if (contextAnalysis) {
      lines.push(`Provider: ${contextAnalysis.providerID}`)
    }
    lines.push(this.DOUBLE_LINE)
    lines.push(``)

    // NEW SECTIONS: Context Analysis (Tool Definitions, System Prompt, Efficiency, Request Composition)
    if (contextAnalysis) {
      lines.push(...this.formatToolDefinitionsSection(contextAnalysis.toolDefinitions))
      lines.push(``)
      lines.push(...this.formatSystemPromptSection(contextAnalysis.systemPrompt))
      lines.push(``)
      lines.push(...this.formatRequestCompositionSection(contextAnalysis.requestComposition))
      lines.push(``)
      lines.push(...this.formatContextEfficiencySection(contextAnalysis.efficiency))
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

    // 7. SUBAGENT COSTS (if any)
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

    // 8. SUMMARY (always last)
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

  // ============================================================================
  // NEW CONTEXT ANALYSIS SECTIONS
  // ============================================================================

  private formatToolDefinitionsSection(toolDefs: ToolDefinitionsBreakdown): string[] {
    const lines: string[] = []

    lines.push(this.DOUBLE_LINE)
    lines.push(`TOOL DEFINITIONS (Static Context)`)
    lines.push(this.SINGLE_LINE)
    lines.push(``)
    lines.push(`These tool schemas are sent with EVERY API request. They define what`)
    lines.push(`capabilities the AI has access to and consume tokens on each call.`)
    lines.push(``)

    if (toolDefs.tools.length === 0) {
      lines.push(`  No tool definitions available (API may not support this endpoint)`)
      return lines
    }

    lines.push(`  Tool Count: ${toolDefs.toolCount} tools registered`)
    lines.push(``)

    // Show breakdown by description vs schema
    lines.push(`  Token Breakdown:`)
    lines.push(`    Descriptions:    ${this.formatNumber(toolDefs.totalDescriptionTokens).padStart(10)} tokens`)
    lines.push(`    JSON Schemas:    ${this.formatNumber(toolDefs.totalSchemaTokens).padStart(10)} tokens`)
    lines.push(`    ${this.SHORT_LINE}`)
    lines.push(`    Total:           ${this.formatNumber(toolDefs.totalTokens).padStart(10)} tokens`)
    lines.push(``)

    // Show individual tools with bars
    lines.push(`  Per-Tool Breakdown (sorted by token count):`)
    lines.push(``)

    const maxTools = 10 // Show top 10 tools
    const displayTools = toolDefs.tools.slice(0, maxTools)

    for (const tool of displayTools) {
      const barLine = this.formatCategoryBar(tool.id, tool.totalTokens, toolDefs.totalTokens, this.CONTEXT_LABEL_WIDTH)
      if (barLine) {
        lines.push(`  ${barLine}`)
      }
    }

    if (toolDefs.tools.length > maxTools) {
      const remaining = toolDefs.tools.length - maxTools
      const remainingTokens = toolDefs.tools.slice(maxTools).reduce((sum, t) => sum + t.totalTokens, 0)
      lines.push(`  ... and ${remaining} more tools (${this.formatNumber(remainingTokens)} tokens)`)
    }

    return lines
  }

  private formatSystemPromptSection(systemPrompt: SystemPromptBreakdown): string[] {
    const lines: string[] = []

    lines.push(this.DOUBLE_LINE)
    lines.push(`SYSTEM PROMPT BREAKDOWN`)
    lines.push(this.SINGLE_LINE)
    lines.push(``)
    lines.push(`The system prompt defines the AI's identity, capabilities, and behavior.`)
    lines.push(`It is sent with every request and typically cached for efficiency.`)
    lines.push(``)

    if (systemPrompt.sections.length === 0 || systemPrompt.totalTokens === 0) {
      lines.push(`  System prompt not available in message data.`)
      lines.push(`  (The prompt may be injected server-side or not exposed via API)`)
      return lines
    }

    lines.push(`  Total System Prompt: ${this.formatNumber(systemPrompt.totalTokens)} tokens`)
    lines.push(``)
    lines.push(`  Section Breakdown:`)
    lines.push(``)

    for (const section of systemPrompt.sections) {
      const percentage = ((section.tokens / systemPrompt.totalTokens) * 100).toFixed(1)
      const label = section.label.padEnd(this.CONTEXT_LABEL_WIDTH)
      const tokens = this.formatNumber(section.tokens).padStart(8)
      lines.push(`  ${label} ${tokens} tokens (${percentage.padStart(5)}%)`)
      lines.push(`    \u2514\u2500 ${section.description}`)
    }

    return lines
  }

  private formatRequestCompositionSection(composition: RequestComposition): string[] {
    const lines: string[] = []

    lines.push(this.DOUBLE_LINE)
    lines.push(`MOST RECENT REQUEST COMPOSITION`)
    lines.push(this.SINGLE_LINE)
    lines.push(``)
    lines.push(`What was sent to the API in the most recent request:`)
    lines.push(``)

    if (composition.totalRequest === 0) {
      lines.push(`  No request data available yet.`)
      return lines
    }

    // Create visual bar chart
    const components = [
      { label: "Tool Definitions", tokens: composition.toolDefinitions, desc: "JSON schemas for all available tools" },
      { label: "System Prompt", tokens: composition.systemPrompt, desc: "AI identity, rules, and instructions" },
      {
        label: "Conversation History",
        tokens: composition.conversationHistory,
        desc: "Previous messages in this session",
      },
      { label: "User Message", tokens: composition.userMessage, desc: "Your most recent message" },
    ]

    for (const comp of components) {
      if (comp.tokens > 0) {
        const barLine = this.formatCategoryBar(comp.label, comp.tokens, composition.totalRequest, this.CONTEXT_LABEL_WIDTH)
        if (barLine) {
          lines.push(`  ${barLine}`)
        }
      }
    }

    lines.push(``)
    lines.push(`  ${this.SHORT_LINE}`)
    lines.push(`  Total Request Size:     ${this.formatNumber(composition.totalRequest).padStart(10)} tokens`)
    lines.push(``)

    // Add explanation
    const staticTokens = composition.toolDefinitions + composition.systemPrompt
    const dynamicTokens = composition.conversationHistory + composition.userMessage
    const staticPercent = composition.totalRequest > 0 ? ((staticTokens / composition.totalRequest) * 100).toFixed(1) : "0"

    lines.push(`  Static Context (cached): ${this.formatNumber(staticTokens).padStart(10)} tokens (${staticPercent}%)`)
    lines.push(`  Dynamic Content:         ${this.formatNumber(dynamicTokens).padStart(10)} tokens`)
    lines.push(``)
    lines.push(`  Note: Static context is typically served from cache at 1/10th the cost.`)

    return lines
  }

  private formatContextEfficiencySection(efficiency: ContextEfficiency): string[] {
    const lines: string[] = []

    lines.push(this.DOUBLE_LINE)
    lines.push(`CONTEXT CACHING EFFICIENCY`)
    lines.push(this.SINGLE_LINE)
    lines.push(``)
    lines.push(`How effectively caching is reducing your API costs:`)
    lines.push(``)

    if (efficiency.cacheReadTokens === 0 && efficiency.freshInputTokens === 0) {
      lines.push(`  No caching data available for this session.`)
      return lines
    }

    // Visual representation of cache vs fresh
    const totalInput = efficiency.freshInputTokens + efficiency.cacheReadTokens
    const cacheHitPercent = efficiency.cacheHitRate.toFixed(1)
    const cacheMissPercent = (100 - efficiency.cacheHitRate).toFixed(1)

    lines.push(`  Most Recent Request Input Breakdown:`)
    lines.push(``)
    lines.push(`    Fresh Input (full price):  ${this.formatNumber(efficiency.freshInputTokens).padStart(10)} tokens (${cacheMissPercent}%)`)
    lines.push(`    Cache Read (1/10 price):   ${this.formatNumber(efficiency.cacheReadTokens).padStart(10)} tokens (${cacheHitPercent}%)`)
    if (efficiency.cacheWriteTokens > 0) {
      lines.push(`    Cache Write (1.25x price): ${this.formatNumber(efficiency.cacheWriteTokens).padStart(10)} tokens`)
    }
    lines.push(`    ${this.SHORT_LINE}`)
    lines.push(`    Total Input:               ${this.formatNumber(totalInput).padStart(10)} tokens`)
    lines.push(``)

    // Cache efficiency visualization
    const cacheBarWidth = Math.round((efficiency.cacheHitRate / 100) * this.BAR_WIDTH)
    const freshBarWidth = this.BAR_WIDTH - cacheBarWidth
    const cacheBar = "\u2588".repeat(cacheBarWidth) + "\u2591".repeat(freshBarWidth)

    lines.push(`  Cache Hit Rate: [${cacheBar}] ${cacheHitPercent}%`)
    lines.push(``)

    // Cost savings explanation
    const totalWithWrite = totalInput + efficiency.cacheWriteTokens
    const effectiveTokens = Math.round(
      efficiency.freshInputTokens + efficiency.cacheReadTokens * 0.1 + efficiency.cacheWriteTokens * 1.25
    )

    lines.push(`  Cost Impact:`)
    lines.push(`    Without caching: ${this.formatNumber(totalWithWrite)} tokens at full price`)
    if (efficiency.cacheWriteTokens > 0) {
      lines.push(
        `    With caching:    ${this.formatNumber(efficiency.freshInputTokens)} @ 100% + ${this.formatNumber(efficiency.cacheReadTokens)} @ 10% + ${this.formatNumber(efficiency.cacheWriteTokens)} @ 125%`
      )
      lines.push(`                     = ~${this.formatNumber(effectiveTokens)} effective tokens`)
    } else {
      lines.push(
        `    With caching:    ${this.formatNumber(efficiency.freshInputTokens)} full + ${this.formatNumber(efficiency.cacheReadTokens)} @ 10% = ~${this.formatNumber(effectiveTokens)} effective tokens`
      )
    }
    lines.push(``)
    lines.push(`  Effective Cost Reduction: ${efficiency.effectiveCostReduction.toFixed(1)}%`)
    lines.push(``)

    if (efficiency.cacheHitRate >= 80) {
      lines.push(`  \u2713 Excellent caching! Your static context is being efficiently reused.`)
    } else if (efficiency.cacheHitRate >= 50) {
      lines.push(`  \u2713 Good caching. Consider keeping conversations shorter for better cache hits.`)
    } else if (efficiency.cacheHitRate > 0) {
      lines.push(`  ! Low cache hit rate. Long conversations may cause cache misses.`)
    } else {
      lines.push(`  ! No cache hits detected. This may be the first request or cache expired.`)
    }

    return lines
  }
}
