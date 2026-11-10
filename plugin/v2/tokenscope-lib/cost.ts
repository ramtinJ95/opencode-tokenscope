// CostCalculator - calculates costs from token analysis

import type {
  TokenAnalysis,
  CostEstimate,
  ModelCostEstimate,
  ModelPricing,
  ModelTokenUsage,
  ModelTokenUsageSegment,
  PricingTier,
  TokenCostBreakdown,
} from "./types.js"

type PriceableTokenUsage = Pick<
  ModelTokenUsage | ModelTokenUsageSegment,
  "inputTokens" | "outputTokens" | "reasoningTokens" | "cacheReadTokens" | "cacheWriteTokens"
>

type SelectedPricingRate = {
  rate: ModelPricing
  threshold?: number
}

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
    const usesEstimatedCost = hasActivity && analysis.sessionCost === 0

    const estimatedInputCost = perModelCosts.reduce((sum, model) => sum + model.estimatedInputCost, 0)
    const estimatedOutputCost = perModelCosts.reduce((sum, model) => sum + model.estimatedOutputCost, 0)
    const estimatedCacheReadCost = perModelCosts.reduce((sum, model) => sum + model.estimatedCacheReadCost, 0)
    const estimatedCacheWriteCost = perModelCosts.reduce((sum, model) => sum + model.estimatedCacheWriteCost, 0)
    const estimatedSessionCost = perModelCosts.reduce((sum, model) => sum + model.estimatedSessionCost, 0)

    return {
      usesEstimatedCost,
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
      const usageCost = this.calculateModelUsageCost(modelUsage, pricing)

      return {
        ...modelUsage,
        pricingModelName,
        hasPricing: this.hasPricing(pricingModelName),
        ...usageCost,
      }
    })
  }

  calculateUsageCost(modelUsage: PriceableTokenUsage, pricing: ModelPricing): TokenCostBreakdown {
    return this.calculateUsageCostForRate(modelUsage, this.selectPricingRate(modelUsage, pricing), pricing)
  }

  calculateModelUsageCost(modelUsage: ModelTokenUsage, pricing: ModelPricing): TokenCostBreakdown {
    if (!modelUsage.costSegments || modelUsage.costSegments.length === 0) {
      return this.calculateUsageCost(modelUsage, pricing)
    }

    const segmentCosts = modelUsage.costSegments.map((segment) => this.calculateUsageCost(segment, pricing))
    const firstTier = segmentCosts[0]?.pricingTier
    const firstThreshold = segmentCosts[0]?.pricingTierThreshold
    const hasOneTier = segmentCosts.every(
      (segment) => segment.pricingTier === firstTier && segment.pricingTierThreshold === firstThreshold
    )
    const pricingTier: PricingTier | undefined = hasOneTier ? firstTier : "mixed_context_tiers"
    const summedCosts = this.sumCostBreakdowns(segmentCosts)
    const lastSegmentCost = segmentCosts[segmentCosts.length - 1]
    const mixedRate = (tokens: number, cost: number, fallback: number) =>
      pricingTier === "mixed_context_tiers" && tokens > 0 ? (cost / tokens) * 1_000_000 : fallback

    return {
      ...summedCosts,
      pricePerMillionInput: mixedRate(modelUsage.inputTokens, summedCosts.estimatedInputCost, lastSegmentCost?.pricePerMillionInput ?? pricing.input),
      pricePerMillionOutput: mixedRate(
        modelUsage.outputTokens + modelUsage.reasoningTokens,
        summedCosts.estimatedOutputCost,
        lastSegmentCost?.pricePerMillionOutput ?? pricing.output
      ),
      pricePerMillionCacheRead: mixedRate(
        modelUsage.cacheReadTokens,
        summedCosts.estimatedCacheReadCost,
        lastSegmentCost?.pricePerMillionCacheRead ?? pricing.cacheRead
      ),
      pricePerMillionCacheWrite: mixedRate(
        modelUsage.cacheWriteTokens,
        summedCosts.estimatedCacheWriteCost,
        lastSegmentCost?.pricePerMillionCacheWrite ?? pricing.cacheWrite
      ),
      pricingTier,
      pricingTierThreshold: hasOneTier ? firstThreshold : undefined,
    }
  }

  private sumCostBreakdowns(costs: TokenCostBreakdown[]) {
    const estimatedInputCost = costs.reduce((sum, cost) => sum + cost.estimatedInputCost, 0)
    const estimatedOutputCost = costs.reduce((sum, cost) => sum + cost.estimatedOutputCost, 0)
    const estimatedCacheReadCost = costs.reduce((sum, cost) => sum + cost.estimatedCacheReadCost, 0)
    const estimatedCacheWriteCost = costs.reduce((sum, cost) => sum + cost.estimatedCacheWriteCost, 0)

    return {
      estimatedSessionCost: estimatedInputCost + estimatedOutputCost + estimatedCacheReadCost + estimatedCacheWriteCost,
      estimatedInputCost,
      estimatedOutputCost,
      estimatedCacheReadCost,
      estimatedCacheWriteCost,
      estimatedInputCostWithoutCaching: costs.reduce((sum, cost) => sum + cost.estimatedInputCostWithoutCaching, 0),
    }
  }

  private calculateUsageCostForRate(
    modelUsage: PriceableTokenUsage,
    selected: SelectedPricingRate,
    basePricing: ModelPricing
  ): TokenCostBreakdown {
    const rate = selected.rate
    const estimatedInputCost = (modelUsage.inputTokens / 1_000_000) * rate.input
    const estimatedOutputCost = ((modelUsage.outputTokens + modelUsage.reasoningTokens) / 1_000_000) * rate.output
    const estimatedCacheReadCost = (modelUsage.cacheReadTokens / 1_000_000) * rate.cacheRead
    const estimatedCacheWriteCost = (modelUsage.cacheWriteTokens / 1_000_000) * rate.cacheWrite

    return {
      estimatedSessionCost: estimatedInputCost + estimatedOutputCost + estimatedCacheReadCost + estimatedCacheWriteCost,
      estimatedInputCost,
      estimatedOutputCost,
      estimatedCacheReadCost,
      estimatedCacheWriteCost,
      estimatedInputCostWithoutCaching: this.calculateUncachedInputCost(modelUsage, basePricing),
      pricePerMillionInput: rate.input,
      pricePerMillionOutput: rate.output,
      pricePerMillionCacheRead: rate.cacheRead,
      pricePerMillionCacheWrite: rate.cacheWrite,
      pricingTier: selected.threshold === undefined ? undefined : "context_tier",
      pricingTierThreshold: selected.threshold,
    }
  }

  private calculateUncachedInputCost(modelUsage: PriceableTokenUsage, pricing: ModelPricing): number {
    const inputIfUncached = modelUsage.inputTokens + modelUsage.cacheReadTokens + modelUsage.cacheWriteTokens
    const uncachedUsage = {
      inputTokens: inputIfUncached,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    }
    const rate = this.selectPricingRate(uncachedUsage, pricing).rate
    return (inputIfUncached / 1_000_000) * rate.input
  }

  private selectPricingRate(modelUsage: PriceableTokenUsage, pricing: ModelPricing): SelectedPricingRate {
    const contextTokens = modelUsage.inputTokens + modelUsage.cacheReadTokens + modelUsage.cacheWriteTokens
    const tier = pricing.tiers
      ?.filter((item) => contextTokens > item.threshold)
      .sort((a, b) => b.threshold - a.threshold)[0]
    if (tier) return { rate: tier, threshold: tier.threshold }

    const fallbackThreshold = pricing.contextOver200k?.threshold ?? 200_000
    if (pricing.contextOver200k && contextTokens > fallbackThreshold) {
      return { rate: pricing.contextOver200k, threshold: fallbackThreshold }
    }

    return { rate: pricing }
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
      const normalizedKey = key.toLowerCase()
      const suffix = modelName.slice(normalizedKey.length)
      const isVersionedPrefix = modelName.startsWith(normalizedKey) && /^[-.:/@_]/.test(suffix)
      if (isVersionedPrefix && key.length > bestMatchLength) {
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
