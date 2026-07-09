import type { ModelPricing } from "./types.js"
import { fetchProviderList, type RoutingParams, unwrapResponseData } from "./opencode.js"
import { WarningCollector, formatErrorMessage } from "./warnings.js"

interface ProviderListModel {
  id?: string
  name?: string
  cost?: {
    input?: number
    output?: number
    cache?: {
      read?: number
      write?: number
    }
    cache_read?: number
    cache_write?: number
    tiers?: Array<{
      input?: number
      output?: number
      cache?: {
        read?: number
        write?: number
      }
      cache_read?: number
      cache_write?: number
      tier?: {
        type?: string
        size?: number
      }
    }>
    experimentalOver200K?: {
      input?: number
      output?: number
      cache?: {
        read?: number
        write?: number
      }
      cache_read?: number
      cache_write?: number
    }
    context_over_200k?: {
      input?: number
      output?: number
      cache?: {
        read?: number
        write?: number
      }
      cache_read?: number
      cache_write?: number
    }
  }
  limit?: {
    context?: number
    output?: number
  }
}

interface ProviderListProvider {
  id?: string
  models?: Record<string, ProviderListModel>
}

interface ProviderListData {
  all?: ProviderListProvider[]
}

type ProviderContextCost = {
  input?: number
  output?: number
  cache?: {
    read?: number
    write?: number
  }
  cache_read?: number
  cache_write?: number
  threshold?: number
}

type ProviderTierCost = ProviderContextCost & { threshold: number }

type LiveModelPricing = Partial<Omit<ModelPricing, "contextOver200k" | "tiers">> & {
  contextOver200k?: Partial<NonNullable<ModelPricing["contextOver200k"]>>
  tiers?: NonNullable<ModelPricing["tiers"]>
}

type PricingLike = {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  contextOver200k?: {
    input?: number
    output?: number
    cacheRead?: number
    cacheWrite?: number
  }
  tiers?: Array<{
    input?: number
    output?: number
    cacheRead?: number
    cacheWrite?: number
    threshold: number
  }>
}

export class ModelMetadataResolver {
  private pricingCache?: Record<string, LiveModelPricing>

  constructor(
    private client: any,
    private routing: RoutingParams = {},
    private warnings?: WarningCollector
  ) {}

  async mergePricingData(basePricing: Record<string, ModelPricing>): Promise<Record<string, ModelPricing>> {
    const livePricing = await this.loadLivePricing()
    if (Object.keys(livePricing).length === 0) return basePricing

    const merged = { ...basePricing }
    const liveBareKeyCounts = this.countBareModelKeys(livePricing)
    for (const [modelKey, pricing] of Object.entries(livePricing)) {
      const bareModelKey = this.extractBareModelKey(modelKey)
      const bundledPricing = basePricing[modelKey] ?? (bareModelKey ? basePricing[bareModelKey] : undefined)
      if (!this.canMergeLivePricing(bundledPricing, pricing)) continue

      merged[modelKey] = this.mergeModelPricing(bundledPricing, pricing)

      if (bareModelKey && liveBareKeyCounts.get(bareModelKey) === 1) {
        const bareAliasPricing = basePricing[bareModelKey] ?? bundledPricing
        if (this.canMergeLivePricing(bareAliasPricing, pricing)) {
          merged[bareModelKey] = this.mergeModelPricing(bareAliasPricing, pricing)
        }
      }
    }
    return merged
  }

  private async loadLivePricing(): Promise<Record<string, LiveModelPricing>> {
    if (this.pricingCache) return this.pricingCache

    try {
      const response = await fetchProviderList(this.client, this.routing)
      const data = unwrapResponseData<ProviderListData>(response ?? {})
      this.pricingCache = this.extractPricing(data)
    } catch (error) {
      this.warnings?.add(
        `Could not fetch live OpenCode provider metadata. Cost estimates will use bundled pricing: ${formatErrorMessage(error)}`,
        "provider-metadata"
      )
      this.pricingCache = {}
    }

    return this.pricingCache
  }

  private extractPricing(data: ProviderListData): Record<string, LiveModelPricing> {
    const pricing: Record<string, LiveModelPricing> = {}

    for (const provider of data.all ?? []) {
      if (!provider.id || !provider.models) continue

      for (const [modelKey, model] of Object.entries(provider.models)) {
        if (!model.cost) continue

        const modelPricing = this.toModelPricing(model)
        if (!modelPricing) continue

        for (const modelID of new Set([model.id, modelKey].filter(Boolean))) {
          pricing[this.buildPricingKey(provider.id, modelID!)] = modelPricing
        }
      }
    }

    return pricing
  }

  private toModelPricing(model: ProviderListModel): LiveModelPricing | undefined {
    if (!model.cost) return undefined

    const input = this.safeNumber(model.cost.input)
    const output = this.safeNumber(model.cost.output)
    const cacheRead = this.safeNumber(model.cost.cache?.read) ?? this.safeNumber(model.cost.cache_read)
    const cacheWrite = this.safeNumber(model.cost.cache?.write) ?? this.safeNumber(model.cost.cache_write)
    const contextWindow = this.safeNumber(model.limit?.context)
    const contextOver200k = this.extractContextOver200k(model.cost)
    const tiers = this.extractTiers(model.cost)

    return {
      input,
      output,
      cacheRead,
      cacheWrite,
      contextWindow,
      tiers: tiers.length > 0 ? tiers.map((tier) => this.toTierPricing(tier, input, output)) : undefined,
      contextOver200k: contextOver200k ? this.toContextPricing(contextOver200k, input, output) : undefined,
    }
  }

  private extractContextOver200k(cost: NonNullable<ProviderListModel["cost"]>): ProviderContextCost | undefined {
    if (cost.experimentalOver200K) return { ...cost.experimentalOver200K }
    if (cost.context_over_200k) return { ...cost.context_over_200k }
    return undefined
  }

  private extractTiers(cost: NonNullable<ProviderListModel["cost"]>): ProviderTierCost[] {
    return (cost.tiers ?? [])
      .flatMap((tier) => {
        if (tier.tier?.type !== "context") return []
        const threshold = this.safeNumber(tier.tier.size)
        if (threshold === undefined) return []
        return [{ ...tier, threshold }]
      })
      .sort((a, b) => a.threshold - b.threshold)
  }

  private toTierPricing(
    tier: ProviderTierCost,
    input: number | undefined,
    output: number | undefined
  ): NonNullable<ModelPricing["tiers"]>[number] {
    return {
      input: this.safeNumber(tier.input) ?? input ?? 0,
      output: this.safeNumber(tier.output) ?? output ?? 0,
      // OpenCode maps omitted tier cache rates to zero rather than inheriting
      // the model's base cache prices.
      cacheRead: this.safeNumber(tier.cache?.read) ?? this.safeNumber(tier.cache_read) ?? 0,
      cacheWrite: this.safeNumber(tier.cache?.write) ?? this.safeNumber(tier.cache_write) ?? 0,
      threshold: tier.threshold,
    }
  }

  private toContextPricing(
    contextCost: ProviderContextCost,
    input: number | undefined,
    output: number | undefined
  ): Partial<NonNullable<ModelPricing["contextOver200k"]>> {
    const pricing: Partial<NonNullable<ModelPricing["contextOver200k"]>> = {
      input: this.safeNumber(contextCost.input) ?? input,
      output: this.safeNumber(contextCost.output) ?? output,
      cacheRead: this.safeNumber(contextCost.cache?.read) ?? this.safeNumber(contextCost.cache_read) ?? 0,
      cacheWrite: this.safeNumber(contextCost.cache?.write) ?? this.safeNumber(contextCost.cache_write) ?? 0,
    }

    const threshold = this.safeNumber(contextCost.threshold)
    if (threshold !== undefined && threshold !== 200_000) pricing.threshold = threshold
    return pricing
  }

  private mergeModelPricing(base: ModelPricing | undefined, live: LiveModelPricing): ModelPricing {
    const input = live.input ?? base?.input ?? 1
    const output = live.output ?? base?.output ?? 3
    const cacheRead = live.cacheRead ?? base?.cacheRead ?? 0
    const cacheWrite = live.cacheWrite ?? base?.cacheWrite ?? 0

    return {
      input,
      output,
      cacheRead,
      cacheWrite,
      contextWindow: live.contextWindow ?? base?.contextWindow,
      tiers: live.tiers ?? base?.tiers,
      contextOver200k: this.mergeContextOver200k(base?.contextOver200k, live.contextOver200k, {
        input,
        output,
        cacheRead,
        cacheWrite,
      }),
    }
  }

  private canMergeLivePricing(base: ModelPricing | undefined, live: LiveModelPricing): boolean {
    if (base && this.hasAnyNonZeroPricing(base) && !this.hasAnyNonZeroPricing(live)) return false
    return !!base || (live.input !== undefined && live.output !== undefined)
  }

  private hasAnyNonZeroPricing(pricing: PricingLike | undefined): boolean {
    if (!pricing) return false

    return [
      pricing.input,
      pricing.output,
      pricing.cacheRead,
      pricing.cacheWrite,
      ...(pricing.tiers ?? []).flatMap((tier) => [tier.input, tier.output, tier.cacheRead, tier.cacheWrite]),
      pricing.contextOver200k?.input,
      pricing.contextOver200k?.output,
      pricing.contextOver200k?.cacheRead,
      pricing.contextOver200k?.cacheWrite,
    ].some((value) => value !== undefined && value !== 0)
  }

  private mergeContextOver200k(
    base: ModelPricing["contextOver200k"],
    live: Partial<NonNullable<ModelPricing["contextOver200k"]>> | undefined,
    normalPricing: Pick<ModelPricing, "input" | "output" | "cacheRead" | "cacheWrite">
  ): ModelPricing["contextOver200k"] {
    if (!base && !live) return undefined

    const merged: NonNullable<ModelPricing["contextOver200k"]> = {
      input: live?.input ?? base?.input ?? normalPricing.input,
      output: live?.output ?? base?.output ?? normalPricing.output,
      cacheRead: live?.cacheRead ?? base?.cacheRead ?? normalPricing.cacheRead,
      cacheWrite: live?.cacheWrite ?? base?.cacheWrite ?? normalPricing.cacheWrite,
    }
    const threshold = live?.threshold ?? base?.threshold
    if (threshold !== undefined) merged.threshold = threshold
    return merged
  }

  private safeNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined
  }

  private buildPricingKey(providerID: string, modelID: string): string {
    const normalizedProvider = providerID.trim().toLowerCase()
    const normalizedModel = modelID.trim().toLowerCase()
    if (normalizedModel.startsWith(`${normalizedProvider}/`)) return normalizedModel
    return `${normalizedProvider}/${normalizedModel}`
  }

  private countBareModelKeys(livePricing: Record<string, LiveModelPricing>): Map<string, number> {
    const counts = new Map<string, number>()
    for (const modelKey of Object.keys(livePricing)) {
      const bareModelKey = this.extractBareModelKey(modelKey)
      if (!bareModelKey) continue
      counts.set(bareModelKey, (counts.get(bareModelKey) ?? 0) + 1)
    }
    return counts
  }

  private extractBareModelKey(modelKey: string): string | undefined {
    const slashIndex = modelKey.indexOf("/")
    const bareModelKey = (slashIndex === -1 ? modelKey : modelKey.slice(slashIndex + 1)).trim()
    return bareModelKey || undefined
  }
}
