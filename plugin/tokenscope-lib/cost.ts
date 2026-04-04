// CostCalculator - calculates costs from token analysis

import type { TokenAnalysis, CostEstimate, ModelPricing } from "./types"

export class CostCalculator {
  constructor(private pricingData: Record<string, ModelPricing>) {}

  calculateCost(analysis: TokenAnalysis): CostEstimate {
    const pricing = this.getPricing(analysis.pricingModelName ?? analysis.model.name)
    const hasActivity = analysis.apiCallCount > 0 && (analysis.inputTokens > 0 || analysis.outputTokens > 0)
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

  buildLookupKey(providerID?: string, modelID?: string): string {
    const provider = providerID?.trim()
    const model = modelID?.trim()

    if (!provider) return model ?? ""
    if (!model) return provider

    const normalizedProvider = provider.toLowerCase()
    const normalizedModel = model.toLowerCase()
    if (normalizedModel.startsWith(`${normalizedProvider}/`)) return model

    return `${provider}/${model}`
  }

  getPricing(modelName: string): ModelPricing {
    return this.findPricing(modelName) ?? this.pricingData["default"] ?? { input: 1, output: 3, cacheWrite: 0, cacheRead: 0 }
  }

  hasPricing(modelName: string): boolean {
    return this.findPricing(modelName) !== undefined
  }

  private findPricing(modelName: string): ModelPricing | undefined {
    const rawName = modelName.trim().toLowerCase()
    if (!rawName) return undefined

    if (this.pricingData[rawName]) return this.pricingData[rawName]

    const normalizedName = this.normalizeModelName(rawName)
    if (this.pricingData[normalizedName]) return this.pricingData[normalizedName]

    return this.findLongestPrefixMatch(rawName) ?? this.findLongestPrefixMatch(normalizedName)
  }

  private findLongestPrefixMatch(modelName: string): ModelPricing | undefined {
    let bestMatchLength = -1
    let bestPricing: ModelPricing | undefined

    for (const [key, pricing] of Object.entries(this.pricingData)) {
      if (modelName.startsWith(key.toLowerCase()) && key.length > bestMatchLength) {
        bestMatchLength = key.length
        bestPricing = pricing
      }
    }

    return bestPricing
  }

  private normalizeModelName(modelName: string): string {
    return modelName.includes("/") ? modelName.split("/").pop()?.trim().toLowerCase() || modelName : modelName.trim().toLowerCase()
  }
}
