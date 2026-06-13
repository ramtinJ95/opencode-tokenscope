// SubagentAnalyzer - analyzes child sessions from Task tool calls

import type { SessionMessage, SubagentSummary, SubagentAnalysis, ChildSession, EstimatedCostComponents } from "./types.js"
import { CostCalculator } from "./cost.js"
import { fetchSessionChildren, fetchSessionMessages, type RoutingParams, unwrapResponseData } from "./opencode.js"
import { summarizeTelemetry } from "./telemetry.js"
import { WarningCollector, formatErrorMessage } from "./warnings.js"

export class SubagentAnalyzer {
  constructor(
    private client: any,
    private costCalculator: CostCalculator,
    private warnings?: WarningCollector,
    private routing: RoutingParams = {}
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
      estimatedInputCost: 0,
      estimatedOutputCost: 0,
      estimatedCacheReadCost: 0,
      estimatedCacheWriteCost: 0,
    }

    try {
      const childrenResponse = await fetchSessionChildren(this.client, parentSessionID, this.routing)
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
          result.estimatedInputCost += summary.estimatedInputCost
          result.estimatedOutputCost += summary.estimatedOutputCost
          result.estimatedCacheReadCost += summary.estimatedCacheReadCost
          result.estimatedCacheWriteCost += summary.estimatedCacheWriteCost
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
        result.estimatedInputCost += nestedAnalysis.estimatedInputCost
        result.estimatedOutputCost += nestedAnalysis.estimatedOutputCost
        result.estimatedCacheReadCost += nestedAnalysis.estimatedCacheReadCost
        result.estimatedCacheWriteCost += nestedAnalysis.estimatedCacheWriteCost
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
      const messagesResponse = await fetchSessionMessages(this.client, child.id, this.routing)
      const messages: SessionMessage[] = unwrapResponseData<SessionMessage[]>(messagesResponse ?? [])

      if (!Array.isArray(messages) || messages.length === 0) return null

      const agentType = this.extractAgentType(child.title)
      const telemetry = summarizeTelemetry(messages)
      let providerID = ""
      let modelName = "unknown"

      for (const message of messages) {
        if (message.info.role !== "assistant") continue
        const messageProviderID =
          message.data?.providerID ??
          message.data?.model?.providerID ??
          message.info.providerID ??
          message.info.model?.providerID ??
          message.providerID ??
          message.model?.providerID
        const messageModelID =
          message.data?.modelID ??
          message.data?.model?.modelID ??
          message.data?.model?.id ??
          message.info.modelID ??
          message.info.model?.modelID ??
          message.info.model?.id ??
          message.modelID ??
          message.model?.modelID ??
          message.model?.id

        if (messageProviderID) providerID = messageProviderID
        if (messageModelID) modelName = messageModelID
      }

      const inputTokens = telemetry.inputTokens
      const outputTokens = telemetry.outputTokens
      const reasoningTokens = telemetry.reasoningTokens
      const cacheReadTokens = telemetry.cacheReadTokens
      const cacheWriteTokens = telemetry.cacheWriteTokens
      const apiCost = telemetry.sessionCost
      const assistantMessageCount = telemetry.assistantMessageCount
      const apiCallCount = telemetry.apiCallCount
      const totalTokens = inputTokens + outputTokens + reasoningTokens + cacheReadTokens + cacheWriteTokens
      const fallbackPricingModelName = this.costCalculator.buildLookupKey(providerID, modelName) || modelName
      const estimatedCosts = telemetry.perModelUsage.reduce<EstimatedCostComponents & { estimatedCost: number }>((sum, modelUsage) => {
        const pricingModelName = this.costCalculator.resolvePricingModelName(modelUsage, fallbackPricingModelName)
        if (!this.costCalculator.hasPricing(pricingModelName)) {
          this.warnings?.add(
            `Pricing for child session model '${pricingModelName}' was not found in OpenCode metadata or models.json. Subagent cost estimates for that model use the default fallback rates ($1/M input, $3/M output, no cache pricing).`,
            `missing-subagent-pricing:${pricingModelName}`
          )
        }
        const pricing = this.costCalculator.getPricing(pricingModelName)
        const usageCost = this.costCalculator.calculateModelUsageCost(modelUsage, pricing)

        sum.estimatedCost += usageCost.estimatedSessionCost
        sum.estimatedInputCost += usageCost.estimatedInputCost
        sum.estimatedOutputCost += usageCost.estimatedOutputCost
        sum.estimatedCacheReadCost += usageCost.estimatedCacheReadCost
        sum.estimatedCacheWriteCost += usageCost.estimatedCacheWriteCost
        return sum
      }, {
        estimatedCost: 0,
        estimatedInputCost: 0,
        estimatedOutputCost: 0,
        estimatedCacheReadCost: 0,
        estimatedCacheWriteCost: 0,
      })

      return {
        sessionID: child.id,
        title: child.title,
        agentType,
        inputTokens,
        outputTokens,
        reasoningTokens,
        cacheReadTokens,
        cacheWriteTokens,
        totalTokens,
        apiCost,
        estimatedCost: estimatedCosts.estimatedCost,
        estimatedInputCost: estimatedCosts.estimatedInputCost,
        estimatedOutputCost: estimatedCosts.estimatedOutputCost,
        estimatedCacheReadCost: estimatedCosts.estimatedCacheReadCost,
        estimatedCacheWriteCost: estimatedCosts.estimatedCacheWriteCost,
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

  private extractAgentType(title: string): string {
    const match = title.match(/@([A-Za-z0-9._-]+)\s+subagent/i)
    if (match) return match[1]
    const words = title.split(/\s+/)
    return words[0]?.toLowerCase() || "subagent"
  }
}
