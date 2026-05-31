import type { CostEstimate, ModelCostEstimate } from "./types.js"
import { formatNumber } from "./formatter-helpers.js"

export function formatCostEstimateLines(cost: CostEstimate): string[] {
  const hasMultipleModels = cost.perModelCosts.length > 1

  if (!hasMultipleModels) {
    return formatSingleModelCostLines(cost)
  }

  const lines: string[] = []
  for (const modelCost of cost.perModelCosts) {
    lines.push(
      `  ${modelCost.modelName} (${modelCost.apiCallCount} call${modelCost.apiCallCount === 1 ? "" : "s"}): $${modelCost.estimatedSessionCost.toFixed(4)}`
    )
    if (!modelCost.hasPricing) {
      lines.push(`    Pricing not found; used fallback default rates.`)
    }
    lines.push(...formatModelCostTokenLines(modelCost, "    "))
  }

  lines.push(``)
  lines.push(`  Blended input:      $${cost.estimatedInputCost.toFixed(4)}`)
  lines.push(`  Blended output:     $${cost.estimatedOutputCost.toFixed(4)}`)
  if (cost.cacheReadTokens > 0) lines.push(`  Blended cache read: $${cost.estimatedCacheReadCost.toFixed(4)}`)
  if (cost.cacheWriteTokens > 0) lines.push(`  Blended cache write: $${cost.estimatedCacheWriteCost.toFixed(4)}`)

  return lines
}

function formatSingleModelCostLines(cost: CostEstimate): string[] {
  const modelCost = cost.perModelCosts[0]
  if (modelCost) return formatModelCostTokenLines(modelCost, "  ")

  return [
    `  Input tokens:      ${formatNumber(cost.inputTokens).padStart(10)} × $${cost.pricePerMillionInput.toFixed(2)}/M  = $${cost.estimatedInputCost.toFixed(4)}`,
    `  Output tokens:     ${formatNumber(cost.outputTokens + cost.reasoningTokens).padStart(10)} × $${cost.pricePerMillionOutput.toFixed(2)}/M  = $${cost.estimatedOutputCost.toFixed(4)}`,
  ]
}

function formatModelCostTokenLines(modelCost: ModelCostEstimate, indent: string): string[] {
  const lines: string[] = []
  if (modelCost.pricingTier === "context_over_200k") {
    lines.push(`${indent}Pricing tier:      200K+ context rates`)
  } else if (modelCost.pricingTier === "mixed_context_tiers") {
    lines.push(`${indent}Pricing tier:      Mixed standard/200K+ context rates (effective blended rates shown)`)
  }
  lines.push(
    `${indent}Input tokens:      ${formatNumber(modelCost.inputTokens).padStart(10)} × $${modelCost.pricePerMillionInput.toFixed(2)}/M  = $${modelCost.estimatedInputCost.toFixed(4)}`
  )
  lines.push(
    `${indent}Output tokens:     ${formatNumber(modelCost.outputTokens + modelCost.reasoningTokens).padStart(10)} × $${modelCost.pricePerMillionOutput.toFixed(2)}/M  = $${modelCost.estimatedOutputCost.toFixed(4)}`
  )
  if (modelCost.cacheReadTokens > 0) {
    lines.push(
      `${indent}Cache read:        ${formatNumber(modelCost.cacheReadTokens).padStart(10)} × $${modelCost.pricePerMillionCacheRead.toFixed(2)}/M  = $${modelCost.estimatedCacheReadCost.toFixed(4)}`
    )
  }
  if (modelCost.cacheWriteTokens > 0) {
    lines.push(
      `${indent}Cache write:       ${formatNumber(modelCost.cacheWriteTokens).padStart(10)} × $${modelCost.pricePerMillionCacheWrite.toFixed(2)}/M  = $${modelCost.estimatedCacheWriteCost.toFixed(4)}`
    )
  }

  return lines
}
