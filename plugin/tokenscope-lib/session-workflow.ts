import type { ContextAnalysisResult, SessionInfo, SessionMessage, TokenAnalysis, TokenModel, TokenscopeConfig } from "./types.js"
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
      `Pricing for '${pricingModelName}' was not found in models.json. Cost estimates use the default fallback rates ($1/M input, $3/M output, no cache pricing).`,
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
        `Pricing for '${modelPricingName}' was not found in models.json. Cost estimates for that model use the default fallback rates ($1/M input, $3/M output, no cache pricing).`,
        `missing-pricing:${modelPricingName}`
      )
    }
  }
}

function safeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : undefined
}

export function applySessionInfoTotals(analysis: TokenAnalysis, sessionInfo: SessionInfo | undefined): void {
  if (!sessionInfo) return

  const tokens = sessionInfo.tokens
  const aggregateTokenActivity = tokens
    ? (safeNumber(tokens.input) ?? 0) +
      (safeNumber(tokens.output) ?? 0) +
      (safeNumber(tokens.reasoning) ?? 0) +
      (safeNumber(tokens.cache?.read) ?? 0) +
      (safeNumber(tokens.cache?.write) ?? 0)
    : 0
  const telemetryTokenActivity =
    analysis.inputTokens +
    analysis.outputTokens +
    analysis.reasoningTokens +
    analysis.cacheReadTokens +
    analysis.cacheWriteTokens
  const shouldApplyTokens = Boolean(tokens && (aggregateTokenActivity > 0 || telemetryTokenActivity === 0))

  if (tokens && shouldApplyTokens) {
    analysis.inputTokens = safeNumber(tokens.input) ?? analysis.inputTokens
    analysis.outputTokens = safeNumber(tokens.output) ?? analysis.outputTokens
    analysis.reasoningTokens = safeNumber(tokens.reasoning) ?? analysis.reasoningTokens
    analysis.cacheReadTokens = safeNumber(tokens.cache?.read) ?? analysis.cacheReadTokens
    analysis.cacheWriteTokens = safeNumber(tokens.cache?.write) ?? analysis.cacheWriteTokens
  }

  const cost = safeNumber(sessionInfo.cost)
  if (cost !== undefined && (cost > 0 || shouldApplyTokens || telemetryTokenActivity === 0)) {
    analysis.sessionCost = cost
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
  const contextResult = await input.contextAnalyzer.analyze(input.sessionID, input.tokenModel, pricing, input.config)
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
