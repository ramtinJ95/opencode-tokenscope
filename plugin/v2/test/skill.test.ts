import { expect, test } from "bun:test"

import type { CatalogReader } from "../tokenscope-lib/opencode.js"
import { SkillAnalyzer } from "../tokenscope-lib/skill.js"
import type { RequestSnapshot, SessionMessage, TokenModel, TokenscopeConfig } from "../tokenscope-lib/types.js"

const tokenModel: TokenModel = { name: "test", spec: { kind: "approx" } }
const config: TokenscopeConfig = {
  enableContextBreakdown: true,
  enableToolSchemaEstimation: true,
  enableCacheEfficiency: true,
  enableSubagentAnalysis: true,
  enableDetailedSubagentCostBreakdown: false,
  enableSkillAnalysis: true,
}

// Counts whitespace-separated words so expected token counts are easy to read.
const tokenizer = {
  async countTokens(content: string) {
    return content.trim().split(/\s+/).filter(Boolean).length
  },
} as any

function agent(id: string, overrides: Record<string, unknown> = {}) {
  return { id, name: id, mode: "subagent", hidden: false, permissions: [], ...overrides }
}

function skill(id: string, overrides: Record<string, unknown> = {}) {
  return { id, name: id, description: `Use ${id}`, path: `/skills/${id}/SKILL.md`, content: "...", ...overrides }
}

const catalog = {
  agent: {
    async list() {
      return {
        data: [
          agent("build", {
            mode: "primary",
            permissions: [
              { action: "*", resource: "*", effect: "allow" },
              { action: "skill", resource: "secret-*", effect: "deny" },
              { action: "subagent", resource: "forbidden", effect: "deny" },
            ],
          }),
          agent("explore", { description: "Read-only codebase search" }),
          agent("general"),
          agent("forbidden"),
          agent("internal", { hidden: true }),
          agent("plan", { mode: "primary" }),
        ],
      }
    },
  },
  skill: {
    async list() {
      return {
        data: [
          skill("review"),
          skill("secret-deploy"),
          skill("manual-only", { autoinvoke: false }),
          skill("undocumented", { description: undefined }),
          skill("commit"),
        ],
      }
    },
  },
} as unknown as CatalogReader

const messages: SessionMessage[] = [
  { info: { id: "msg_1", role: "user" }, parts: [{ type: "text", text: "review this" }] },
  {
    info: { id: "msg_2", role: "assistant", agent: "build" },
    parts: [
      {
        type: "tool",
        tool: "skill",
        state: { status: "completed", input: { id: "review" }, output: "one two three", metadata: { name: "Review" } },
      },
      { type: "tool", tool: "skill", state: { status: "error", input: { id: "commit" }, output: "Unable to load skill" } },
    ],
  },
  {
    info: { id: "msg_3", role: "assistant", agent: "build" },
    parts: [{ type: "tool", tool: "skill", state: { status: "completed", input: { id: "review" }, output: "one two three" } }],
  },
]

const snapshot: RequestSnapshot = {
  system: [
    {
      text: "instructions",
      instructions: [{ key: "core/skill-guidance", text: "Skills provide specialized instructions <available_skills> ... </available_skills>" }],
    },
  ],
  tools: [
    { id: "skill", description: "Load a specialized skill", schema: {} },
    { id: "subagent", description: "Spawns an agent Available subagents: - explore: Read-only codebase search", schema: {} },
  ],
}

test("lists the skills and subagents the current agent can use", async () => {
  const analysis = await new SkillAnalyzer(catalog, tokenizer).analyze({ messages, snapshot, tokenModel, config })

  expect(analysis?.availableSkills.map((item) => item.name)).toEqual(["commit", "review"])
  expect(analysis?.availableSubagents).toEqual([
    { name: "explore", description: "Read-only codebase search", tokens: 5 },
    { name: "general", description: "This subagent should only be called when explicitly requested.", tokens: 11 },
  ])
  expect(analysis?.totalAvailableSubagentTokens).toBe(16)
  expect(analysis?.availableSkillsContextTokens).toBe(7)
  expect(analysis?.skillToolDescriptionTokens).toBe(4)
  expect(analysis?.subagentToolDescriptionTokens).toBe(10)
})

test("session permission rules are evaluated after the agent's rules", async () => {
  const analysis = await new SkillAnalyzer(catalog, tokenizer).analyze({
    messages,
    snapshot,
    sessionPermissions: [
      { action: "skill", resource: "review", effect: "deny" },
      { action: "subagent", resource: "forbidden", effect: "allow" },
    ],
    tokenModel,
    config,
  })

  expect(analysis?.availableSkills.map((item) => item.name)).toEqual(["commit"])
  expect(analysis?.availableSubagents.map((item) => item.name)).toEqual(["explore", "forbidden", "general"])
})

test("counts loaded skill content once per successful load", async () => {
  const analysis = await new SkillAnalyzer(catalog, tokenizer).analyze({ messages, snapshot, tokenModel, config })

  expect(analysis?.loadedSkills).toEqual([
    { name: "review", callCount: 2, firstMessageIndex: 2, tokens: 3, totalTokens: 6, content: "one two three" },
  ])
  expect(analysis?.totalLoadedTokens).toBe(6)
})

test("rebuilds the skill catalog size and omits tool descriptions when no request was captured", async () => {
  const analysis = await new SkillAnalyzer(catalog, tokenizer).analyze({ messages, tokenModel, config })

  expect(analysis?.availableSkills.map((item) => item.name)).toEqual(["commit", "review"])
  expect(analysis?.availableSkillsContextTokens).toBeGreaterThan(analysis!.totalAvailableTokens)
  expect(analysis?.skillToolDescriptionTokens).toBe(0)
  expect(analysis?.subagentToolDescriptionTokens).toBe(0)
})
