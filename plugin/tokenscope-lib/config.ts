// Configuration constants, model maps, and pricing loader

import path from "path"
import fs from "fs/promises"
import { homedir } from "os"
import { fileURLToPath } from "url"
import type { TokenizerSpec, ModelPricing, TokenscopeConfig } from "./types.js"

export const DEFAULT_ENTRY_LIMIT = 3
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
const USER_TOKENSCOPE_CONFIG_PATH = path.join(homedir(), ".config", "opencode", "tokenscope-config.json")
const BUNDLED_ASSET_PATH_CACHE = new Map<string, string>()

export async function resolveBundledAssetPath(filename: string, moduleDir = MODULE_DIR): Promise<string> {
  const cacheKey = `${moduleDir}:${filename}`
  const cached = BUNDLED_ASSET_PATH_CACHE.get(cacheKey)
  if (cached) return cached

  const candidates = [path.join(moduleDir, "..", filename), path.join(moduleDir, "../..", filename)]

  for (const candidate of candidates) {
    try {
      await fs.access(candidate)
      BUNDLED_ASSET_PATH_CACHE.set(cacheKey, candidate)
      return candidate
    } catch {}
  }

  const fallback = candidates[0]
  BUNDLED_ASSET_PATH_CACHE.set(cacheKey, fallback)
  return fallback
}

// Pricing cache
let PRICING_CACHE: Record<string, ModelPricing> | null = null

export async function loadModelPricing(): Promise<Record<string, ModelPricing>> {
  if (PRICING_CACHE) return PRICING_CACHE

  try {
    const modelsPath = await resolveBundledAssetPath("models.json")
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
  enableDetailedSubagentCostBreakdown: false,
  enableSkillAnalysis: true,
}

let TOKENSCOPE_CONFIG_CACHE: TokenscopeConfig | null = null

async function readTokenscopeConfigFile(configPath: string): Promise<Partial<TokenscopeConfig> | null> {
  try {
    const data = await fs.readFile(configPath, "utf8")
    return JSON.parse(data) as Partial<TokenscopeConfig>
  } catch {
    return null
  }
}

export async function loadTokenscopeConfig(): Promise<TokenscopeConfig> {
  if (TOKENSCOPE_CONFIG_CACHE) return TOKENSCOPE_CONFIG_CACHE

  const userConfig = await readTokenscopeConfigFile(USER_TOKENSCOPE_CONFIG_PATH)
  const bundledConfigPath = userConfig ? null : await resolveBundledAssetPath("tokenscope-config.json")
  const bundledConfig = bundledConfigPath ? await readTokenscopeConfigFile(bundledConfigPath) : null

  TOKENSCOPE_CONFIG_CACHE = {
    ...DEFAULT_TOKENSCOPE_CONFIG,
    ...(bundledConfig ?? {}),
    ...(userConfig ?? {}),
  }

  return TOKENSCOPE_CONFIG_CACHE
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

// Hugging Face tokenizer model mapping
export const HUGGINGFACE_TOKENIZER_MODEL_MAP: Record<string, string> = {
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
  anthropic: { kind: "huggingface", hub: "Xenova/claude-tokenizer" },
  meta: { kind: "huggingface", hub: "Xenova/Meta-Llama-3.1-Tokenizer" },
  mistral: { kind: "huggingface", hub: "Xenova/mistral-tokenizer-v3" },
  deepseek: { kind: "huggingface", hub: "deepseek-ai/DeepSeek-V3" },
}
