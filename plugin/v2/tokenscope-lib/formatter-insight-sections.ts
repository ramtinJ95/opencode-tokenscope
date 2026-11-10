import type { CacheEfficiency, ContextBreakdown, CostEstimate, SkillAnalysis, ToolSchemaEstimate } from "./types.js"
import {
  calculateModelAwareCacheEfficiency,
  formatContextBar,
  formatEfficiencyBar,
  formatNumber,
  formatRate,
  formatUsd,
  SKILL_DESC_WIDTH,
  SKILL_NAME_WIDTH,
  SUBAGENT_DESC_WIDTH,
  SUBAGENT_NAME_WIDTH,
  TOOL_ESTIMATE_LABEL_WIDTH,
} from "./formatter-helpers.js"

export function formatContextBreakdown(breakdown: ContextBreakdown): string[] {
  const lines: string[] = []
  const total = breakdown.totalCachedContext
  const isEstimated = !breakdown.baseSystemPrompt.identified

  lines.push(``)
  lines.push(`═══════════════════════════════════════════════════════════════════════════`)
  if (isEstimated) {
    lines.push(`CONTEXT BREAKDOWN (Estimated from cache_write tokens)`)
  } else {
    lines.push(`CONTEXT BREAKDOWN (Measured from the latest model request)`)
  }
  lines.push(`─────────────────────────────────────────────────────────────────────────`)
  lines.push(``)

  if (breakdown.baseSystemPrompt.tokens > 0) {
    const label = breakdown.baseSystemPrompt.identified ? "Base System Prompt" : "Other Cached Prompt"
    const bar = formatContextBar(label, breakdown.baseSystemPrompt.tokens, total)
    lines.push(`  ${bar}`)
  }

  if (breakdown.toolDefinitions.tokens > 0) {
    const label =
      breakdown.toolDefinitions.toolCount > 0
        ? `Tool Definitions (${breakdown.toolDefinitions.toolCount})`
        : "Tool Definitions"
    const bar = formatContextBar(label, breakdown.toolDefinitions.tokens, total)
    lines.push(`  ${bar}`)
  }

  if (breakdown.environmentContext.tokens > 0) {
    const bar = formatContextBar("Environment Context", breakdown.environmentContext.tokens, total)
    lines.push(`  ${bar}`)
  }

  if (breakdown.customInstructions.tokens > 0) {
    const bar = formatContextBar("Custom Instructions", breakdown.customInstructions.tokens, total)
    lines.push(`  ${bar}`)
    if (breakdown.customInstructions.sources.length > 0) {
      for (const source of breakdown.customInstructions.sources.slice(0, 3)) {
        lines.push(`      → ${source}`)
      }
    }
  }

  if (breakdown.guidance.tokens > 0) {
    const bar = formatContextBar("Catalogs & Guidance", breakdown.guidance.tokens, total)
    lines.push(`  ${bar}`)
    for (const source of breakdown.guidance.sources.slice(0, 4)) {
      lines.push(`      → ${source}`)
    }
  }

  lines.push(`  ───────────────────────────────────────────────────────────────────`)
  // The estimate is anchored on the first cache write; the measured total is the sum of its parts.
  const totalLabel = isEstimated ? "First Cache Write:" : "Measured Request Context:"
  lines.push(`  ${totalLabel.padEnd(54)}${isEstimated ? "" : "~"}${formatNumber(total)} tokens`)
  lines.push(``)
  if (isEstimated) {
    lines.push(`  Note: First cache_write is an observed count; component attribution is heuristic.`)
  } else {
    lines.push(`  Note: Values from tokenizing the system prompt and tool definitions OpenCode sent.`)
  }

  return lines
}

export function formatToolEstimates(estimates: ToolSchemaEstimate[]): string[] {
  const lines: string[] = []
  const listedEstimates = estimates.filter((e) => e.enabled)
  const totalTokens = listedEstimates.reduce((sum, e) => sum + e.estimatedTokens, 0)
  const usesOpenCodeMetadata = listedEstimates.some((estimate) => estimate.source === "model-request")

  lines.push(``)
  lines.push(`═══════════════════════════════════════════════════════════════════════════`)
  lines.push(
    usesOpenCodeMetadata
      ? `TOOL DEFINITION COSTS (Tokenized from the latest model request)`
      : `TOOL DEFINITION COSTS (Estimated from argument analysis)`
  )
  lines.push(`─────────────────────────────────────────────────────────────────────────`)
  lines.push(``)
  lines.push(`  ${"Tool".padEnd(TOOL_ESTIMATE_LABEL_WIDTH)} ${"Est. Tokens".padStart(12)}   Args   Complexity`)
  lines.push(`  ───────────────────────────────────────────────────────────────────`)

  for (const estimate of listedEstimates) {
    const name = estimate.name.padEnd(TOOL_ESTIMATE_LABEL_WIDTH)
    const tokens = `~${formatNumber(estimate.estimatedTokens)}`.padStart(12)
    const args = estimate.argumentCount.toString().padStart(5)
    const complexity = estimate.hasComplexArgs ? "complex (arrays/objects)" : "simple"
    lines.push(`  ${name} ${tokens}   ${args}   ${complexity}`)
  }

  lines.push(`  ───────────────────────────────────────────────────────────────────`)
  lines.push(
    `  Total:${" ".repeat(TOOL_ESTIMATE_LABEL_WIDTH - 6)} ~${formatNumber(totalTokens).padStart(11)} tokens (${listedEstimates.length} ${usesOpenCodeMetadata ? "tools in the request" : "observed tools"})`
  )
  lines.push(``)
  if (usesOpenCodeMetadata) {
    lines.push(`  Note: Tokenized from the tool descriptions and JSON schemas OpenCode sent to the model.`)
    lines.push(`        Provider-specific schema wrapping may still add small overhead.`)
  } else {
    lines.push(`  Note: Estimates inferred from tool call arguments in this session; only tools`)
    lines.push(`        the session called are listed. Actual schema tokens may vary +/-20%.`)
  }

  return lines
}

export function formatCacheEfficiency(efficiency: CacheEfficiency, cost: CostEstimate, modelName: string): string[] {
  const lines: string[] = []
  const total = efficiency.totalInputTokens
  const modelAwareEfficiency = calculateModelAwareCacheEfficiency(efficiency, cost)

  lines.push(``)
  lines.push(`═══════════════════════════════════════════════════════════════════════════`)
  lines.push(`CACHE EFFICIENCY`)
  lines.push(`─────────────────────────────────────────────────────────────────────────`)
  lines.push(``)
  lines.push(`  Token Distribution:`)

  const cacheReadPct = total > 0 ? ((efficiency.cacheReadTokens / total) * 100).toFixed(1) : "0.0"
  const cacheReadBar = formatEfficiencyBar(efficiency.cacheReadTokens, total)
  lines.push(`    Cache Read:        ${formatNumber(efficiency.cacheReadTokens).padStart(10)} tokens   ${cacheReadBar}  ${cacheReadPct}%`)

  const freshPct = total > 0 ? ((efficiency.freshInputTokens / total) * 100).toFixed(1) : "0.0"
  const freshBar = formatEfficiencyBar(efficiency.freshInputTokens, total)
  lines.push(`    Fresh Input:       ${formatNumber(efficiency.freshInputTokens).padStart(10)} tokens   ${freshBar}  ${freshPct}%`)

  if (efficiency.cacheWriteTokens > 0) {
    const cacheWritePct = total > 0 ? ((efficiency.cacheWriteTokens / total) * 100).toFixed(1) : "0.0"
    const cacheWriteBar = formatEfficiencyBar(efficiency.cacheWriteTokens, total)
    lines.push(
      `    Cache Write:      ${formatNumber(efficiency.cacheWriteTokens).padStart(10)} tokens   ${cacheWriteBar}  ${cacheWritePct}%`
    )
  }

  lines.push(`  ───────────────────────────────────────────────────────────────────`)
  lines.push(`  Cache Hit Rate:      ${efficiency.cacheHitRate.toFixed(1)}% (cache read / (cache read + fresh input))`)
  lines.push(``)

  if (cost.perModelCosts.length > 1) {
    lines.push(`  Cost Analysis (per-model pricing across ${cost.perModelCosts.length} models):`)
    lines.push(`    Without caching:   $${formatUsd(modelAwareEfficiency.costWithoutCaching)}`)
    lines.push(`    With caching:      $${formatUsd(modelAwareEfficiency.costWithCaching)}`)
  } else {
    const modelCost = cost.perModelCosts[0]
    const inputRate = modelCost?.pricePerMillionInput ?? cost.pricePerMillionInput
    const uncachedInputRate = modelCost?.pricingTier === "mixed_context_tiers" ? modelAwareEfficiency.standardRate : inputRate
    const cacheReadRate = modelCost?.pricePerMillionCacheRead ?? cost.pricePerMillionCacheRead
    const cacheWriteRate = modelCost?.pricePerMillionCacheWrite ?? cost.pricePerMillionCacheWrite
    const tierLabel =
      modelCost?.pricingTier === "context_tier"
        ? `, >${formatNumber(modelCost.pricingTierThreshold ?? 200_000)} context-token rates`
        : modelCost?.pricingTier === "mixed_context_tiers"
          ? ", mixed context rates"
          : ""
    lines.push(
      `  Cost Analysis (${modelName} @ $${formatRate(inputRate)}/M input, $${formatRate(cacheReadRate)}/M cache read, $${formatRate(cacheWriteRate)}/M cache write${tierLabel}):`
    )
    lines.push(
      `    Without caching:   $${formatUsd(modelAwareEfficiency.costWithoutCaching)}  (${formatNumber(total)} tokens x $${formatRate(uncachedInputRate)}/M)`
    )
    lines.push(
      `    With caching:      $${formatUsd(modelAwareEfficiency.costWithCaching)}  (fresh x $${formatRate(inputRate)}/M + cache read x $${formatRate(cacheReadRate)}/M + cache write x $${formatRate(cacheWriteRate)}/M)`
    )
  }
  lines.push(`  ───────────────────────────────────────────────────────────────────`)
  lines.push(
    `  Cost Savings:        $${formatUsd(modelAwareEfficiency.costSavings)}  (${modelAwareEfficiency.savingsPercent.toFixed(1)}% reduction)`
  )
  lines.push(
    `  Effective Rate:      $${formatRate(modelAwareEfficiency.effectiveRate)}/M tokens  (vs. $${formatRate(modelAwareEfficiency.standardRate)}/M standard)`
  )

  return lines
}

export function formatAvailableSkills(analysis: SkillAnalysis): string[] {
  const lines: string[] = []
  const total = analysis.totalAvailableTokens
  const hasSystemPromptCatalog = analysis.availableSkillsContextTokens > 0

  lines.push(``)
  lines.push(`══════════════════════════════════════════════════════════════════════════`)
  lines.push(`AVAILABLE SKILLS (always-available context)`)
  lines.push(`─────────────────────────────────────────────────────────────────────────`)
  lines.push(``)
  if (hasSystemPromptCatalog) {
    lines.push(`OpenCode includes a skill catalog in each provider request where skills are available.`)
    lines.push(`The rows below estimate the per-skill XML entries inside that shared catalog.`)
  } else {
    lines.push(`These skills are registered in OpenCode but no skill catalog was found in the system prompt.`)
  }
  lines.push(``)

  const nameHeader = "Skill".padEnd(SKILL_NAME_WIDTH)
  const descHeader = "Description".padEnd(SKILL_DESC_WIDTH)
  lines.push(`  ${nameHeader} ${descHeader} Tokens`)
  lines.push(`  ───────────────────────────────────────────────────────────────────────`)

  const sortedSkills = [...analysis.availableSkills].sort((a, b) => b.tokens - a.tokens)

  for (const skill of sortedSkills) {
    const name =
      skill.name.length > SKILL_NAME_WIDTH
        ? skill.name.substring(0, SKILL_NAME_WIDTH - 1) + "…"
        : skill.name.padEnd(SKILL_NAME_WIDTH)

    const desc =
      skill.description.length > SKILL_DESC_WIDTH
        ? skill.description.substring(0, SKILL_DESC_WIDTH - 1) + "…"
        : skill.description.padEnd(SKILL_DESC_WIDTH)

    const tokens = `~${formatNumber(skill.tokens)}`.padStart(7)
    lines.push(`  ${name} ${desc} ${tokens}`)
  }

  lines.push(`  ───────────────────────────────────────────────────────────────────────`)
  lines.push(`  Total: ~${formatNumber(total)} tokens (${analysis.availableSkills.length} skills available)`)
  lines.push(``)

  if (hasSystemPromptCatalog) {
    lines.push(
      `  Note: Full system-prompt skill catalog is ~${formatNumber(analysis.availableSkillsContextTokens)} tokens (includes shared wrapper/preamble).`
    )
    if (analysis.skillToolDescriptionTokens > 0) {
      lines.push(
        `        Static skill tool description adds ~${formatNumber(analysis.skillToolDescriptionTokens)} tokens more.`
      )
    }
  } else if (analysis.skillToolDescriptionTokens > 0) {
    lines.push(
      `  Note: Static skill tool description is ~${formatNumber(analysis.skillToolDescriptionTokens)} tokens.`
    )
  }

  return lines
}

export function formatLoadedSkills(analysis: SkillAnalysis): string[] {
  const lines: string[] = []
  const total = analysis.totalLoadedTokens

  lines.push(``)
  lines.push(`═══════════════════════════════════════════════════════════════════════════`)
  lines.push(`LOADED SKILLS (on-demand content)`)
  lines.push(`─────────────────────────────────────────────────────────────────────────`)
  lines.push(``)
  lines.push(`Skills loaded during this session via the skill tool.`)
  lines.push(``)

  const nameHeader = "Skill".padEnd(SKILL_NAME_WIDTH)
  lines.push(`  ${nameHeader} Message #     Tokens     Calls`)
  lines.push(`  ─────────────────────────────────────────────────────`)

  for (const skill of analysis.loadedSkills) {
    const name =
      skill.name.length > SKILL_NAME_WIDTH
        ? skill.name.substring(0, SKILL_NAME_WIDTH - 1) + "…"
        : skill.name.padEnd(SKILL_NAME_WIDTH)

    const msgNum = `#${skill.firstMessageIndex}`.padStart(10)
    const tokens = formatNumber(skill.totalTokens).padStart(10)
    const calls = `${skill.callCount}x`.padStart(9)

    lines.push(`  ${name} ${msgNum} ${tokens} ${calls}`)
  }

  lines.push(`  ─────────────────────────────────────────────────────`)
  lines.push(
    `  Total: ${formatNumber(total)} tokens (${analysis.loadedSkills.length} skill${analysis.loadedSkills.length !== 1 ? "s" : ""} loaded)`
  )
  lines.push(``)
  lines.push(`  Note: Loaded skill content stays in the active context until the session is compacted.`)

  return lines
}

export function formatAvailableSubagents(analysis: SkillAnalysis): string[] {
  const lines: string[] = []
  const total = analysis.totalAvailableSubagentTokens

  lines.push(``)
  lines.push(`═══════════════════════════════════════════════════════════════════════════`)
  lines.push(`AVAILABLE SUBAGENTS (in subagent tool definition)`)
  lines.push(`─────────────────────────────────────────────────────────────────────────`)
  lines.push(``)
  lines.push(`These subagents are embedded in the subagent tool description whenever that tool is enabled for a provider request.`)
  lines.push(``)

  const nameHeader = "Subagent".padEnd(SUBAGENT_NAME_WIDTH)
  const descHeader = "Description".padEnd(SUBAGENT_DESC_WIDTH)
  lines.push(`  ${nameHeader} ${descHeader} Tokens`)
  lines.push(`  ───────────────────────────────────────────────────────────────────────`)

  const sortedSubagents = [...analysis.availableSubagents].sort((a, b) => b.tokens - a.tokens)

  for (const subagent of sortedSubagents) {
    const name =
      subagent.name.length > SUBAGENT_NAME_WIDTH
        ? subagent.name.substring(0, SUBAGENT_NAME_WIDTH - 1) + "…"
        : subagent.name.padEnd(SUBAGENT_NAME_WIDTH)

    const desc =
      subagent.description.length > SUBAGENT_DESC_WIDTH
        ? subagent.description.substring(0, SUBAGENT_DESC_WIDTH - 1) + "…"
        : subagent.description.padEnd(SUBAGENT_DESC_WIDTH)

    const tokens = `~${formatNumber(subagent.tokens)}`.padStart(7)

    lines.push(`  ${name} ${desc} ${tokens}`)
  }

  lines.push(`  ───────────────────────────────────────────────────────────────────────`)
  lines.push(
    `  Total: ~${formatNumber(total)} tokens (${analysis.availableSubagents.length} subagents available)`
  )
  lines.push(``)
  if (analysis.subagentToolDescriptionTokens > 0) {
    lines.push(
      `  Note: Full subagent tool description is ~${formatNumber(analysis.subagentToolDescriptionTokens)} tokens (includes usage instructions).`
    )
  }

  return lines
}
