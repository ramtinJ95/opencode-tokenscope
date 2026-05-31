// SubagentAnalyzer - analyzes child sessions from Task tool calls

import type { SessionMessage, SubagentSummary, SubagentAnalysis, ChildSession } from "./types.js"
import { CostCalculator } from "./cost.js"
import { fetchSessionChildren, fetchSessionMessages, tryFetchSessionInfo, unwrapResponseData } from "./opencode.js"
import { summarizeTelemetry } from "./telemetry.js"
import {
  hasLowerAggregateBucket,
  hasTokenActivity,
  mergeTokenBuckets,
  readTokenBuckets,
  safeTokenNumber,
  totalTokenBuckets,
} from "./usage-buckets.js"
import { WarningCollector, formatErrorMessage } from "./warnings.js"

export class SubagentAnalyzer {
  constructor(
    private client: any,
    private costCalculator: CostCalculator,
    private warnings?: WarningCollector
  ) {}

  async analyzeChildSessions(parentSessionID: string): Promise<SubagentAnalysis> {
    const result: SubagentAnalysis = {
      subagents: [],
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalReasoningTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      totalTokens: 0,
      totalApiCost: 0,
      totalEstimatedCost: 0,
      totalApiCalls: 0,
    }

    try {
      const childrenResponse = await fetchSessionChildren(this.client, parentSessionID)
      const children: ChildSession[] = unwrapResponseData<ChildSession[]>(childrenResponse ?? [])

      if (!Array.isArray(children) || children.length === 0) return result

      for (const child of children) {
        const summary = await this.analyzeChildSession(child)
        if (summary) {
          result.subagents.push(summary)
          result.totalInputTokens += summary.inputTokens
          result.totalOutputTokens += summary.outputTokens
          result.totalReasoningTokens += summary.reasoningTokens
          result.totalCacheReadTokens += summary.cacheReadTokens
          result.totalCacheWriteTokens += summary.cacheWriteTokens
          result.totalTokens += summary.totalTokens
          result.totalApiCost += summary.apiCost
          result.totalEstimatedCost += summary.estimatedCost
          result.totalApiCalls += summary.apiCallCount
        }

        const nestedAnalysis = await this.analyzeChildSessions(child.id)
        for (const nested of nestedAnalysis.subagents) {
          result.subagents.push(nested)
        }
        result.totalInputTokens += nestedAnalysis.totalInputTokens
        result.totalOutputTokens += nestedAnalysis.totalOutputTokens
        result.totalReasoningTokens += nestedAnalysis.totalReasoningTokens
        result.totalCacheReadTokens += nestedAnalysis.totalCacheReadTokens
        result.totalCacheWriteTokens += nestedAnalysis.totalCacheWriteTokens
        result.totalTokens += nestedAnalysis.totalTokens
        result.totalApiCost += nestedAnalysis.totalApiCost
        result.totalEstimatedCost += nestedAnalysis.totalEstimatedCost
        result.totalApiCalls += nestedAnalysis.totalApiCalls
      }
    } catch (error) {
      this.warnings?.add(
        `Subagent analysis was skipped for session ${parentSessionID}: ${formatErrorMessage(error)}`,
        `subagent-root:${parentSessionID}`
      )
    }

    return result
  }

  private async analyzeChildSession(child: ChildSession): Promise<SubagentSummary | null> {
    try {
      const messagesResponse = await fetchSessionMessages(this.client, child.id)
      const messages: SessionMessage[] = unwrapResponseData<SessionMessage[]>(messagesResponse ?? [])

      if (!Array.isArray(messages)) return null

      const effectiveChild = await this.resolveEffectiveChildSession(child, messages)
      const agentType = this.extractAgentType(effectiveChild.title)
      const telemetry = summarizeTelemetry(messages)
      const { providerID, modelName } = this.resolveChildModel(effectiveChild, messages)

      const telemetryTokens = {
        inputTokens: telemetry.inputTokens,
        outputTokens: telemetry.outputTokens,
        reasoningTokens: telemetry.reasoningTokens,
        cacheReadTokens: telemetry.cacheReadTokens,
        cacheWriteTokens: telemetry.cacheWriteTokens,
      }
      const sessionTokens = readTokenBuckets(effectiveChild.tokens)
      const sessionTokensHaveActivity = hasTokenActivity(sessionTokens)
      const telemetryHasActivity = hasTokenActivity(telemetryTokens) || telemetry.sessionCost > 0
      const sessionTokensAreConsistent = sessionTokens ? !hasLowerAggregateBucket(sessionTokens, telemetryTokens) : true
      const effectiveSessionTokens =
        sessionTokens && sessionTokensAreConsistent && (sessionTokensHaveActivity || !telemetryHasActivity)
          ? sessionTokens
          : null
      const childCost = safeTokenNumber(effectiveChild.cost)
      const childCostIsConsistent = childCost === undefined || telemetry.sessionCost === 0 || childCost >= telemetry.sessionCost
      const apiCost =
        childCost !== undefined && childCostIsConsistent && (childCost > 0 || !telemetryHasActivity)
          ? childCost
          : telemetry.sessionCost

      const assistantMessageCount = telemetry.assistantMessageCount
      const apiCallCount = telemetry.apiCallCount
      const finalTokens = mergeTokenBuckets(effectiveSessionTokens, telemetryTokens)
      const totalTokens = totalTokenBuckets(finalTokens)
      if (messages.length === 0 && totalTokens === 0 && apiCost === 0) return null
      const fallbackPricingModelName = this.costCalculator.buildLookupKey(providerID, modelName) || modelName
      const costUsage = this.costCalculator.reconcileAggregateUsage(telemetry.perModelUsage, fallbackPricingModelName, {
        inputTokens: finalTokens.inputTokens,
        outputTokens: finalTokens.outputTokens,
        reasoningTokens: finalTokens.reasoningTokens,
        cacheReadTokens: finalTokens.cacheReadTokens,
        cacheWriteTokens: finalTokens.cacheWriteTokens,
      })
      const estimatedCost = costUsage.reduce((sum, modelUsage) => {
        const pricingModelName = this.costCalculator.resolvePricingModelName(modelUsage, fallbackPricingModelName)
        if (!this.costCalculator.hasPricing(pricingModelName)) {
          this.warnings?.add(
            `Pricing for child session model '${pricingModelName}' was not found in models.json. Subagent cost estimates for that model use the default fallback rates ($1/M input, $3/M output, no cache pricing).`,
            `missing-subagent-pricing:${pricingModelName}`
          )
        }
        return sum + this.costCalculator.calculateModelUsageCost(modelUsage, fallbackPricingModelName)
      }, 0)

      return {
        sessionID: effectiveChild.id,
        title: effectiveChild.title,
        agentType,
        inputTokens: finalTokens.inputTokens,
        outputTokens: finalTokens.outputTokens,
        reasoningTokens: finalTokens.reasoningTokens,
        cacheReadTokens: finalTokens.cacheReadTokens,
        cacheWriteTokens: finalTokens.cacheWriteTokens,
        totalTokens,
        apiCost,
        estimatedCost,
        assistantMessageCount,
        apiCallCount,
      }
    } catch (error) {
      this.warnings?.add(
        `A child session could not be analyzed (${child.id}): ${formatErrorMessage(error)}`,
        `subagent-child:${child.id}`
      )
      return null
    }
  }

  private async resolveEffectiveChildSession(child: ChildSession, messages: SessionMessage[]): Promise<ChildSession> {
    if (messages.length > 0 || this.hasChildModelMetadata(child)) return child

    const response = await tryFetchSessionInfo(this.client, child.id)
    const sessionInfo = unwrapResponseData<Partial<ChildSession> | undefined>(response)
    if (!sessionInfo) return child

    return {
      ...sessionInfo,
      ...child,
      title: child.title ?? sessionInfo.title ?? "subagent",
      model: child.model ?? sessionInfo.model,
      providerID: child.providerID ?? sessionInfo.providerID,
      modelID: child.modelID ?? sessionInfo.modelID,
      tokens: child.tokens ?? sessionInfo.tokens,
      cost: child.cost ?? sessionInfo.cost,
    }
  }

  private hasChildModelMetadata(child: ChildSession): boolean {
    return Boolean(
      this.normalizeString(child.model?.providerID ?? child.providerID) &&
        this.normalizeString(child.model?.id ?? child.modelID)
    )
  }

  private extractAgentType(title: string): string {
    const match = title.match(/@([A-Za-z0-9._-]+)\s+subagent/i)
    if (match) return match[1]
    const words = title.split(/\s+/)
    return words[0]?.toLowerCase() || "subagent"
  }

  private resolveChildModel(child: ChildSession, messages: SessionMessage[]): { providerID: string; modelName: string } {
    let providerID = this.normalizeString(child.providerID ?? child.model?.providerID) ?? ""
    let modelName = this.normalizeString(child.model?.id ?? child.modelID) ?? "unknown"

    for (const message of messages) {
      if (message.info.role !== "assistant") continue
      const messageProviderID = this.normalizeString(
        message.info.providerID ??
          message.info.model?.providerID ??
          message.data?.providerID ??
          message.data?.model?.providerID ??
          message.providerID ??
          message.model?.providerID
      )
      const messageModelID = this.normalizeString(
        message.info.modelID ??
          message.info.model?.modelID ??
          message.info.model?.id ??
          message.data?.modelID ??
          message.data?.model?.modelID ??
          message.data?.model?.id ??
          message.modelID ??
          message.model?.modelID ??
          message.model?.id
      )

      if (messageProviderID) providerID = messageProviderID
      if (messageModelID) modelName = messageModelID
    }

    return { providerID, modelName }
  }

  private normalizeString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined
  }
}
