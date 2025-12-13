// CostCalculator - calculates costs from token analysis

import type { TokenAnalysis, CostEstimate, ModelPricing } from "./types"

export class CostCalculator {
  constructor(private pricingData: Record<string, ModelPricing>) {}

  calculateCost(analysis: TokenAnalysis): CostEstimate {
    const pricing = this.getPricing(analysis.model.name)
    const hasActivity = analysis.assistantMessageCount > 0 && (analysis.inputTokens > 0 || analysis.outputTokens > 0)
    const isSubscription = hasActivity && analysis.sessionCost === 0

    const estimatedInputCost = (analysis.inputTokens / 1_000_000) * pricing.input
    const estimatedOutputCost = ((analysis.outputTokens + analysis.reasoningTokens) / 1_000_000) * pricing.output
    const estimatedCacheReadCost = (analysis.cacheReadTokens / 1_000_000) * pricing.cacheRead
    const estimatedCacheWriteCost = (analysis.cacheWriteTokens / 1_000_000) * pricing.cacheWrite
    const estimatedSessionCost =
      estimatedInputCost + estimatedOutputCost + estimatedCacheReadCost + estimatedCacheWriteCost

    return {
      isSubscription,
      apiSessionCost: analysis.sessionCost,
      apiMostRecentCost: analysis.mostRecentCost,
      estimatedSessionCost,
      estimatedInputCost,
      estimatedOutputCost,
      estimatedCacheReadCost,
      estimatedCacheWriteCost,
      pricePerMillionInput: pricing.input,
      pricePerMillionOutput: pricing.output,
      pricePerMillionCacheRead: pricing.cacheRead,
      pricePerMillionCacheWrite: pricing.cacheWrite,
      inputTokens: analysis.inputTokens,
      outputTokens: analysis.outputTokens,
      reasoningTokens: analysis.reasoningTokens,
      cacheReadTokens: analysis.cacheReadTokens,
      cacheWriteTokens: analysis.cacheWriteTokens,
    }
  }

  getPricing(modelName: string): ModelPricing {
    const normalizedName = this.normalizeModelName(modelName)

    if (this.pricingData[normalizedName]) return this.pricingData[normalizedName]

    const lowerModel = normalizedName.toLowerCase()
    for (const [key, pricing] of Object.entries(this.pricingData)) {
      if (lowerModel.startsWith(key.toLowerCase())) return pricing
    }

    return this.pricingData["default"] || { input: 1, output: 3, cacheWrite: 0, cacheRead: 0 }
  }

  private normalizeModelName(modelName: string): string {
    return modelName.includes("/") ? modelName.split("/").pop() || modelName : modelName
  }
}
