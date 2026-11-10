import type { CacheEfficiency, CategoryEntry, TokenAnalysis } from "./types.js"

export const BAR_WIDTH = 30
export const TOKEN_SPACING = 11
export const CATEGORY_LABEL_WIDTH = 9
export const TOOL_LABEL_WIDTH = 20
export const TOP_CONTRIBUTOR_LABEL_WIDTH = 30
export const CONTEXT_LABEL_WIDTH = 22
export const TOOL_ESTIMATE_LABEL_WIDTH = 18
export const SKILL_NAME_WIDTH = 22
export const SKILL_DESC_WIDTH = 45
export const SUBAGENT_NAME_WIDTH = 22
export const SUBAGENT_DESC_WIDTH = 50

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value)
}

function formatDecimal(value: number, minimumFractionDigits: number, maximumFractionDigits: number): string {
  const normalized = Math.abs(value) < 0.5 * 10 ** -maximumFractionDigits ? 0 : value
  const fixed = normalized.toFixed(maximumFractionDigits)
  const [integer, fraction = ""] = fixed.split(".")
  const trimmed = fraction.replace(/0+$/, "")
  return `${integer}.${trimmed.padEnd(minimumFractionDigits, "0")}`
}

export function formatUsd(value: number): string {
  return formatDecimal(value, 4, 8)
}

export function formatRate(value: number): string {
  return formatDecimal(value, 2, 8)
}

export function formatCategoryBar(
  label: string,
  tokens: number,
  total: number,
  labelWidth: number = CATEGORY_LABEL_WIDTH
): string {
  if (tokens === 0) return ""

  const percentage = total > 0 ? ((tokens / total) * 100).toFixed(1) : "0.0"
  const percentageNum = parseFloat(percentage)
  const barWidth = Math.round((percentageNum / 100) * BAR_WIDTH)
  const bar = "█".repeat(barWidth) + "░".repeat(Math.max(0, BAR_WIDTH - barWidth))
  const labelPadded = label.padEnd(labelWidth)
  const formattedTokens = formatNumber(tokens)

  let pct = percentage
  if (percentageNum < 10) {
    pct = " " + pct
  }

  const tokensPart = `(${formattedTokens})`
  const spacesNeeded = Math.max(1, TOKEN_SPACING - tokensPart.length)
  const spacing = " ".repeat(spacesNeeded)

  return `${labelPadded} ${bar} ${spacing}${pct}% ${tokensPart}`
}

export function formatContextBar(label: string, tokens: number, total: number): string {
  const percentage = total > 0 ? ((tokens / total) * 100).toFixed(1) : "0.0"
  const percentageNum = parseFloat(percentage)
  const barWidth = Math.round((percentageNum / 100) * BAR_WIDTH)
  const bar = "█".repeat(barWidth) + "░".repeat(Math.max(0, BAR_WIDTH - barWidth))
  const labelPadded = label.padEnd(CONTEXT_LABEL_WIDTH)

  return `${labelPadded} ${bar}   ~${formatNumber(tokens).padStart(6)} tokens`
}

export function formatEfficiencyBar(value: number, total: number): string {
  const percentage = total > 0 ? (value / total) * 100 : 0
  const barWidth = Math.round((percentage / 100) * BAR_WIDTH)
  return "█".repeat(barWidth) + "░".repeat(Math.max(0, BAR_WIDTH - barWidth))
}

export function collectTopEntries(analysis: TokenAnalysis, limit: number): CategoryEntry[] {
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

export function calculateModelAwareCacheEfficiency(efficiency: CacheEfficiency, cost: { perModelCosts: Array<{
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  pricePerMillionInput: number
  estimatedInputCost: number
  estimatedInputCostWithoutCaching?: number
  estimatedCacheReadCost: number
  estimatedCacheWriteCost: number
}> }): CacheEfficiency {
  if (cost.perModelCosts.length === 0) return efficiency

  const costWithoutCaching = cost.perModelCosts.reduce((sum, modelCost) => {
    const inputIfUncached = modelCost.inputTokens + modelCost.cacheReadTokens + modelCost.cacheWriteTokens
    return sum + (modelCost.estimatedInputCostWithoutCaching ?? (inputIfUncached / 1_000_000) * modelCost.pricePerMillionInput)
  }, 0)
  const costWithCaching = cost.perModelCosts.reduce(
    (sum, modelCost) =>
      sum + modelCost.estimatedInputCost + modelCost.estimatedCacheReadCost + modelCost.estimatedCacheWriteCost,
    0
  )
  const costSavings = costWithoutCaching - costWithCaching
  const savingsPercent = costWithoutCaching > 0 ? (costSavings / costWithoutCaching) * 100 : 0
  const effectiveRate = efficiency.totalInputTokens > 0 ? (costWithCaching / efficiency.totalInputTokens) * 1_000_000 : 0
  const standardRate =
    efficiency.totalInputTokens > 0 ? (costWithoutCaching / efficiency.totalInputTokens) * 1_000_000 : efficiency.standardRate

  return {
    ...efficiency,
    costWithoutCaching,
    costWithCaching,
    costSavings,
    savingsPercent,
    effectiveRate,
    standardRate,
  }
}
