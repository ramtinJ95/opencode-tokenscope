import type { ContextAnalysisResult, SessionInfo, SessionMessage, TokenAnalysis, TokenModel, TokenscopeConfig } from "./types.js"
import { CostCalculator } from "./cost.js"
import { SubagentAnalyzer } from "./subagent.js"
import { ContextAnalyzer } from "./context.js"
import { SkillAnalyzer } from "./skill.js"
import { OutputFormatter } from "./formatter.js"
import { buildSuccessSummary, writeReport } from "./report.js"
import {
  completeTokenBuckets,
  hasLowerAggregateBucket,
  hasTokenActivity,
  readTokenBuckets,
  safeTokenNumber,
  totalTokenBuckets,
} from "./usage-buckets.js"
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

function emptyCategory(label: string) {
  return { label, totalTokens: 0, entries: [], allEntries: [] }
}

function sessionProviderID(sessionInfo: SessionInfo | undefined): string | undefined {
  return sessionInfo?.providerID?.trim() || sessionInfo?.model?.providerID?.trim() || undefined
}

function sessionModelID(sessionInfo: SessionInfo | undefined): string | undefined {
  return sessionInfo?.modelID?.trim() || sessionInfo?.model?.modelID?.trim() || sessionInfo?.model?.id?.trim() || undefined
}

export function hasSessionInfoAggregateActivity(sessionInfo: SessionInfo | undefined): boolean {
  const buckets = readTokenBuckets(sessionInfo?.tokens)
  return hasTokenActivity(buckets) || (safeTokenNumber(sessionInfo?.cost) ?? 0) > 0
}

export function buildAggregateOnlyAnalysis(input: {
  sessionID: string
  sessionInfo: SessionInfo
  tokenModel: TokenModel
  pricingModelName: string
}): TokenAnalysis {
  const buckets = completeTokenBuckets(readTokenBuckets(input.sessionInfo.tokens))
  const { inputTokens, outputTokens, reasoningTokens, cacheReadTokens, cacheWriteTokens } = buckets
  const providerID = sessionProviderID(input.sessionInfo)
  const modelID = sessionModelID(input.sessionInfo)
  const sessionCost = safeTokenNumber(input.sessionInfo.cost) ?? 0
  const hasTokens = hasTokenActivity(buckets)

  return {
    sessionID: input.sessionID,
    model: input.tokenModel,
    pricingModelName: input.pricingModelName,
    categories: {
      system: emptyCategory("system"),
      user: emptyCategory("user"),
      assistant: emptyCategory("assistant"),
      tools: emptyCategory("tools"),
      reasoning: emptyCategory("reasoning"),
    },
    totalTokens: 0,
    inputTokens,
    outputTokens,
    reasoningTokens,
    cacheReadTokens,
    cacheWriteTokens,
    assistantMessageCount: 0,
    apiCallCount: 0,
    callsWithCacheRead: 0,
    callsWithCacheWrite: 0,
    mostRecentInput: 0,
    mostRecentOutput: 0,
    mostRecentReasoning: 0,
    mostRecentCacheRead: 0,
    mostRecentCacheWrite: 0,
    sessionCost,
    mostRecentCost: 0,
    allToolsCalled: [],
    toolCallCounts: new Map(),
    perModelUsage: hasTokens
      ? [
          {
            providerID,
            modelID,
            modelName: input.pricingModelName,
            inputTokens,
            outputTokens,
            reasoningTokens,
            cacheReadTokens,
            cacheWriteTokens,
            apiCost: sessionCost,
            apiCallCount: 0,
            callsWithCacheRead: 0,
            callsWithCacheWrite: 0,
          },
        ]
      : [],
    warnings: [],
  }
}

export function applySessionInfoTotals(analysis: TokenAnalysis, sessionInfo: SessionInfo | undefined): void {
  if (!sessionInfo) return

  const tokens = readTokenBuckets(sessionInfo.tokens)
  const telemetryTokens = {
    inputTokens: analysis.inputTokens,
    outputTokens: analysis.outputTokens,
    reasoningTokens: analysis.reasoningTokens,
    cacheReadTokens: analysis.cacheReadTokens,
    cacheWriteTokens: analysis.cacheWriteTokens,
  }
  const aggregateTokenActivity = totalTokenBuckets(tokens ?? {})
  const telemetryTokenActivity = totalTokenBuckets(telemetryTokens)
  const aggregateIsConsistent = !tokens || !hasLowerAggregateBucket(tokens, telemetryTokens)
  const shouldApplyTokens = Boolean(tokens && aggregateIsConsistent && (aggregateTokenActivity > 0 || telemetryTokenActivity === 0))

  if (tokens && shouldApplyTokens) {
    analysis.inputTokens = tokens.inputTokens ?? analysis.inputTokens
    analysis.outputTokens = tokens.outputTokens ?? analysis.outputTokens
    analysis.reasoningTokens = tokens.reasoningTokens ?? analysis.reasoningTokens
    analysis.cacheReadTokens = tokens.cacheReadTokens ?? analysis.cacheReadTokens
    analysis.cacheWriteTokens = tokens.cacheWriteTokens ?? analysis.cacheWriteTokens
  }

  const cost = safeTokenNumber(sessionInfo.cost)
  const telemetryCost = safeTokenNumber(analysis.sessionCost) ?? 0
  const costIsConsistent = telemetryCost === 0 || cost === undefined || cost >= telemetryCost
  if (cost !== undefined && costIsConsistent && (cost > 0 || shouldApplyTokens || telemetryTokenActivity === 0)) {
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

export async function finalizeAnalysisReport(input: {
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
  warnings: WarningCollector
  formatter: OutputFormatter
  outputPath: string
}): Promise<string> {
  addPerModelPricingWarnings(input.warnings, input.costCalculator, input.analysis, input.pricingModelName)
  await attachConfiguredAnalyses(input)

  input.analysis.warnings = input.warnings.list()

  const output = input.formatter.format(input.analysis)
  const writeError = await writeReport(input.outputPath, output)
  if (writeError) return writeError

  return buildSuccessSummary(input.outputPath, input.analysis)
}
