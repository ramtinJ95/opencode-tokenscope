import { CostCalculator } from "../tokenscope-lib/cost.js"
import { OutputFormatter } from "../tokenscope-lib/formatter.js"
import type { TokenAnalysis } from "../tokenscope-lib/types.js"

function category(label: string, entries: Array<{ label: string; tokens: number }>) {
  return {
    label,
    totalTokens: entries.reduce((sum, entry) => sum + entry.tokens, 0),
    entries,
    allEntries: entries,
  }
}

export function buildFormatterFixtureAnalysis(): TokenAnalysis {
  return {
    sessionID: "ses_fixture",
    model: { name: "claude-sonnet-4-20250514", spec: { kind: "approx" } },
    pricingModelName: "anthropic/claude-sonnet-4-20250514",
    categories: {
      system: category("system", [{ label: "System override", tokens: 1_250 }]),
      user: category("user", [
        { label: "User #1", tokens: 900 },
        { label: "User #2", tokens: 300 },
      ]),
      assistant: category("assistant", [{ label: "Assistant #1", tokens: 650 }]),
      tools: category("tools", [
        { label: "bash", tokens: 800 },
        { label: "read", tokens: 200 },
      ]),
      reasoning: category("reasoning", [{ label: "Reasoning #1", tokens: 150 }]),
    },
    totalTokens: 4_250,
    inputTokens: 3_000,
    outputTokens: 650,
    reasoningTokens: 150,
    cacheReadTokens: 100_000,
    cacheWriteTokens: 2_000,
    assistantMessageCount: 1,
    apiCallCount: 2,
    callsWithCacheRead: 1,
    callsWithCacheWrite: 1,
    mostRecentInput: 1_100,
    mostRecentOutput: 350,
    mostRecentReasoning: 75,
    mostRecentCacheRead: 50_000,
    mostRecentCacheWrite: 2_000,
    mostRecentProviderTotalTokens: 53_525,
    sessionCost: 0.0456,
    mostRecentCost: 0.0123,
    allToolsCalled: ["bash", "read"],
    toolCallCounts: new Map([
      ["bash", 2],
      ["read", 1],
      ["write", 1],
    ]),
    perModelUsage: [
      {
        providerID: "anthropic",
        modelID: "claude-sonnet-4-20250514",
        modelName: "anthropic/claude-sonnet-4-20250514",
        inputTokens: 2_000,
        outputTokens: 400,
        reasoningTokens: 100,
        cacheReadTokens: 80_000,
        cacheWriteTokens: 2_000,
        apiCost: 0.035,
        apiCallCount: 1,
        callsWithCacheRead: 1,
        callsWithCacheWrite: 1,
      },
      {
        providerID: "google",
        modelID: "gemini-2.5-flash",
        modelName: "google/gemini-2.5-flash",
        inputTokens: 1_000,
        outputTokens: 250,
        reasoningTokens: 50,
        cacheReadTokens: 20_000,
        cacheWriteTokens: 0,
        apiCost: 0.0106,
        apiCallCount: 1,
        callsWithCacheRead: 0,
        callsWithCacheWrite: 0,
      },
    ],
    warnings: ["fixture warning"],
    subagentAnalysis: {
      subagents: [
        {
          sessionID: "ses_child",
          title: "Child Task",
          agentType: "reviewer",
          inputTokens: 500,
          outputTokens: 200,
          reasoningTokens: 25,
          cacheReadTokens: 10_000,
          cacheWriteTokens: 0,
          totalTokens: 10_725,
          apiCost: 0.0042,
          estimatedCost: 0.004875,
          estimatedInputCost: 0.0015,
          estimatedOutputCost: 0.000375,
          estimatedCacheReadCost: 0.003,
          estimatedCacheWriteCost: 0,
          assistantMessageCount: 1,
          apiCallCount: 1,
        },
      ],
      totalInputTokens: 500,
      totalOutputTokens: 200,
      totalReasoningTokens: 25,
      totalCacheReadTokens: 10_000,
      totalCacheWriteTokens: 0,
      totalTokens: 10_725,
      totalApiCost: 0.0042,
      totalEstimatedCost: 0.004875,
      totalApiCalls: 1,
      estimatedInputCost: 0.0015,
      estimatedOutputCost: 0.000375,
      estimatedCacheReadCost: 0.003,
      estimatedCacheWriteCost: 0,
    },
    contextBreakdown: {
      baseSystemPrompt: { tokens: 2_000, identified: false },
      toolDefinitions: { tokens: 4_200, identified: false, toolCount: 12 },
      environmentContext: { tokens: 150, identified: false, components: ["cwd", "date"] },
      projectTree: { tokens: 0, identified: false, fileCount: 0 },
      customInstructions: { tokens: 250, identified: false, sources: ["AGENTS.md"] },
      totalCachedContext: 6_600,
    },
    toolEstimates: [
      { name: "bash", enabled: true, estimatedTokens: 420, argumentCount: 3, hasComplexArgs: false },
      { name: "edit", enabled: true, estimatedTokens: 620, argumentCount: 4, hasComplexArgs: true },
      { name: "disabled", enabled: false, estimatedTokens: 999, argumentCount: 1, hasComplexArgs: false },
    ],
    cacheEfficiency: {
      cacheReadTokens: 100_000,
      freshInputTokens: 3_000,
      cacheWriteTokens: 2_000,
      totalInputTokens: 105_000,
      cacheHitRate: 97.0873786407767,
      costWithoutCaching: 0.315,
      costWithCaching: 0.045,
      costSavings: 0.27,
      savingsPercent: 85.71428571428571,
      effectiveRate: 0.42857142857142855,
      standardRate: 3,
    },
    skillAnalysis: {
      availableSkills: [
        { name: "web-browser", description: "Browse pages", tokens: 700 },
        { name: "conventional-commit", description: "Create conventional commits", tokens: 500 },
      ],
      availableSubagents: [
        { name: "explore", description: "Discovery only subagent", tokens: 900 },
      ],
      loadedSkills: [
        { name: "web-browser", callCount: 2, firstMessageIndex: 3, tokens: 600, totalTokens: 1_200, content: "..." },
      ],
      totalAvailableTokens: 1_200,
      totalAvailableSubagentTokens: 900,
      totalLoadedTokens: 1_200,
      availableSkillsContextTokens: 1_500,
      skillToolDescriptionTokens: 250,
      taskToolDescriptionTokens: 2_000,
    },
  }
}

export function buildFormatterFixtureReport(): string {
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

  return formatter.format(buildFormatterFixtureAnalysis())
}
