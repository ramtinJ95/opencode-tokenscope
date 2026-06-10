import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { CostCalculator } from "../tokenscope-lib/cost.js"
import { OutputFormatter } from "../tokenscope-lib/formatter.js"
import { buildFormatterFixtureAnalysis, buildFormatterFixtureReport } from "./formatter.fixture.js"

const testDir = path.dirname(fileURLToPath(import.meta.url))

test("formats the full token report without changing layout", async () => {
  const expected = await fs.readFile(path.join(testDir, "fixtures", "formatter-full-report.txt"), "utf8")

  expect(buildFormatterFixtureReport()).toBe(expected)
})

test("formats optional detailed subagent breakdowns when enabled", () => {
  const formatter = new OutputFormatter(
    new CostCalculator({
      "anthropic/claude-sonnet-4-20250514": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
      "google/gemini-2.5-flash": { input: 0.3, output: 2.5, cacheWrite: 0, cacheRead: 0.075 },
      default: { input: 1, output: 3, cacheWrite: 0, cacheRead: 0 },
    })
  )

  formatter.setConfig({
    enableContextBreakdown: true,
    enableToolSchemaEstimation: true,
    enableCacheEfficiency: true,
    enableSubagentAnalysis: true,
    enableDetailedSubagentCostBreakdown: true,
    enableSkillAnalysis: true,
  })

  const report = formatter.format(buildFormatterFixtureAnalysis())

  expect(report).toContain("Tokens: fresh 500 | cache read 10,000 | cache write 0 | output 200 | reasoning 25")
  expect(report).toContain(
    "Estimated split: fresh $0.0015 | cache read $0.0030 | cache write $0.0000 | output+reasoning $0.0004"
  )
  expect(report).toContain("Subagent Total:")
})
