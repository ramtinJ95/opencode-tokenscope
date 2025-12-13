// ContextAnalyzer - analyzes tool definitions and system prompts from OpenCode API

import type {
  SessionMessage,
  ToolDefinition,
  ToolDefinitionAnalysis,
  ToolDefinitionsBreakdown,
  SystemPromptSection,
  SystemPromptBreakdown,
  ContextEfficiency,
  RequestComposition,
  ContextAnalysis,
  TokenModel,
} from "./types"
import { TokenizerManager } from "./tokenizer"

export class ContextAnalyzer {
  constructor(
    private client: any,
    private tokenizerManager: TokenizerManager
  ) {}

  async analyze(
    messages: SessionMessage[],
    tokenModel: TokenModel,
    mostRecentInput: number,
    mostRecentCacheRead: number,
    mostRecentCacheWrite: number
  ): Promise<ContextAnalysis> {
    // Extract provider and model from messages
    const { providerID, modelID } = this.extractProviderAndModel(messages)

    // Fetch and analyze tool definitions
    const toolDefinitions = await this.analyzeToolDefinitions(providerID, modelID, tokenModel)

    // Extract and analyze system prompt from user messages
    const systemPrompt = await this.analyzeSystemPrompt(messages, tokenModel)

    // Calculate context efficiency
    const efficiency = this.calculateEfficiency(
      toolDefinitions.totalTokens,
      systemPrompt.totalTokens,
      mostRecentInput,
      mostRecentCacheRead,
      mostRecentCacheWrite
    )

    // Calculate request composition
    const requestComposition = await this.calculateRequestComposition(
      toolDefinitions.totalTokens,
      systemPrompt.totalTokens,
      mostRecentInput,
      mostRecentCacheRead,
      messages,
      tokenModel
    )

    return {
      toolDefinitions,
      systemPrompt,
      efficiency,
      requestComposition,
      providerID,
      modelID,
    }
  }

  private extractProviderAndModel(messages: SessionMessage[]): { providerID: string; modelID: string } {
    // Look for the most recent message with provider/model info
    for (const message of [...messages].reverse()) {
      const providerID = message.info.providerID
      const modelID = message.info.modelID

      if (providerID && modelID) {
        return { providerID, modelID }
      }
    }

    return { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" }
  }

  private async analyzeToolDefinitions(
    providerID: string,
    modelID: string,
    tokenModel: TokenModel
  ): Promise<ToolDefinitionsBreakdown> {
    const tools: ToolDefinitionAnalysis[] = []
    let totalDescriptionTokens = 0
    let totalSchemaTokens = 0

    try {
      // Fetch tool definitions from the experimental API
      const response = await this.client.tool.list({
        query: { provider: providerID, model: modelID },
      })

      const toolDefs: ToolDefinition[] = ((response as any)?.data ?? response ?? []) as ToolDefinition[]

      for (const tool of toolDefs) {
        const descriptionTokens = await this.tokenizerManager.countTokens(tool.description || "", tokenModel)
        const schemaStr = JSON.stringify(tool.parameters || {})
        const schemaTokens = await this.tokenizerManager.countTokens(schemaStr, tokenModel)

        tools.push({
          id: tool.id,
          description: tool.description || "",
          descriptionTokens,
          schemaTokens,
          totalTokens: descriptionTokens + schemaTokens,
        })

        totalDescriptionTokens += descriptionTokens
        totalSchemaTokens += schemaTokens
      }

      // Sort by total tokens descending
      tools.sort((a, b) => b.totalTokens - a.totalTokens)
    } catch (error) {
      console.error("Failed to fetch tool definitions:", error)
      // Return empty breakdown if API fails
    }

    return {
      tools,
      totalDescriptionTokens,
      totalSchemaTokens,
      totalTokens: totalDescriptionTokens + totalSchemaTokens,
      toolCount: tools.length,
    }
  }

  private async analyzeSystemPrompt(messages: SessionMessage[], tokenModel: TokenModel): Promise<SystemPromptBreakdown> {
    // Extract system prompt from user messages (where it's stored according to OpenCode API)
    let rawPrompt = ""

    for (const message of messages) {
      // Check user messages for system field (string format)
      if (message.info.role === "user") {
        const userInfo = message.info as any
        if (userInfo.system && typeof userInfo.system === "string") {
          rawPrompt = userInfo.system
          break // Use the first (most complete) system prompt
        }
      }

      // Also check assistant messages for system array (legacy format)
      if (message.info.role === "assistant" && message.info.system) {
        const systemArray = message.info.system
        if (Array.isArray(systemArray) && systemArray.length > 0) {
          rawPrompt = systemArray.join("\n\n")
          break
        }
      }
    }

    if (!rawPrompt) {
      return {
        sections: [],
        totalTokens: 0,
        rawPrompt: "",
      }
    }

    // Parse the system prompt into sections
    const sections = await this.parseSystemPromptSections(rawPrompt, tokenModel)
    const totalTokens = sections.reduce((sum, section) => sum + section.tokens, 0)

    return {
      sections,
      totalTokens,
      rawPrompt,
    }
  }

  private async parseSystemPromptSections(
    rawPrompt: string,
    tokenModel: TokenModel
  ): Promise<SystemPromptSection[]> {
    const sections: SystemPromptSection[] = []

    // Define section patterns to identify different parts of the system prompt
    const sectionPatterns: Array<{
      label: string
      description: string
      pattern: RegExp
    }> = [
      {
        label: "Identity & Role",
        description: "Defines who the AI is and its primary purpose",
        pattern: /^You are (?:Claude Code|OpenCode)[^]*?(?=\n\n#|\n\nWhen|\n\nIMPORTANT|$)/i,
      },
      {
        label: "Tone & Style",
        description: "Guidelines for communication style and formatting",
        pattern: /# Tone and style[^]*?(?=\n\n#|$)/i,
      },
      {
        label: "Professional Objectivity",
        description: "Instructions for technical accuracy and honest feedback",
        pattern: /# Professional objectivity[^]*?(?=\n\n#|$)/i,
      },
      {
        label: "Task Management",
        description: "Instructions for using todo tools and tracking progress",
        pattern: /# Task Management[^]*?(?=\n\n#|$)/i,
      },
      {
        label: "Doing Tasks",
        description: "Guidelines for executing software engineering tasks",
        pattern: /# Doing tasks[^]*?(?=\n\n#|$)/i,
      },
      {
        label: "Tool Usage Policy",
        description: "Rules for when and how to use available tools",
        pattern: /# Tool usage policy[^]*?(?=\n\n#|$)/i,
      },
      {
        label: "Code References",
        description: "Guidelines for referencing code locations",
        pattern: /# Code References[^]*?(?=\n\n#|$)/i,
      },
      {
        label: "Environment Info",
        description: "Current working directory, platform, date, git status",
        pattern: /<env>[^]*?<\/env>/i,
      },
      {
        label: "Project Files",
        description: "List of files in the current project",
        pattern: /<files>[^]*?<\/files>/i,
      },
      {
        label: "Custom Instructions",
        description: "User-defined instructions from AGENTS.md or CLAUDE.md",
        pattern: /Instructions from:[^]*?(?=\n\nWhen making|$)/i,
      },
      {
        label: "Function Calling",
        description: "Instructions for making tool/function calls",
        pattern: /When making function calls[^]*?(?=\n\nAnswer the user|$)/i,
      },
      {
        label: "Response Guidelines",
        description: "Final instructions for answering user requests",
        pattern: /Answer the user's request[^]*$/i,
      },
    ]

    // Track which portions of the prompt have been matched
    const matchedRanges: Array<{ start: number; end: number }> = []

    for (const { label, description, pattern } of sectionPatterns) {
      const match = rawPrompt.match(pattern)
      if (match && match[0] && match.index !== undefined) {
        const start = match.index
        const end = start + match[0].length

        // Check if this range overlaps with any already matched range
        const overlaps = matchedRanges.some(
          (range) => (start >= range.start && start < range.end) || (end > range.start && end <= range.end)
        )

        if (!overlaps) {
          const content = match[0].trim()
          const tokens = await this.tokenizerManager.countTokens(content, tokenModel)

          sections.push({
            label,
            description,
            content,
            tokens,
          })

          matchedRanges.push({ start, end })
        }
      }
    }

    // If we couldn't parse sections, treat the whole prompt as one section
    if (sections.length === 0) {
      const tokens = await this.tokenizerManager.countTokens(rawPrompt, tokenModel)
      sections.push({
        label: "System Prompt",
        description: "Complete system prompt (unparsed)",
        content: rawPrompt,
        tokens,
      })
    } else {
      // Calculate unmatched content by finding gaps between matched ranges
      matchedRanges.sort((a, b) => a.start - b.start)
      let unmatchedContent = ""
      let lastEnd = 0

      for (const range of matchedRanges) {
        if (range.start > lastEnd) {
          unmatchedContent += rawPrompt.slice(lastEnd, range.start)
        }
        lastEnd = Math.max(lastEnd, range.end)
      }
      // Add any remaining content after the last match
      if (lastEnd < rawPrompt.length) {
        unmatchedContent += rawPrompt.slice(lastEnd)
      }

      const trimmedRemaining = unmatchedContent.trim()
      if (trimmedRemaining.length > 100) {
        const tokens = await this.tokenizerManager.countTokens(trimmedRemaining, tokenModel)
        if (tokens > 50) {
          sections.push({
            label: "Other Instructions",
            description: "Additional instructions not matching known patterns",
            content: trimmedRemaining,
            tokens,
          })
        }
      }
    }

    // Sort by token count descending
    sections.sort((a, b) => b.tokens - a.tokens)

    return sections
  }

  private calculateEfficiency(
    toolDefTokens: number,
    systemPromptTokens: number,
    mostRecentInput: number,
    mostRecentCacheRead: number,
    mostRecentCacheWrite: number
  ): ContextEfficiency {
    const staticContextTokens = toolDefTokens + systemPromptTokens
    const totalInputTokens = mostRecentInput + mostRecentCacheRead

    // Calculate cache hit rate (based on input tokens only, not cache writes)
    const cacheHitRate = totalInputTokens > 0 ? (mostRecentCacheRead / totalInputTokens) * 100 : 0

    // Calculate effective cost reduction factoring in:
    // - Fresh input: 1x cost
    // - Cache reads: 0.1x cost (10x cheaper)
    // - Cache writes: 1.25x cost (25% premium)
    //
    // Without caching: all tokens at full price
    // With caching: fresh at 1x + cache reads at 0.1x + cache writes at 1.25x
    const withoutCaching = mostRecentInput + mostRecentCacheRead + mostRecentCacheWrite
    const withCaching =
      mostRecentInput + // Fresh input at full price
      mostRecentCacheRead * 0.1 + // Cache reads at 10% price
      mostRecentCacheWrite * 1.25 // Cache writes at 125% price

    const effectiveCostReduction = withoutCaching > 0 ? ((withoutCaching - withCaching) / withoutCaching) * 100 : 0

    return {
      staticContextTokens,
      cacheReadTokens: mostRecentCacheRead,
      cacheWriteTokens: mostRecentCacheWrite,
      freshInputTokens: mostRecentInput,
      cacheHitRate,
      effectiveCostReduction,
    }
  }

  private async calculateRequestComposition(
    toolDefTokens: number,
    systemPromptTokens: number,
    mostRecentInput: number,
    mostRecentCacheRead: number,
    messages: SessionMessage[],
    tokenModel: TokenModel
  ): Promise<RequestComposition> {
    const totalRequest = mostRecentInput + mostRecentCacheRead

    // Tool definitions and system prompt are the static context
    const staticContext = toolDefTokens + systemPromptTokens

    // The remaining tokens are conversation + user message
    const dynamicTokens = Math.max(0, totalRequest - staticContext)

    // Count tokens for the last user message using the tokenizer for consistency
    let lastUserMessageTokens = 0
    for (const message of [...messages].reverse()) {
      if (message.info.role === "user") {
        const textContent = message.parts
          .filter((p) => p.type === "text")
          .map((p) => (p as any).text || "")
          .join(" ")
        // Use the same tokenizer as the rest of the analysis for consistency
        lastUserMessageTokens = await this.tokenizerManager.countTokens(textContent, tokenModel)
        break
      }
    }

    const conversationHistory = Math.max(0, dynamicTokens - lastUserMessageTokens)

    return {
      toolDefinitions: toolDefTokens,
      systemPrompt: systemPromptTokens,
      conversationHistory,
      userMessage: lastUserMessageTokens,
      totalRequest,
    }
  }
}
