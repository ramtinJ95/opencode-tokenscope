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

type LiveModelPricing = Partial<Omit<ModelPricing, "contextOver200k">> & {
  contextOver200k?: Partial<NonNullable<ModelPricing["contextOver200k"]>>
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
      merged[modelKey] = this.mergeModelPricing(basePricing[modelKey], pricing)

      const bareModelKey = this.extractBareModelKey(modelKey)
      if (bareModelKey && liveBareKeyCounts.get(bareModelKey) === 1) {
        merged[bareModelKey] = this.mergeModelPricing(basePricing[bareModelKey], pricing)
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

        const modelID = model.id || modelKey
        const modelPricing = this.toModelPricing(model)
        if (!modelPricing) continue

        pricing[this.buildPricingKey(provider.id, modelID)] = modelPricing
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

    return {
      input,
      output,
      cacheRead,
      cacheWrite,
      contextWindow,
      contextOver200k: contextOver200k
        ? {
            input: this.safeNumber(contextOver200k.input) ?? input,
            output: this.safeNumber(contextOver200k.output) ?? output,
            cacheRead: this.safeNumber(contextOver200k.cache?.read) ?? this.safeNumber(contextOver200k.cache_read) ?? cacheRead,
            cacheWrite: this.safeNumber(contextOver200k.cache?.write) ?? this.safeNumber(contextOver200k.cache_write) ?? cacheWrite,
          }
        : undefined,
    }
  }

  private extractContextOver200k(cost: NonNullable<ProviderListModel["cost"]>) {
    if (cost.experimentalOver200K) return cost.experimentalOver200K
    if (cost.context_over_200k) return cost.context_over_200k

    return cost.tiers
      ?.filter((tier) => tier.tier?.type === "context" && this.safeNumber(tier.tier.size) !== undefined)
      .sort((a, b) => this.safeNumber(a.tier?.size)! - this.safeNumber(b.tier?.size)!)
      .find((tier) => this.safeNumber(tier.tier?.size)! >= 200_000)
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
      contextOver200k: this.mergeContextOver200k(base?.contextOver200k, live.contextOver200k, {
        input,
        output,
        cacheRead,
        cacheWrite,
      }),
    }
  }

  private mergeContextOver200k(
    base: ModelPricing["contextOver200k"],
    live: Partial<NonNullable<ModelPricing["contextOver200k"]>> | undefined,
    normalPricing: Pick<ModelPricing, "input" | "output" | "cacheRead" | "cacheWrite">
  ): ModelPricing["contextOver200k"] {
    if (!base && !live) return undefined

    return {
      input: live?.input ?? base?.input ?? normalPricing.input,
      output: live?.output ?? base?.output ?? normalPricing.output,
      cacheRead: live?.cacheRead ?? base?.cacheRead ?? normalPricing.cacheRead,
      cacheWrite: live?.cacheWrite ?? base?.cacheWrite ?? normalPricing.cacheWrite,
    }
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
