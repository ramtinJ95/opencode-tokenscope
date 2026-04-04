// TokenizerManager - handles token counting with multiple backends

import type { TokenModel } from "./types"
import { WarningCollector, formatErrorMessage } from "./warnings"

export class TokenizerManager {
  private tiktokenCache = new Map<string, any>()
  private transformerCache = new Map<string, any>()
  private tiktokenModule?: Promise<any>
  private transformersModule?: Promise<any>

  constructor(private warnings?: WarningCollector) {}

  async countTokens(content: string, model: TokenModel): Promise<number> {
    if (!content.trim()) return 0

    try {
      switch (model.spec.kind) {
        case "approx":
          return this.approximateTokenCount(content)
        case "tiktoken":
          return await this.countWithTiktoken(content, model.spec.model)
        case "transformers":
          return await this.countWithTransformers(content, model.spec.hub)
      }
    } catch (error) {
      this.warnings?.add(
        `Token counting fell back to approximate mode for model '${model.name}': ${formatErrorMessage(error)}`,
        `token-count:${model.name}`
      )
      return this.approximateTokenCount(content)
    }
  }

  private approximateTokenCount(content: string): number {
    return Math.ceil(content.length / 4)
  }

  private async countWithTiktoken(content: string, model: string): Promise<number> {
    const encoder = await this.loadTiktokenEncoder(model)
    try {
      return encoder.encode(content).length
    } catch {
      return this.approximateTokenCount(content)
    }
  }

  private async countWithTransformers(content: string, hub: string): Promise<number> {
    const tokenizer = await this.loadTransformersTokenizer(hub)
    if (!tokenizer || typeof tokenizer.encode !== "function") {
      return this.approximateTokenCount(content)
    }

    try {
      const encoding = await tokenizer.encode(content)
      return Array.isArray(encoding) ? encoding.length : (encoding?.length ?? this.approximateTokenCount(content))
    } catch {
      return this.approximateTokenCount(content)
    }
  }

  private async loadTiktokenEncoder(model: string) {
    if (this.tiktokenCache.has(model)) {
      return this.tiktokenCache.get(model)
    }

    const mod = await this.loadTiktokenModule()
    const encodingForModel = mod.encodingForModel ?? mod.default?.encodingForModel
    const getEncoding = mod.getEncoding ?? mod.default?.getEncoding

    if (typeof getEncoding !== "function") {
      return { encode: (text: string) => ({ length: Math.ceil(text.length / 4) }) }
    }

    let encoder
    try {
      encoder = typeof encodingForModel === "function" ? encodingForModel(model) : getEncoding(model)
    } catch {
      encoder = getEncoding("cl100k_base")
    }

    this.tiktokenCache.set(model, encoder)
    return encoder
  }

  private async loadTiktokenModule() {
    if (!this.tiktokenModule) {
      this.tiktokenModule = this.importRuntimePackage("js-tiktoken")
    }
    return this.tiktokenModule
  }

  private async loadTransformersTokenizer(hub: string) {
    if (this.transformerCache.has(hub)) {
      return this.transformerCache.get(hub)
    }

    try {
      const { AutoTokenizer } = await this.loadTransformersModule()
      const tokenizer = await AutoTokenizer.from_pretrained(hub)
      this.transformerCache.set(hub, tokenizer)
      return tokenizer
    } catch (error) {
      this.warnings?.add(
        `Could not load the tokenizer '${hub}'. Transformer-based counts will use the approximate fallback instead: ${formatErrorMessage(error)}`,
        `transformer-load:${hub}`
      )
      this.transformerCache.set(hub, null)
      return null
    }
  }

  private async loadTransformersModule() {
    if (!this.transformersModule) {
      this.transformersModule = this.importRuntimePackage("@huggingface/transformers")
    }
    return this.transformersModule
  }

  private async importRuntimePackage(pkg: string) {
    try {
      return await import(pkg)
    } catch (error) {
      throw new Error(
        `Token analyzer dependency '${pkg}' could not be loaded. ` +
          `Reinstall the npm package or rerun plugin/install.sh. ${formatErrorMessage(error)}`
      )
    }
  }
}
