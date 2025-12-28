// Configuration constants, model maps, and pricing loader

import path from "path"
import fs from "fs/promises"
import { fileURLToPath } from "url"
import type { TokenizerSpec, ModelPricing, TokenscopeConfig } from "./types"

export const DEFAULT_ENTRY_LIMIT = 3
export const VENDOR_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "vendor", "node_modules")

// Pricing cache
let PRICING_CACHE: Record<string, ModelPricing> | null = null

export async function loadModelPricing(): Promise<Record<string, ModelPricing>> {
  if (PRICING_CACHE) return PRICING_CACHE

  try {
    const modelsPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "models.json")
    const data = await fs.readFile(modelsPath, "utf8")
    PRICING_CACHE = JSON.parse(data)
    return PRICING_CACHE!
  } catch {
    PRICING_CACHE = { default: { input: 1, output: 3, cacheWrite: 0, cacheRead: 0 } }
    return PRICING_CACHE
  }
}

// Tokenscope config defaults and loader

export const DEFAULT_TOKENSCOPE_CONFIG: TokenscopeConfig = {
  enableContextBreakdown: true,
  enableToolSchemaEstimation: true,
  enableCacheEfficiency: true,
  enableSubagentAnalysis: true,
  enableSkillAnalysis: true,
}

let TOKENSCOPE_CONFIG_CACHE: TokenscopeConfig | null = null

export async function loadTokenscopeConfig(): Promise<TokenscopeConfig> {
  if (TOKENSCOPE_CONFIG_CACHE) return TOKENSCOPE_CONFIG_CACHE

  try {
    const configPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tokenscope-config.json")
    const data = await fs.readFile(configPath, "utf8")
    const config = { ...DEFAULT_TOKENSCOPE_CONFIG, ...JSON.parse(data) }
    TOKENSCOPE_CONFIG_CACHE = config
    return config
  } catch {
    TOKENSCOPE_CONFIG_CACHE = DEFAULT_TOKENSCOPE_CONFIG
    return DEFAULT_TOKENSCOPE_CONFIG
  }
}

// OpenAI model mapping for tiktoken
export const OPENAI_MODEL_MAP: Record<string, string> = {
  "gpt-5": "gpt-4o",
  "o4-mini": "gpt-4o",
  "o3": "gpt-4o",
  "o3-mini": "gpt-4o",
  "o1": "gpt-4o",
  "o1-pro": "gpt-4o",
  "gpt-4.1": "gpt-4o",
  "gpt-4.1-mini": "gpt-4o",
  "gpt-4o": "gpt-4o",
  "gpt-4o-mini": "gpt-4o-mini",
  "gpt-4-turbo": "gpt-4",
  "gpt-4": "gpt-4",
  "gpt-3.5-turbo": "gpt-3.5-turbo",
  "text-embedding-3-large": "text-embedding-3-large",
  "text-embedding-3-small": "text-embedding-3-small",
  "text-embedding-ada-002": "text-embedding-ada-002",
}

// Transformers model mapping for HuggingFace tokenizers
export const TRANSFORMERS_MODEL_MAP: Record<string, string> = {
  "claude-opus-4": "Xenova/claude-tokenizer",
  "claude-sonnet-4": "Xenova/claude-tokenizer",
  "claude-3.7-sonnet": "Xenova/claude-tokenizer",
  "claude-3.5-sonnet": "Xenova/claude-tokenizer",
  "claude-3.5-haiku": "Xenova/claude-tokenizer",
  "claude-3-opus": "Xenova/claude-tokenizer",
  "claude-3-sonnet": "Xenova/claude-tokenizer",
  "claude-3-haiku": "Xenova/claude-tokenizer",
  "claude-2.1": "Xenova/claude-tokenizer",
  "claude-2.0": "Xenova/claude-tokenizer",
  "claude-instant-1.2": "Xenova/claude-tokenizer",
  "llama-4": "Xenova/llama4-tokenizer",
  "llama-3.3": "unsloth/Llama-3.3-70B-Instruct",
  "llama-3.2": "Xenova/Llama-3.2-Tokenizer",
  "llama-3.1": "Xenova/Meta-Llama-3.1-Tokenizer",
  "llama-3": "Xenova/llama3-tokenizer-new",
  "llama-2": "Xenova/llama2-tokenizer",
  "code-llama": "Xenova/llama-code-tokenizer",
  "deepseek-r1": "deepseek-ai/DeepSeek-R1",
  "deepseek-v3": "deepseek-ai/DeepSeek-V3",
  "deepseek-v2": "deepseek-ai/DeepSeek-V2",
  "mistral-large": "Xenova/mistral-tokenizer-v3",
  "mistral-small": "Xenova/mistral-tokenizer-v3",
  "mistral-nemo": "Xenova/Mistral-Nemo-Instruct-Tokenizer",
  "devstral-small": "Xenova/Mistral-Nemo-Instruct-Tokenizer",
  "codestral": "Xenova/mistral-tokenizer-v3",
}

// Provider default tokenizers
export const PROVIDER_DEFAULTS: Record<string, TokenizerSpec> = {
  anthropic: { kind: "transformers", hub: "Xenova/claude-tokenizer" },
  meta: { kind: "transformers", hub: "Xenova/Meta-Llama-3.1-Tokenizer" },
  mistral: { kind: "transformers", hub: "Xenova/mistral-tokenizer-v3" },
  deepseek: { kind: "transformers", hub: "deepseek-ai/DeepSeek-V3" },
  google: { kind: "transformers", hub: "google/gemma-2-9b-it" },
}
