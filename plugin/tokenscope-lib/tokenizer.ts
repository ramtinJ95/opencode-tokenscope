// TokenizerManager - handles token counting with multiple backends

import type { TokenModel } from "./types.js"
import { WarningCollector, formatErrorMessage } from "./warnings.js"

const APPROXIMATE_ONLY_HUGGINGFACE_HUBS = new Set(["google/gemma-2-9b-it"])

export class TokenizerManager {
  private tiktokenCache = new Map<string, any>()
  private huggingFaceTokenizerCache = new Map<string, any>()
  private tiktokenModule?: Promise<any>
  private huggingFaceTokenizersModule?: Promise<any>

  constructor(private warnings?: WarningCollector) {}

  async countTokens(content: string, model: TokenModel): Promise<number> {
    if (!content.trim()) return 0

    try {
      switch (model.spec.kind) {
        case "approx":
          return this.approximateTokenCount(content)
        case "tiktoken":
          return await this.countWithTiktoken(content, model.spec.model)
        case "huggingface":
          return await this.countWithHuggingFaceTokenizer(content, model.spec.hub)
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
    return encoder.encode(content).length
  }

  private async countWithHuggingFaceTokenizer(content: string, hub: string): Promise<number> {
    const tokenizer = await this.loadHuggingFaceTokenizer(hub)
    if (!tokenizer || typeof tokenizer.encode !== "function") {
      return this.approximateTokenCount(content)
    }

    try {
      const encoding = await tokenizer.encode(content)
      if (!Array.isArray(encoding?.ids)) {
        throw new Error(`Tokenizer '${hub}' returned no token IDs`)
      }
      return encoding.ids.length
    } catch (error) {
      throw new Error(`Tokenizer '${hub}' could not encode content: ${formatErrorMessage(error)}`)
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
      throw new Error("js-tiktoken did not expose getEncoding")
    }

    let encoder
    try {
      encoder = typeof encodingForModel === "function" ? encodingForModel(model) : getEncoding(model)
    } catch {
      this.warnings?.add(
        `Tiktoken does not recognize model '${model}'. Local content estimates use the cl100k_base encoding instead.`,
        `tiktoken-model:${model}`
      )
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

  private async loadHuggingFaceTokenizer(hub: string) {
    if (this.huggingFaceTokenizerCache.has(hub)) {
      return this.huggingFaceTokenizerCache.get(hub)
    }

    if (APPROXIMATE_ONLY_HUGGINGFACE_HUBS.has(hub)) {
      this.warnings?.add(
        `TokenScope used approximate token counting for '${hub}' because it only loads public tokenizers directly in analysis mode.`,
        `huggingface-tokenizer-approx-only:${hub}`
      )
      this.huggingFaceTokenizerCache.set(hub, null)
      return null
    }

    try {
      const { Tokenizer } = await this.loadHuggingFaceTokenizersModule()
      const [tokenizerJson, tokenizerConfig] = await Promise.all([
        this.fetchHuggingFaceJson(hub, "tokenizer.json"),
        this.fetchHuggingFaceJson(hub, "tokenizer_config.json", true),
      ])
      const tokenizer = new Tokenizer(tokenizerJson, tokenizerConfig ?? {})
      this.huggingFaceTokenizerCache.set(hub, tokenizer)
      return tokenizer
    } catch (error) {
      this.warnings?.add(this.buildHuggingFaceFallbackWarning(hub, error), `huggingface-tokenizer-load:${hub}`)
      this.huggingFaceTokenizerCache.set(hub, null)
      return null
    }
  }

  private async loadHuggingFaceTokenizersModule() {
    if (!this.huggingFaceTokenizersModule) {
      this.huggingFaceTokenizersModule = this.importRuntimePackage("@huggingface/tokenizers")
    }
    return this.huggingFaceTokenizersModule
  }

  private async fetchHuggingFaceJson(hub: string, file: string, optional = false) {
    const response = await fetch(`https://huggingface.co/${hub}/raw/main/${file}`, {
      headers: this.getHuggingFaceHeaders(),
    })

    if (!response.ok) {
      if (optional && response.status === 404) {
        return null
      }

      throw new Error(`Failed to fetch ${file} for '${hub}' (HTTP ${response.status})`)
    }

    return response.json()
  }

  private getHuggingFaceHeaders() {
    const token = process.env.HF_TOKEN ?? process.env.HUGGING_FACE_HUB_TOKEN ?? process.env.HUGGINGFACE_TOKEN
    return token ? { Authorization: `Bearer ${token}` } : undefined
  }

  private buildHuggingFaceFallbackWarning(hub: string, error: unknown) {
    const message = formatErrorMessage(error)
    if (message.includes("Token analyzer dependency '@huggingface/tokenizers' could not be loaded")) {
      return `TokenScope used approximate token counting for '${hub}' because the lightweight tokenizer runtime was unavailable.`
    }

    return `TokenScope used approximate token counting for '${hub}' because an exact public tokenizer could not be loaded.`
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
