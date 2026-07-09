import type {
  ContextAnalysisResult,
  SessionAggregateInfo,
  SessionMessage,
  TokenAnalysis,
  TokenModel,
  TokenscopeConfig,
} from "./types.js"
import { CostCalculator } from "./cost.js"
import { SubagentAnalyzer } from "./subagent.js"
import { ContextAnalyzer } from "./context.js"
import { SkillAnalyzer } from "./skill.js"
import { WarningCollector } from "./warnings.js"

function normalizeSessionID(sessionID?: string): string | undefined {
  const normalized = sessionID?.trim()
  return normalized ? normalized : undefined
}

export function resolveSessionID(argSessionID: string | undefined, contextSessionID: string | undefined): string | undefined {
  return normalizeSessionID(argSessionID) ?? normalizeSessionID(contextSessionID)
}

export function addModelSupportWarnings(
  warnings: WarningCollector,
  costCalculator: CostCalculator,
  tokenModel: TokenModel,
  providerID: string | undefined,
  modelID: string | undefined,
  pricingModelName: string
): void {
  if (tokenModel.spec.kind === "approx") {
    warnings.add(
      `Model '${providerID}/${modelID}' is not currently supported by a model-specific tokenizer. Token counts use an approximate character-based fallback.`,
      `unsupported-tokenizer:${providerID}:${modelID}`
    )
  }

  if (!costCalculator.hasPricing(pricingModelName)) {
    warnings.add(
      `Pricing for '${pricingModelName}' was not found in OpenCode metadata or models.json. Cost estimates use the default fallback rates ($1/M input, $3/M output, no cache pricing).`,
      `missing-pricing:${pricingModelName}`
    )
  }
}

export function addPerModelPricingWarnings(
  warnings: WarningCollector,
  costCalculator: CostCalculator,
  analysis: TokenAnalysis,
  fallbackPricingModelName: string
): void {
  for (const modelUsage of analysis.perModelUsage) {
    const modelPricingName = costCalculator.resolvePricingModelName(modelUsage, fallbackPricingModelName)
    if (!costCalculator.hasPricing(modelPricingName)) {
      warnings.add(
        `Pricing for '${modelPricingName}' was not found in OpenCode metadata or models.json. Cost estimates for that model use the default fallback rates ($1/M input, $3/M output, no cache pricing).`,
        `missing-pricing:${modelPricingName}`
      )
    }
  }
}

export function addSessionAggregateWarnings(
  warnings: WarningCollector,
  analysis: TokenAnalysis,
  session: SessionAggregateInfo
): void {
  if (!session.tokens) {
    warnings.add(
      "OpenCode session metadata did not expose aggregate token buckets, so message telemetry could not be reconciled.",
      `session-aggregate-missing:${analysis.sessionID}`
    )
  } else {
    const safe = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0)
    const aggregate = {
      input: safe(session.tokens.input),
      output: safe(session.tokens.output),
      reasoning: safe(session.tokens.reasoning),
      cacheRead: safe(session.tokens.cache?.read),
      cacheWrite: safe(session.tokens.cache?.write),
      cost: safe(session.cost),
    }
    const derived = {
      input: analysis.inputTokens,
      output: analysis.outputTokens,
      reasoning: analysis.reasoningTokens,
      cacheRead: analysis.cacheReadTokens,
      cacheWrite: analysis.cacheWriteTokens,
      cost: analysis.sessionCost,
    }
    const tokenMismatch =
      aggregate.input !== derived.input ||
      aggregate.output !== derived.output ||
      aggregate.reasoning !== derived.reasoning ||
      aggregate.cacheRead !== derived.cacheRead ||
      aggregate.cacheWrite !== derived.cacheWrite
    const costMismatch = Math.abs(aggregate.cost - derived.cost) > 1e-9

    if (tokenMismatch || costMismatch) {
      const aggregateTotal =
        aggregate.input + aggregate.output + aggregate.reasoning + aggregate.cacheRead + aggregate.cacheWrite
      const derivedTotal =
        derived.input + derived.output + derived.reasoning + derived.cacheRead + derived.cacheWrite
      warnings.add(
        `Message-derived telemetry did not reconcile with OpenCode's session aggregate (messages: ${derivedTotal} tokens / $${derived.cost.toFixed(6)}; session: ${aggregateTotal} tokens / $${aggregate.cost.toFixed(6)}). Recorded usage may be incomplete or incompatible.`,
        `session-aggregate:${analysis.sessionID}`
      )
    }
  }

  if (session.revert?.messageID) {
    warnings.add(
      `Session has an active revert at message ${session.revert.messageID}. Retained local content can include reverted history that is not active model context.`,
      `session-revert:${analysis.sessionID}`
    )
  }
}

function applyContextAnalysis(analysis: TokenAnalysis, contextResult: ContextAnalysisResult): void {
  if (contextResult.contextBreakdown) {
    analysis.contextBreakdown = contextResult.contextBreakdown
  }
  if (contextResult.toolEstimates) {
    analysis.toolEstimates = contextResult.toolEstimates
  }
  if (contextResult.cacheEfficiency) {
    analysis.cacheEfficiency = contextResult.cacheEfficiency
  }
}

export async function attachConfiguredAnalyses(input: {
  analysis: TokenAnalysis
  messages: SessionMessage[]
  sessionID: string
  tokenModel: TokenModel
  providerID: string
  modelID: string
  pricingModelName: string
  includeSubagents?: boolean
  config: TokenscopeConfig
  costCalculator: CostCalculator
  subagentAnalyzer: SubagentAnalyzer
  contextAnalyzer: ContextAnalyzer
  skillAnalyzer: SkillAnalyzer
}): Promise<void> {
  const shouldIncludeSubagents = input.includeSubagents !== false && input.config.enableSubagentAnalysis
  if (shouldIncludeSubagents) {
    input.analysis.subagentAnalysis = await input.subagentAnalyzer.analyzeChildSessions(input.sessionID)
  }

  const pricing = input.costCalculator.getPricing(input.pricingModelName)
  const contextResult = await input.contextAnalyzer.analyze(
    input.sessionID,
    input.tokenModel,
    pricing,
    input.config,
    input.providerID,
    input.modelID
  )
  applyContextAnalysis(input.analysis, contextResult)

  if (input.config.enableSkillAnalysis) {
    input.analysis.skillAnalysis = await input.skillAnalyzer.analyze(
      input.messages,
      input.providerID,
      input.modelID,
      input.tokenModel,
      input.config
    )
  }
}
