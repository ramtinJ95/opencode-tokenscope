import { expect, test } from "bun:test"

import { TokenizerManager } from "../tokenscope-lib/tokenizer.js"
import { WarningCollector } from "../tokenscope-lib/warnings.js"

test("TokenizerManager makes an encoder failure and approximate fallback visible", async () => {
  const warnings = new WarningCollector()
  const manager = new TokenizerManager(warnings) as any
  manager.loadTiktokenEncoder = async () => ({
    encode() {
      throw new Error("encode failed")
    },
  })

  expect(
    await manager.countTokens("hello", { name: "gpt-test", spec: { kind: "tiktoken", model: "gpt-4o" } })
  ).toBe(2)
  expect(warnings.list()[0]).toContain("fell back to approximate mode")
})

test("TokenizerManager makes an unknown tiktoken model fallback visible", async () => {
  const warnings = new WarningCollector()
  const manager = new TokenizerManager(warnings) as any
  manager.loadTiktokenModule = async () => ({
    encodingForModel() {
      throw new Error("unknown model")
    },
    getEncoding(name: string) {
      expect(name).toBe("cl100k_base")
      return { encode: (content: string) => ({ length: content.length }) }
    },
  })

  expect(
    await manager.countTokens("hello", { name: "future-model", spec: { kind: "tiktoken", model: "future-model" } })
  ).toBe(5)
  expect(warnings.list()[0]).toContain("cl100k_base encoding")
})
