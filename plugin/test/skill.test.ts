import { expect, test } from "bun:test"

import { SkillAnalyzer } from "../tokenscope-lib/skill.js"
import type { TokenModel } from "../tokenscope-lib/types.js"
import { WarningCollector } from "../tokenscope-lib/warnings.js"

const tokenModel: TokenModel = { name: "test", spec: { kind: "approx" } }
const tokenizer = {
  async countTokens(content: string) {
    return content.length
  },
} as any

test("SkillAnalyzer uses the live static tool description and current verbose catalog format", async () => {
  const analyzer = new SkillAnalyzer({} as any, tokenizer, new URL("http://localhost"), "/tmp")
  const result = await (analyzer as any).getAvailableSkills(
    [{ id: "skill", description: "static skill tool description" }],
    [{ name: "review", description: "Review code", location: "/tmp/a&b" }],
    tokenModel
  )
  const entry = [
    "  <skill>",
    "    <name>review</name>",
    "    <description>Review code</description>",
    "    <location>/tmp/a&amp;b</location>",
    "  </skill>",
  ].join("\n")
  const catalog = [
    "Skills provide specialized instructions and workflows for specific tasks.",
    "Use the skill tool to load a skill when a task matches its description.",
    "<available_skills>",
    entry,
    "</available_skills>",
  ].join("\n")

  expect(result.descriptionTokens).toBe("static skill tool description".length)
  expect(result.totalTokens).toBe(entry.length)
  expect(result.contextTokens).toBe(catalog.length)
})

test("SkillAnalyzer sums each persisted skill result instead of multiplying the first result", async () => {
  const analyzer = new SkillAnalyzer({} as any, tokenizer, new URL("http://localhost"), "/tmp")
  const result = await (analyzer as any).getLoadedSkills(
    [
      {
        info: { role: "assistant" },
        parts: [{ type: "tool", tool: "skill", state: { status: "completed", input: { name: "review" }, output: "a" } }],
      },
      {
        info: { role: "assistant" },
        parts: [{ type: "tool", tool: "skill", state: { status: "completed", input: { name: "review" }, output: "long" } }],
      },
    ],
    tokenModel
  )

  expect(result.totalTokens).toBe(5)
  expect(result.skills[0]).toMatchObject({ name: "review", callCount: 2, tokens: 1, totalTokens: 5 })
})

test("SkillAnalyzer makes unavailable catalog metadata visible", async () => {
  const warnings = new WarningCollector()
  const analyzer = new SkillAnalyzer({} as any, tokenizer, new URL("http://localhost"), "/tmp", warnings) as any
  analyzer.fetchInternalJson = async () => {
    throw new Error("unavailable")
  }

  expect(await analyzer.fetchAgents()).toBeUndefined()
  expect(await analyzer.fetchSkills()).toBeUndefined()
  expect(warnings.list()).toEqual([
    "Could not fetch OpenCode agent metadata. Skill and subagent catalog estimates could not be filtered to the active agent's permissions.",
    "Could not fetch the OpenCode skill catalog. Available-skill system-prompt estimates were skipped.",
  ])
})
