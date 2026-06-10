import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { DEFAULT_TOKENSCOPE_CONFIG, loadModelPricing, resolveBundledAssetPath } from "../tokenscope-lib/config.ts"

const testDir = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(testDir, "..")

test("resolves bundled assets from the source module layout", async () => {
  const moduleDir = path.join(pluginRoot, "tokenscope-lib")
  const assetPath = await resolveBundledAssetPath("models.json", moduleDir)

  expect(assetPath).toBe(path.join(pluginRoot, "models.json"))
})

test("resolves bundled assets from the compiled dist module layout", async () => {
  const moduleDir = path.join(pluginRoot, "dist", "tokenscope-lib")
  const assetPath = await resolveBundledAssetPath("models.json", moduleDir)

  expect(assetPath).toBe(path.join(pluginRoot, "models.json"))
})

test("loads the bundled pricing catalog instead of the default fallback table", async () => {
  const pricing = await loadModelPricing()

  expect(Object.keys(pricing).length).toBeGreaterThan(100)
  expect(pricing.default).toBeUndefined()
})

test("bundled and in-code config defaults include detailed subagent breakdown flag", async () => {
  expect(DEFAULT_TOKENSCOPE_CONFIG.enableDetailedSubagentCostBreakdown).toBe(false)

  const configPath = await resolveBundledAssetPath("tokenscope-config.json", path.join(pluginRoot, "tokenscope-lib"))
  const bundledConfig = JSON.parse(await fs.readFile(configPath, "utf8"))

  expect(bundledConfig.enableDetailedSubagentCostBreakdown).toBe(false)
})
