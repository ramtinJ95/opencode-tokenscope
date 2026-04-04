// SubagentAnalyzer - analyzes child sessions from Task tool calls

import type { SessionMessage, SubagentSummary, SubagentAnalysis, ChildSession } from "./types"
import { CostCalculator } from "./cost"
import { fetchSessionChildren, fetchSessionMessages, unwrapResponseData } from "./opencode"
import { summarizeTelemetry } from "./telemetry"
import { WarningCollector, formatErrorMessage } from "./warnings"

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
        if (message.info.providerID) providerID = message.info.providerID
        if (message.info.modelID) modelName = message.info.modelID
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
      const pricingModelName = this.costCalculator.buildLookupKey(providerID, modelName) || modelName
      const pricing = this.costCalculator.getPricing(pricingModelName)
      const estimatedCost =
        (inputTokens / 1_000_000) * pricing.input +
        ((outputTokens + reasoningTokens) / 1_000_000) * pricing.output +
        (cacheReadTokens / 1_000_000) * pricing.cacheRead +
        (cacheWriteTokens / 1_000_000) * pricing.cacheWrite

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
