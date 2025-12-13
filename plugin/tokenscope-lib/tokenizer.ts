// TokenizerManager - handles token counting with multiple backends

import path from "path"
import fs from "fs/promises"
import { pathToFileURL } from "url"
import type { TokenModel } from "./types"
import { VENDOR_ROOT } from "./config"

export class TokenizerManager {
  private tiktokenCache = new Map<string, any>()
  private transformerCache = new Map<string, any>()
  private tiktokenModule?: Promise<any>
  private transformersModule?: Promise<any>

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
      console.error(`Token counting error for ${model.name}:`, error)
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
      encoder = encodingForModel(model)
    } catch {
      encoder = getEncoding("cl100k_base")
    }

    this.tiktokenCache.set(model, encoder)
    return encoder
  }

  private async loadTiktokenModule() {
    if (!this.tiktokenModule) {
      this.tiktokenModule = this.importFromVendor("js-tiktoken")
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
    } catch {
      this.transformerCache.set(hub, null)
      return null
    }
  }

  private async loadTransformersModule() {
    if (!this.transformersModule) {
      this.transformersModule = this.importFromVendor("@huggingface/transformers")
    }
    return this.transformersModule
  }

  private async importFromVendor(pkg: string) {
    const pkgJsonPath = path.join(VENDOR_ROOT, pkg, "package.json")
    let data: string
    try {
      data = await fs.readFile(pkgJsonPath, "utf8")
    } catch {
      throw new Error(
        `Token analyzer dependencies missing. Run the install.sh script to install vendor tokenizers.\n` +
          `Expected path: ${pkgJsonPath}`
      )
    }

    const manifest = JSON.parse(data)
    const entry = manifest.module ?? manifest.main ?? "index.js"
    const entryPath = path.join(VENDOR_ROOT, pkg, entry)
    return import(pathToFileURL(entryPath).href)
  }
}
