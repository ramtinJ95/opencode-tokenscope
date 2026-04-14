import { expect, test } from "bun:test"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { loadModelPricing, resolveBundledAssetPath } from "../tokenscope-lib/config.ts"

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
