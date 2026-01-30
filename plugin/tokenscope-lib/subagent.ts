// SubagentAnalyzer - analyzes child sessions from Task tool calls

import type { SessionMessage, SubagentSummary, SubagentAnalysis, ChildSession } from "./types"
import { CostCalculator } from "./cost"

export class SubagentAnalyzer {
  constructor(
    private client: any,
    private costCalculator: CostCalculator
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
      const childrenResponse = await this.client.session.children({ path: { id: parentSessionID } })
      const children: ChildSession[] = ((childrenResponse as any)?.data ?? childrenResponse ?? []) as ChildSession[]

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
          result.totalApiCalls += summary.assistantMessageCount
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
      console.error(`Failed to fetch child sessions for ${parentSessionID}:`, error)
    }

    return result
  }

  private async analyzeChildSession(child: ChildSession): Promise<SubagentSummary | null> {
    try {
      const messagesResponse = await this.client.session.messages({ path: { id: child.id } })
      const messages: SessionMessage[] = ((messagesResponse as any)?.data ?? messagesResponse ?? []) as SessionMessage[]

      if (!Array.isArray(messages) || messages.length === 0) return null

      const agentType = this.extractAgentType(child.title)
      let inputTokens = 0,
        outputTokens = 0,
        reasoningTokens = 0
      let cacheReadTokens = 0,
        cacheWriteTokens = 0
      let apiCost = 0,
        assistantMessageCount = 0,
        modelName = "unknown"

      for (const message of messages) {
        if (message.info.role === "assistant") {
          assistantMessageCount++
          const tokens = message.info.tokens
          if (tokens) {
            inputTokens += Number(tokens.input) || 0
            outputTokens += Number(tokens.output) || 0
            reasoningTokens += Number(tokens.reasoning) || 0
            cacheReadTokens += Number(tokens.cache?.read) || 0
            cacheWriteTokens += Number(tokens.cache?.write) || 0
          }
          apiCost += Number(message.info.cost) || 0
          if (message.info.modelID) modelName = message.info.modelID
        }
      }

      const totalTokens = inputTokens + outputTokens + reasoningTokens + cacheReadTokens + cacheWriteTokens
      const pricing = this.costCalculator.getPricing(modelName)
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
      }
    } catch (error) {
      console.error(`Failed to analyze child session ${child.id}:`, error)
      return null
    }
  }

  private extractAgentType(title: string): string {
    const match = title.match(/@(\w+)\s+subagent/i)
    if (match) return match[1]
    const words = title.split(/\s+/)
    return words[0]?.toLowerCase() || "subagent"
  }
}
