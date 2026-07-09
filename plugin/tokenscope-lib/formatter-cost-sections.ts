import type { CostEstimate, ModelCostEstimate } from "./types.js"
import { formatNumber, formatRate, formatUsd } from "./formatter-helpers.js"

export interface DetailedSubagentBreakdown {
  freshInputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  reasoningTokens: number
  actualCost?: number
  estimatedTotalCost?: number
  estimatedInputCost: number
  estimatedCacheReadCost: number
  estimatedCacheWriteCost: number
  estimatedOutputCost: number
}

export function formatCostEstimateLines(cost: CostEstimate): string[] {
  const hasMultipleModels = cost.perModelCosts.length > 1

  if (!hasMultipleModels) {
    return formatSingleModelCostLines(cost)
  }

  const lines: string[] = []
  for (const modelCost of cost.perModelCosts) {
    lines.push(
      `  ${modelCost.modelName} (${modelCost.apiCallCount} call${modelCost.apiCallCount === 1 ? "" : "s"}): $${formatUsd(modelCost.estimatedSessionCost)}`
    )
    if (!modelCost.hasPricing) {
      lines.push(`    Pricing not found; used fallback default rates.`)
    }
    lines.push(...formatModelCostTokenLines(modelCost, "    "))
  }

  lines.push(``)
  lines.push(`  Blended input:      $${formatUsd(cost.estimatedInputCost)}`)
  lines.push(`  Blended output:     $${formatUsd(cost.estimatedOutputCost)}`)
  if (cost.cacheReadTokens > 0) lines.push(`  Blended cache read: $${formatUsd(cost.estimatedCacheReadCost)}`)
  if (cost.cacheWriteTokens > 0) lines.push(`  Blended cache write: $${formatUsd(cost.estimatedCacheWriteCost)}`)

  return lines
}

export function formatDetailedSubagentBreakdownLines(
  breakdown: DetailedSubagentBreakdown,
  indent = "    "
): string[] {
  const outputLabel = breakdown.reasoningTokens > 0 ? "output+reasoning" : "output"
  const estimatedTotalCost =
    breakdown.estimatedTotalCost ??
    breakdown.estimatedInputCost +
      breakdown.estimatedCacheReadCost +
      breakdown.estimatedCacheWriteCost +
      breakdown.estimatedOutputCost
  const actualCost = breakdown.actualCost === undefined ? "" : ` | OpenCode-recorded total $${formatUsd(breakdown.actualCost)}`
  const tokenParts = [
    `fresh ${formatNumber(breakdown.freshInputTokens)}`,
    `cache read ${formatNumber(breakdown.cacheReadTokens)}`,
    `cache write ${formatNumber(breakdown.cacheWriteTokens)}`,
    `output ${formatNumber(breakdown.outputTokens)}`,
  ]

  if (breakdown.reasoningTokens > 0) {
    tokenParts.push(`reasoning ${formatNumber(breakdown.reasoningTokens)}`)
  }

  return [
    `${indent}Tokens: ${tokenParts.join(" | ")}`,
    `${indent}Estimated API-rate split: fresh $${formatUsd(breakdown.estimatedInputCost)} | cache read $${formatUsd(breakdown.estimatedCacheReadCost)} | cache write $${formatUsd(breakdown.estimatedCacheWriteCost)} | ${outputLabel} $${formatUsd(breakdown.estimatedOutputCost)} (estimated total $${formatUsd(estimatedTotalCost)}${actualCost})`,
  ]
}

function formatSingleModelCostLines(cost: CostEstimate): string[] {
  const modelCost = cost.perModelCosts[0]
  if (modelCost) return formatModelCostTokenLines(modelCost, "  ")

  return [
    `  Input tokens:      ${formatNumber(cost.inputTokens).padStart(10)} × $${formatRate(cost.pricePerMillionInput)}/M  = $${formatUsd(cost.estimatedInputCost)}`,
    `  Output tokens:     ${formatNumber(cost.outputTokens + cost.reasoningTokens).padStart(10)} × $${formatRate(cost.pricePerMillionOutput)}/M  = $${formatUsd(cost.estimatedOutputCost)}`,
  ]
}

function formatModelCostTokenLines(modelCost: ModelCostEstimate, indent: string): string[] {
  const lines: string[] = []
  if (modelCost.pricingTier === "context_tier") {
    const threshold = modelCost.pricingTierThreshold ?? 200_000
    lines.push(`${indent}Pricing tier:      >${formatNumber(threshold)} context-token rates`)
  } else if (modelCost.pricingTier === "mixed_context_tiers") {
    lines.push(`${indent}Pricing tier:      Mixed context-rate tiers (effective blended rates shown)`)
  }
  lines.push(
    `${indent}Input tokens:      ${formatNumber(modelCost.inputTokens).padStart(10)} × $${formatRate(modelCost.pricePerMillionInput)}/M  = $${formatUsd(modelCost.estimatedInputCost)}`
  )
  lines.push(
    `${indent}Output tokens:     ${formatNumber(modelCost.outputTokens + modelCost.reasoningTokens).padStart(10)} × $${formatRate(modelCost.pricePerMillionOutput)}/M  = $${formatUsd(modelCost.estimatedOutputCost)}`
  )
  if (modelCost.cacheReadTokens > 0) {
    lines.push(
      `${indent}Cache read:        ${formatNumber(modelCost.cacheReadTokens).padStart(10)} × $${formatRate(modelCost.pricePerMillionCacheRead)}/M  = $${formatUsd(modelCost.estimatedCacheReadCost)}`
    )
  }
  if (modelCost.cacheWriteTokens > 0) {
    lines.push(
      `${indent}Cache write:       ${formatNumber(modelCost.cacheWriteTokens).padStart(10)} × $${formatRate(modelCost.pricePerMillionCacheWrite)}/M  = $${formatUsd(modelCost.estimatedCacheWriteCost)}`
    )
  }

  return lines
}
