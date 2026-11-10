import type { ModelPricing } from "./types.js"
import type { ModelReader, OpenCodeModel } from "./opencode.js"
import { WarningCollector, formatErrorMessage } from "./warnings.js"

export class ModelMetadataResolver {
  private pricingCache?: Record<string, ModelPricing>

  constructor(
    private models: ModelReader,
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

  private async loadLivePricing(): Promise<Record<string, ModelPricing>> {
    if (this.pricingCache) return this.pricingCache

    try {
      const response = await this.models.list()
      this.pricingCache = this.extractPricing(response.data)
    } catch (error) {
      this.warnings?.add(
        `Could not read the OpenCode model catalog. Cost estimates will use bundled pricing: ${formatErrorMessage(error)}`,
        "model-metadata"
      )
      this.pricingCache = {}
    }

    return this.pricingCache
  }

  private extractPricing(models: readonly OpenCodeModel[]): Record<string, ModelPricing> {
    const pricing: Record<string, ModelPricing> = {}

    for (const model of models) {
      const modelPricing = this.toModelPricing(model)
      if (!modelPricing) continue

      // `id` is OpenCode's catalog ID (what sessions record); `modelID` is the provider's API ID.
      for (const modelID of new Set([model.id, model.modelID])) {
        pricing[this.buildPricingKey(model.providerID, modelID)] = modelPricing
      }
    }

    return pricing
  }

  // A model's cost is a list of tiers: one base entry plus optional entries that apply above a context size.
  private toModelPricing(model: OpenCodeModel): ModelPricing | undefined {
    const base = model.cost.find((cost) => cost.tier === undefined)
    if (!base) return undefined

    const tiers = model.cost
      .flatMap((cost) =>
        cost.tier?.type === "context"
          ? [
              {
                input: cost.input,
                output: cost.output,
                cacheRead: cost.cache.read,
                cacheWrite: cost.cache.write,
                threshold: cost.tier.size,
              },
            ]
          : []
      )
      .sort((a, b) => a.threshold - b.threshold)

    return {
      input: base.input,
      output: base.output,
      cacheRead: base.cache.read,
      cacheWrite: base.cache.write,
      contextWindow: model.limit.context,
      tiers: tiers.length > 0 ? tiers : undefined,
    }
  }

  // Live rates win. The bundled catalog's tiers and legacy over-200K rates are kept only
  // when OpenCode reports no tiers of its own; live tiers take precedence when pricing a step.
  private mergeModelPricing(base: ModelPricing | undefined, live: ModelPricing): ModelPricing {
    return { ...live, tiers: live.tiers ?? base?.tiers, contextOver200k: base?.contextOver200k }
  }

  // Subscription providers report zero rates. Those would erase a known public price, so skip them.
  private canMergeLivePricing(base: ModelPricing | undefined, live: ModelPricing): boolean {
    return !(base && this.hasAnyNonZeroPricing(base) && !this.hasAnyNonZeroPricing(live))
  }

  private hasAnyNonZeroPricing(pricing: ModelPricing): boolean {
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

  private buildPricingKey(providerID: string, modelID: string): string {
    const normalizedProvider = providerID.trim().toLowerCase()
    const normalizedModel = modelID.trim().toLowerCase()
    if (normalizedModel.startsWith(`${normalizedProvider}/`)) return normalizedModel
    return `${normalizedProvider}/${normalizedModel}`
  }

  private countBareModelKeys(livePricing: Record<string, ModelPricing>): Map<string, number> {
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
