// SubagentAnalyzer - analyzes child sessions from Task tool calls

import type { SessionMessage, SubagentSummary, SubagentAnalysis, ChildSession, TokenUsage } from "./types.js"
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
      const sessionTokens = this.readSessionTokens(child.tokens)
      const apiCost = this.safeNumber(child.cost) ?? telemetry.sessionCost
      const assistantMessageCount = telemetry.assistantMessageCount
      const apiCallCount = telemetry.apiCallCount
      const finalInputTokens = sessionTokens?.inputTokens ?? inputTokens
      const finalOutputTokens = sessionTokens?.outputTokens ?? outputTokens
      const finalReasoningTokens = sessionTokens?.reasoningTokens ?? reasoningTokens
      const finalCacheReadTokens = sessionTokens?.cacheReadTokens ?? cacheReadTokens
      const finalCacheWriteTokens = sessionTokens?.cacheWriteTokens ?? cacheWriteTokens
      const totalTokens =
        finalInputTokens + finalOutputTokens + finalReasoningTokens + finalCacheReadTokens + finalCacheWriteTokens
      const fallbackPricingModelName = this.costCalculator.buildLookupKey(providerID, modelName) || modelName
      const estimatedCost = telemetry.perModelUsage.reduce((sum, modelUsage) => {
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
        sessionID: child.id,
        title: child.title,
        agentType,
        inputTokens: finalInputTokens,
        outputTokens: finalOutputTokens,
        reasoningTokens: finalReasoningTokens,
        cacheReadTokens: finalCacheReadTokens,
        cacheWriteTokens: finalCacheWriteTokens,
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

  private readSessionTokens(tokens: TokenUsage | undefined): {
    inputTokens: number
    outputTokens: number
    reasoningTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
  } | null {
    if (!tokens) return null

    const inputTokens = this.safeNumber(tokens.input)
    const outputTokens = this.safeNumber(tokens.output)
    const reasoningTokens = this.safeNumber(tokens.reasoning)
    const cacheReadTokens = this.safeNumber(tokens.cache?.read)
    const cacheWriteTokens = this.safeNumber(tokens.cache?.write)

    if (
      inputTokens === undefined &&
      outputTokens === undefined &&
      reasoningTokens === undefined &&
      cacheReadTokens === undefined &&
      cacheWriteTokens === undefined
    ) {
      return null
    }

    return {
      inputTokens: inputTokens ?? 0,
      outputTokens: outputTokens ?? 0,
      reasoningTokens: reasoningTokens ?? 0,
      cacheReadTokens: cacheReadTokens ?? 0,
      cacheWriteTokens: cacheWriteTokens ?? 0,
    }
  }

  private safeNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : undefined
  }
}
