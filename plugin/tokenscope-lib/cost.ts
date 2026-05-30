// CostCalculator - calculates costs from token analysis

import type { TokenAnalysis, CostEstimate, ModelCostEstimate, ModelPricing, ModelTokenUsage } from "./types.js"

export class CostCalculator {
  constructor(private pricingData: Record<string, ModelPricing>) {}

  calculateCost(analysis: TokenAnalysis): CostEstimate {
    const fallbackPricingModelName = analysis.pricingModelName ?? analysis.model.name
    const perModelCosts = this.calculatePerModelCosts(analysis, fallbackPricingModelName)
    const pricing = this.getPricing(fallbackPricingModelName)
    const hasActivity =
      analysis.apiCallCount > 0 &&
      (analysis.inputTokens > 0 ||
        analysis.outputTokens > 0 ||
        analysis.reasoningTokens > 0 ||
        analysis.cacheReadTokens > 0 ||
        analysis.cacheWriteTokens > 0)
    const isSubscription = hasActivity && analysis.sessionCost === 0

    const estimatedInputCost = perModelCosts.reduce((sum, model) => sum + model.estimatedInputCost, 0)
    const estimatedOutputCost = perModelCosts.reduce((sum, model) => sum + model.estimatedOutputCost, 0)
    const estimatedCacheReadCost = perModelCosts.reduce((sum, model) => sum + model.estimatedCacheReadCost, 0)
    const estimatedCacheWriteCost = perModelCosts.reduce((sum, model) => sum + model.estimatedCacheWriteCost, 0)
    const estimatedSessionCost = perModelCosts.reduce((sum, model) => sum + model.estimatedSessionCost, 0)

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
      perModelCosts,
      unknownPricingModels: perModelCosts.filter((model) => !model.hasPricing).map((model) => model.pricingModelName),
    }
  }

  private calculatePerModelCosts(analysis: TokenAnalysis, fallbackPricingModelName: string): ModelCostEstimate[] {
    const usage = analysis.perModelUsage.length > 0 ? analysis.perModelUsage : [this.buildFallbackUsage(analysis)]

    return usage.map((modelUsage) => {
      const pricingModelName = this.resolvePricingModelName(modelUsage, fallbackPricingModelName)
      const pricing = this.getPricing(pricingModelName)
      const estimatedInputCost = (modelUsage.inputTokens / 1_000_000) * pricing.input
      const estimatedOutputCost = ((modelUsage.outputTokens + modelUsage.reasoningTokens) / 1_000_000) * pricing.output
      const estimatedCacheReadCost = (modelUsage.cacheReadTokens / 1_000_000) * pricing.cacheRead
      const estimatedCacheWriteCost = (modelUsage.cacheWriteTokens / 1_000_000) * pricing.cacheWrite

      return {
        ...modelUsage,
        pricingModelName,
        hasPricing: this.hasPricing(pricingModelName),
        estimatedSessionCost:
          estimatedInputCost + estimatedOutputCost + estimatedCacheReadCost + estimatedCacheWriteCost,
        estimatedInputCost,
        estimatedOutputCost,
        estimatedCacheReadCost,
        estimatedCacheWriteCost,
        pricePerMillionInput: pricing.input,
        pricePerMillionOutput: pricing.output,
        pricePerMillionCacheRead: pricing.cacheRead,
        pricePerMillionCacheWrite: pricing.cacheWrite,
      }
    })
  }

  resolvePricingModelName(modelUsage: ModelTokenUsage, fallbackPricingModelName: string): string {
    const providerID = modelUsage.providerID?.trim()
    const modelID = modelUsage.modelID?.trim()
    const lookupKey = this.buildLookupKey(providerID, modelID)

    if (providerID && modelID) return lookupKey
    if (lookupKey && this.hasPricing(lookupKey)) return lookupKey

    const modelName = modelUsage.modelName.trim()
    if (modelName === lookupKey) return fallbackPricingModelName
    if (modelName && modelName !== "unknown model") return modelName

    return fallbackPricingModelName
  }

  private buildFallbackUsage(analysis: TokenAnalysis): ModelTokenUsage {
    return {
      modelName: analysis.pricingModelName ?? analysis.model.name,
      inputTokens: analysis.inputTokens,
      outputTokens: analysis.outputTokens,
      reasoningTokens: analysis.reasoningTokens,
      cacheReadTokens: analysis.cacheReadTokens,
      cacheWriteTokens: analysis.cacheWriteTokens,
      apiCost: analysis.sessionCost,
      apiCallCount: analysis.apiCallCount,
      callsWithCacheRead: analysis.callsWithCacheRead,
      callsWithCacheWrite: analysis.callsWithCacheWrite,
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
