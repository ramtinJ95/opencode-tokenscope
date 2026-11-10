import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { CostCalculator } from "../tokenscope-lib/cost.js"
import { OutputFormatter } from "../tokenscope-lib/formatter.js"
import { formatRate, formatUsd } from "../tokenscope-lib/formatter-helpers.js"
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
    "Estimated API-rate split: fresh $0.0015 | cache read $0.0030 | cache write $0.0000 | output+reasoning $0.000375 (estimated total $0.004875 | OpenCode-recorded total $0.0042)"
  )
  expect(report).toContain("Displayed subagent costs use OpenCode-recorded child cost")
  expect(report).toContain("Subagent Total:")
})

test("formats recorded subagent costs even when the main session recorded zero cost", () => {
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

  const report = formatter.format({
    ...buildFormatterFixtureAnalysis(),
    sessionCost: 0,
  })

  expect(report).toContain("reviewer                     $0.0042")
  expect(report).toContain("OpenCode-recorded total $0.0042")
  expect(report).toContain("Displayed subagent costs use OpenCode-recorded child cost")
  expect(report).not.toContain("the displayed subagent cost is the estimate")
})

test("preserves meaningful precision for small USD amounts", () => {
  expect(formatUsd(0)).toBe("0.0000")
  expect(formatUsd(0.0456)).toBe("0.0456")
  expect(formatUsd(0.00001234)).toBe("0.00001234")
})

test("preserves meaningful precision for per-million rates", () => {
  expect(formatRate(3)).toBe("3.00")
  expect(formatRate(0.075)).toBe("0.075")
  expect(formatRate(0.00875)).toBe("0.00875")
})

test("formats zero-recorded-cost reports without assuming a subscription", () => {
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
    enableDetailedSubagentCostBreakdown: false,
    enableSkillAnalysis: true,
  })

  const report = formatter.format({
    ...buildFormatterFixtureAnalysis(),
    sessionCost: 0,
  })

  expect(report).toContain("ESTIMATED API-RATE COST (OpenCode recorded $0)")
  expect(report).toContain("can mean subscription, free/local usage, or zero/missing pricing metadata")
  expect(report).not.toContain("You appear to be on a subscription plan")
})
