// SubagentAnalyzer - analyzes child sessions from Task tool calls

import type { SessionMessage, SubagentSummary, SubagentAnalysis, ChildSession } from "./types.js"
import { CostCalculator } from "./cost.js"
import { fetchSessionChildren, fetchSessionMessages, unwrapResponseData } from "./opencode.js"
import { summarizeTelemetry } from "./telemetry.js"
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

      if (!Array.isArray(messages) || messages.length === 0) return null

      const agentType = this.extractAgentType(child.title)
      const telemetry = summarizeTelemetry(messages)
      let providerID = ""
      let modelName = "unknown"

      for (const message of messages) {
        if (message.info.role !== "assistant") continue
        const messageProviderID = message.info.providerID ?? message.info.model?.providerID
        const messageModelID = message.info.modelID ?? message.info.model?.modelID ?? message.info.model?.id

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
      const estimatedCost = telemetry.perModelUsage.reduce((sum, modelUsage) => {
        const pricingModelName = this.costCalculator.buildLookupKey(modelUsage.providerID, modelUsage.modelID) || modelUsage.modelName
        if (!this.costCalculator.hasPricing(pricingModelName)) {
          this.warnings?.add(
            `Pricing for child session model '${pricingModelName}' was not found in models.json. Subagent cost estimates for that model use the default fallback rates ($1/M input, $3/M output, no cache pricing).`,
            `missing-subagent-pricing:${pricingModelName}`
          )
        }
        const pricing = this.costCalculator.getPricing(pricingModelName)
        return (
          sum +
          (modelUsage.inputTokens / 1_000_000) * pricing.input +
          ((modelUsage.outputTokens + modelUsage.reasoningTokens) / 1_000_000) * pricing.output +
          (modelUsage.cacheReadTokens / 1_000_000) * pricing.cacheRead +
          (modelUsage.cacheWriteTokens / 1_000_000) * pricing.cacheWrite
        )
      }, 0)

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

  private extractAgentType(title: string): string {
    const match = title.match(/@([A-Za-z0-9._-]+)\s+subagent/i)
    if (match) return match[1]
    const words = title.split(/\s+/)
    return words[0]?.toLowerCase() || "subagent"
  }
}
