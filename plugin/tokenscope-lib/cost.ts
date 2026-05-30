// CostCalculator - calculates costs from token analysis

import type {
  TokenAnalysis,
  CostEstimate,
  ModelCostEstimate,
  ModelPricing,
  ModelTokenUsage,
  ModelTokenUsageCall,
} from "./types.js"

type PricingRates = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

type CostComponents = {
  uncachedInput: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
  rates: PricingRates
  usesTieredPricing: boolean
}

const DEFAULT_PRICING: ModelPricing = { input: 1, output: 3, cacheWrite: 0, cacheRead: 0 }

export class CostCalculator {
  constructor(private pricingData: Record<string, ModelPricing>) {}

  calculateCost(analysis: TokenAnalysis): CostEstimate {
    const fallbackPricingModelName = analysis.pricingModelName ?? analysis.model.name
    const perModelCosts = this.calculatePerModelCosts(analysis, fallbackPricingModelName)
    const pricing = this.getPricing(fallbackPricingModelName)
    const defaultRates = this.selectPricingRates(pricing, analysis.inputTokens + analysis.cacheReadTokens + analysis.cacheWriteTokens)
    const hasActivity =
      analysis.inputTokens > 0 ||
      analysis.outputTokens > 0 ||
      analysis.reasoningTokens > 0 ||
      analysis.cacheReadTokens > 0 ||
      analysis.cacheWriteTokens > 0
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
      pricePerMillionInput: defaultRates.input,
      pricePerMillionOutput: defaultRates.output,
      pricePerMillionCacheRead: defaultRates.cacheRead,
      pricePerMillionCacheWrite: defaultRates.cacheWrite,
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
    const usage = this.buildEstimateUsage(analysis, fallbackPricingModelName)

    return usage.map((modelUsage) => {
      const pricingModelName = this.resolvePricingModelName(modelUsage, fallbackPricingModelName)
      const components = this.calculateModelUsageComponents(modelUsage, pricingModelName)

      return {
        ...modelUsage,
        pricingModelName,
        hasPricing: this.hasPricing(pricingModelName),
        usesTieredPricing: components.usesTieredPricing,
        estimatedSessionCost: components.total,
        estimatedUncachedInputCost: components.uncachedInput,
        estimatedInputCost: components.input,
        estimatedOutputCost: components.output,
        estimatedCacheReadCost: components.cacheRead,
        estimatedCacheWriteCost: components.cacheWrite,
        pricePerMillionInput: components.rates.input,
        pricePerMillionOutput: components.rates.output,
        pricePerMillionCacheRead: components.rates.cacheRead,
        pricePerMillionCacheWrite: components.rates.cacheWrite,
      }
    })
  }

  private buildEstimateUsage(analysis: TokenAnalysis, fallbackPricingModelName: string): ModelTokenUsage[] {
    if (analysis.perModelUsage.length === 0) return [this.buildFallbackUsage(analysis)]

    const totals = this.sumUsage(analysis.perModelUsage)
    const delta = {
      inputTokens: this.positiveDelta(analysis.inputTokens, totals.inputTokens),
      outputTokens: this.positiveDelta(analysis.outputTokens, totals.outputTokens),
      reasoningTokens: this.positiveDelta(analysis.reasoningTokens, totals.reasoningTokens),
      cacheReadTokens: this.positiveDelta(analysis.cacheReadTokens, totals.cacheReadTokens),
      cacheWriteTokens: this.positiveDelta(analysis.cacheWriteTokens, totals.cacheWriteTokens),
    }

    if (this.totalTokens(delta) === 0) return analysis.perModelUsage

    return [
      ...analysis.perModelUsage,
      {
        modelName: fallbackPricingModelName,
        ...delta,
        apiCost: 0,
        apiCallCount: 0,
        callsWithCacheRead: delta.cacheReadTokens > 0 ? 1 : 0,
        callsWithCacheWrite: delta.cacheWriteTokens > 0 ? 1 : 0,
      },
    ]
  }

  calculateModelUsageCost(modelUsage: ModelTokenUsage, fallbackPricingModelName: string): number {
    const pricingModelName = this.resolvePricingModelName(modelUsage, fallbackPricingModelName)
    return this.calculateModelUsageComponents(modelUsage, pricingModelName).total
  }

  private calculateModelUsageComponents(modelUsage: ModelTokenUsage, pricingModelName: string): CostComponents {
    const pricing = this.getPricing(pricingModelName)
    const hasKnownPerCallContext = Boolean(modelUsage.calls?.length)
    const calls = hasKnownPerCallContext ? modelUsage.calls! : [this.asUsageCall(modelUsage)]
    let input = 0
    let uncachedInput = 0
    let output = 0
    let cacheRead = 0
    let cacheWrite = 0
    let usesTieredPricing = false
    let displayRates = hasKnownPerCallContext
      ? this.selectPricingRates(pricing, this.rawContextTokens(this.asUsageCall(modelUsage)))
      : this.baseRates(pricing)

    for (const call of calls) {
      const rawContextTokens = this.rawContextTokens(call)
      const rates = hasKnownPerCallContext ? this.selectPricingRates(pricing, rawContextTokens) : this.baseRates(pricing)
      uncachedInput += (rawContextTokens / 1_000_000) * rates.input
      input += (call.inputTokens / 1_000_000) * rates.input
      output += ((call.outputTokens + call.reasoningTokens) / 1_000_000) * rates.output
      cacheRead += (call.cacheReadTokens / 1_000_000) * rates.cacheRead
      cacheWrite += (call.cacheWriteTokens / 1_000_000) * rates.cacheWrite
      usesTieredPricing ||= hasKnownPerCallContext && this.usesNonBasePricing(pricing, rawContextTokens)
      displayRates = rates
    }

    return {
      uncachedInput: this.safeCost(uncachedInput),
      input: this.safeCost(input),
      output: this.safeCost(output),
      cacheRead: this.safeCost(cacheRead),
      cacheWrite: this.safeCost(cacheWrite),
      total: this.safeCost(input + output + cacheRead + cacheWrite),
      rates: displayRates,
      usesTieredPricing,
    }
  }

  private asUsageCall(usage: ModelTokenUsage): ModelTokenUsageCall {
    return {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
    }
  }

  private rawContextTokens(usage: ModelTokenUsageCall): number {
    return usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
  }

  private sumUsage(usages: ModelTokenUsage[]): ModelTokenUsageCall {
    return usages.reduce(
      (sum, usage) => ({
        inputTokens: sum.inputTokens + usage.inputTokens,
        outputTokens: sum.outputTokens + usage.outputTokens,
        reasoningTokens: sum.reasoningTokens + usage.reasoningTokens,
        cacheReadTokens: sum.cacheReadTokens + usage.cacheReadTokens,
        cacheWriteTokens: sum.cacheWriteTokens + usage.cacheWriteTokens,
      }),
      { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
    )
  }

  private positiveDelta(total: number, subtotal: number): number {
    return Math.max(0, total - subtotal)
  }

  private totalTokens(usage: ModelTokenUsageCall): number {
    return usage.inputTokens + usage.outputTokens + usage.reasoningTokens + usage.cacheReadTokens + usage.cacheWriteTokens
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
    return this.findPricing(modelName) ?? this.pricingData["default"] ?? DEFAULT_PRICING
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

  private selectPricingRates(pricing: ModelPricing, rawContextTokens: number): PricingRates {
    const contextTier = pricing.tiers
      ?.filter((item) => item.tier.type === "context" && rawContextTokens > item.tier.size)
      .sort((a, b) => b.tier.size - a.tier.size)[0]

    if (contextTier) return this.ratesFromAny(contextTier)

    const over200k = pricing.experimentalOver200K ?? pricing.context_over_200k
    if (over200k && rawContextTokens > 200_000) {
      return this.ratesFromAny(over200k)
    }

    return this.baseRates(pricing)
  }

  private usesNonBasePricing(pricing: ModelPricing, rawContextTokens: number): boolean {
    const hasContextTier = pricing.tiers?.some((item) => item.tier.type === "context" && rawContextTokens > item.tier.size)
    const hasOver200k = Boolean((pricing.experimentalOver200K ?? pricing.context_over_200k) && rawContextTokens > 200_000)
    return Boolean(hasContextTier || (!hasContextTier && hasOver200k))
  }

  private baseRates(pricing: ModelPricing): PricingRates {
    return {
      input: this.safeRate(pricing.input),
      output: this.safeRate(pricing.output),
      cacheRead: this.safeRate(pricing.cache?.read ?? pricing.cacheRead ?? pricing.cache_read),
      cacheWrite: this.safeRate(pricing.cache?.write ?? pricing.cacheWrite ?? pricing.cache_write),
    }
  }

  private ratesFromAny(pricing: {
    input: number
    output: number
    cache?: { read?: number; write?: number }
    cache_read?: number
    cache_write?: number
    cacheRead?: number
    cacheWrite?: number
  }): PricingRates {
    return {
      input: this.safeRate(pricing.input),
      output: this.safeRate(pricing.output),
      cacheRead: this.safeRate(pricing.cache?.read ?? pricing.cacheRead ?? pricing.cache_read),
      cacheWrite: this.safeRate(pricing.cache?.write ?? pricing.cacheWrite ?? pricing.cache_write),
    }
  }

  private safeRate(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0
  }

  private safeCost(value: number): number {
    return Number.isFinite(value) ? Math.max(0, value) : 0
  }
}
