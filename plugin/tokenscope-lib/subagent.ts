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

      if (!Array.isArray(messages)) return null

      const agentType = this.extractAgentType(child.title)
      const telemetry = summarizeTelemetry(messages)
      const { providerID, modelName } = this.resolveChildModel(child, messages)

      const telemetryTokens = {
        inputTokens: telemetry.inputTokens,
        outputTokens: telemetry.outputTokens,
        reasoningTokens: telemetry.reasoningTokens,
        cacheReadTokens: telemetry.cacheReadTokens,
        cacheWriteTokens: telemetry.cacheWriteTokens,
      }
      const sessionTokens = this.readSessionTokens(child.tokens)
      const sessionTokensHaveActivity = sessionTokens ? this.totalTokens(sessionTokens) > 0 : false
      const telemetryHasActivity = this.totalTokens(telemetryTokens) > 0 || telemetry.sessionCost > 0
      const sessionTokensAreConsistent = sessionTokens
        ? !this.hasInconsistentAggregateBuckets(sessionTokens, telemetryTokens)
        : true
      const effectiveSessionTokens =
        sessionTokens && sessionTokensAreConsistent && (sessionTokensHaveActivity || !telemetryHasActivity)
          ? sessionTokens
          : null
      const childCost = this.safeNumber(child.cost)
      const childCostIsConsistent = childCost === undefined || telemetry.sessionCost === 0 || childCost >= telemetry.sessionCost
      const apiCost =
        childCost !== undefined && childCostIsConsistent && (childCost > 0 || !telemetryHasActivity)
          ? childCost
          : telemetry.sessionCost

      const assistantMessageCount = telemetry.assistantMessageCount
      const apiCallCount = telemetry.apiCallCount
      const finalInputTokens = effectiveSessionTokens?.inputTokens ?? telemetryTokens.inputTokens
      const finalOutputTokens = effectiveSessionTokens?.outputTokens ?? telemetryTokens.outputTokens
      const finalReasoningTokens = effectiveSessionTokens?.reasoningTokens ?? telemetryTokens.reasoningTokens
      const finalCacheReadTokens = effectiveSessionTokens?.cacheReadTokens ?? telemetryTokens.cacheReadTokens
      const finalCacheWriteTokens = effectiveSessionTokens?.cacheWriteTokens ?? telemetryTokens.cacheWriteTokens
      const totalTokens =
        finalInputTokens + finalOutputTokens + finalReasoningTokens + finalCacheReadTokens + finalCacheWriteTokens
      if (messages.length === 0 && totalTokens === 0 && apiCost === 0) return null
      const fallbackPricingModelName = this.costCalculator.buildLookupKey(providerID, modelName) || modelName
      const costUsage = this.buildCostUsage(telemetry.perModelUsage, fallbackPricingModelName, {
        inputTokens: finalInputTokens,
        outputTokens: finalOutputTokens,
        reasoningTokens: finalReasoningTokens,
        cacheReadTokens: finalCacheReadTokens,
        cacheWriteTokens: finalCacheWriteTokens,
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

  private resolveChildModel(child: ChildSession, messages: SessionMessage[]): { providerID: string; modelName: string } {
    let providerID = this.normalizeString(child.providerID ?? child.model?.providerID) ?? ""
    let modelName = this.normalizeString(child.modelID ?? child.model?.modelID ?? child.model?.id) ?? "unknown"

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

  private readSessionTokens(tokens: TokenUsage | undefined): {
    inputTokens?: number
    outputTokens?: number
    reasoningTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
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
      inputTokens,
      outputTokens,
      reasoningTokens,
      cacheReadTokens,
      cacheWriteTokens,
    }
  }

  private buildCostUsage(
    telemetryUsage: Array<{
      modelName: string
      providerID?: string
      modelID?: string
      inputTokens: number
      outputTokens: number
      reasoningTokens: number
      cacheReadTokens: number
      cacheWriteTokens: number
      apiCost: number
      apiCallCount: number
      callsWithCacheRead: number
      callsWithCacheWrite: number
      calls?: Array<{
        inputTokens: number
        outputTokens: number
        reasoningTokens: number
        cacheReadTokens: number
        cacheWriteTokens: number
      }>
    }>,
    fallbackPricingModelName: string,
    aggregate: {
      inputTokens: number
      outputTokens: number
      reasoningTokens: number
      cacheReadTokens: number
      cacheWriteTokens: number
    }
  ) {
    if (telemetryUsage.length === 0) {
      return [this.buildFallbackUsage(fallbackPricingModelName, aggregate)]
    }

    const totals = telemetryUsage.reduce(
      (sum, usage) => ({
        inputTokens: sum.inputTokens + usage.inputTokens,
        outputTokens: sum.outputTokens + usage.outputTokens,
        reasoningTokens: sum.reasoningTokens + usage.reasoningTokens,
        cacheReadTokens: sum.cacheReadTokens + usage.cacheReadTokens,
        cacheWriteTokens: sum.cacheWriteTokens + usage.cacheWriteTokens,
      }),
      { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
    )

    const delta = {
      inputTokens: Math.max(0, aggregate.inputTokens - totals.inputTokens),
      outputTokens: Math.max(0, aggregate.outputTokens - totals.outputTokens),
      reasoningTokens: Math.max(0, aggregate.reasoningTokens - totals.reasoningTokens),
      cacheReadTokens: Math.max(0, aggregate.cacheReadTokens - totals.cacheReadTokens),
      cacheWriteTokens: Math.max(0, aggregate.cacheWriteTokens - totals.cacheWriteTokens),
    }

    const deltaTotal =
      delta.inputTokens + delta.outputTokens + delta.reasoningTokens + delta.cacheReadTokens + delta.cacheWriteTokens

    if (deltaTotal === 0) return telemetryUsage

    return [...telemetryUsage, this.buildFallbackUsage(fallbackPricingModelName, delta)]
  }

  private buildFallbackUsage(
    fallbackPricingModelName: string,
    usage: {
      inputTokens: number
      outputTokens: number
      reasoningTokens: number
      cacheReadTokens: number
      cacheWriteTokens: number
    }
  ) {
    return {
      modelName: fallbackPricingModelName,
      ...usage,
      apiCost: 0,
      apiCallCount: 0,
      callsWithCacheRead: usage.cacheReadTokens > 0 ? 1 : 0,
      callsWithCacheWrite: usage.cacheWriteTokens > 0 ? 1 : 0,
    }
  }

  private totalTokens(usage: {
    inputTokens?: number
    outputTokens?: number
    reasoningTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
  }): number {
    return (
      (usage.inputTokens ?? 0) +
      (usage.outputTokens ?? 0) +
      (usage.reasoningTokens ?? 0) +
      (usage.cacheReadTokens ?? 0) +
      (usage.cacheWriteTokens ?? 0)
    )
  }

  private hasInconsistentAggregateBuckets(
    aggregate: {
      inputTokens?: number
      outputTokens?: number
      reasoningTokens?: number
      cacheReadTokens?: number
      cacheWriteTokens?: number
    },
    telemetry: {
      inputTokens: number
      outputTokens: number
      reasoningTokens: number
      cacheReadTokens: number
      cacheWriteTokens: number
    }
  ): boolean {
    return (
      (aggregate.inputTokens !== undefined && aggregate.inputTokens < telemetry.inputTokens) ||
      (aggregate.outputTokens !== undefined && aggregate.outputTokens < telemetry.outputTokens) ||
      (aggregate.reasoningTokens !== undefined && aggregate.reasoningTokens < telemetry.reasoningTokens) ||
      (aggregate.cacheReadTokens !== undefined && aggregate.cacheReadTokens < telemetry.cacheReadTokens) ||
      (aggregate.cacheWriteTokens !== undefined && aggregate.cacheWriteTokens < telemetry.cacheWriteTokens)
    )
  }

  private safeNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : undefined
  }

  private normalizeString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined
  }
}
