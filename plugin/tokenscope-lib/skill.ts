// SkillAnalyzer - analyzes skill usage and token consumption

import type {
  SessionMessage,
  SkillAnalysis,
  AvailableSkill,
  AvailableSubagent,
  LoadedSkill,
  TokenModel,
  TokenscopeConfig,
} from "./types"
import { isToolPart } from "./types"
import { TokenizerManager } from "./tokenizer"

export class SkillAnalyzer {
  constructor(
    private client: any,
    private tokenizerManager: TokenizerManager
  ) {}

  /**
   * Main entry point - analyzes skill usage in a session
   */
  async analyze(
    messages: SessionMessage[],
    providerID: string,
    modelID: string,
    tokenModel: TokenModel,
    config: TokenscopeConfig
  ): Promise<SkillAnalysis | undefined> {
    if (!config.enableSkillAnalysis) {
      return undefined
    }

    const result: SkillAnalysis = {
      availableSkills: [],
      availableSubagents: [],
      loadedSkills: [],
      totalAvailableTokens: 0,
      totalAvailableSubagentTokens: 0,
      totalLoadedTokens: 0,
      skillToolDescriptionTokens: 0,
      taskToolDescriptionTokens: 0,
    }

    try {
      const tools = await this.listTools(providerID, modelID)

      // 1. Get available skills from tool.list() API
      const availableResult = await this.getAvailableSkills(tools, tokenModel)
      result.availableSkills = availableResult.skills
      result.totalAvailableTokens = availableResult.totalTokens
      result.skillToolDescriptionTokens = availableResult.descriptionTokens

      // 2. Get available subagents from task tool description
      const subagentResult = await this.getAvailableSubagents(tools, tokenModel)
      result.availableSubagents = subagentResult.subagents
      result.totalAvailableSubagentTokens = subagentResult.totalTokens
      result.taskToolDescriptionTokens = subagentResult.descriptionTokens

      // 3. Get loaded skills from session messages
      const loadedResult = await this.getLoadedSkills(messages, tokenModel)
      result.loadedSkills = loadedResult.skills
      result.totalLoadedTokens = loadedResult.totalTokens
    } catch (error) {
      console.error("Skill analysis failed:", error)
    }

    return result
  }

  /**
   * Fetch current tool definitions for the provider/model
   */
  private async listTools(providerID: string, modelID: string): Promise<any[]> {
    try {
      const response = await this.client.tool.list({
        query: {
          provider: providerID,
          model: modelID,
        },
      })

      return (response as any)?.data ?? response ?? []
    } catch (error) {
      console.error("Failed to fetch tools:", error)
      return []
    }
  }

  /**
   * Fetch available skills from the tool.list() API and parse them
   */
  private async getAvailableSkills(
    tools: any[],
    tokenModel: TokenModel
  ): Promise<{ skills: AvailableSkill[]; totalTokens: number; descriptionTokens: number }> {
    const skills: AvailableSkill[] = []
    let totalTokens = 0
    let descriptionTokens = 0

    try {
      // Find the skill tool
      const skillTool = tools.find((t: any) => t.id === "skill")
      if (!skillTool || !skillTool.description) {
        return { skills, totalTokens, descriptionTokens }
      }

      // Tokenize the full skill tool description
      descriptionTokens = await this.tokenizerManager.countTokens(skillTool.description, tokenModel)

      // Parse the <available_skills> XML from the description
      const parsedSkills = this.parseAvailableSkillsXml(skillTool.description)

      // Tokenize each skill's contribution
      for (const skill of parsedSkills) {
        // Reconstruct the XML for this skill to get accurate token count
        const skillXml = `  <skill>    <name>${skill.name}</name>    <description>${skill.description}</description>  </skill>`
        const tokens = await this.tokenizerManager.countTokens(skillXml, tokenModel)

        skills.push({
          name: skill.name,
          description: skill.description,
          tokens,
        })
        totalTokens += tokens
      }
    } catch (error) {
      console.error("Failed to fetch available skills:", error)
    }

    return { skills, totalTokens, descriptionTokens }
  }

  /**
   * Parse available subagents from task tool description
   */
  private async getAvailableSubagents(
    tools: any[],
    tokenModel: TokenModel
  ): Promise<{ subagents: AvailableSubagent[]; totalTokens: number; descriptionTokens: number }> {
    const subagents: AvailableSubagent[] = []
    let totalTokens = 0
    let descriptionTokens = 0

    try {
      const taskTool = tools.find((t: any) => t.id === "task")
      if (!taskTool || !taskTool.description) {
        return { subagents, totalTokens, descriptionTokens }
      }

      descriptionTokens = await this.tokenizerManager.countTokens(taskTool.description, tokenModel)
      const parsedSubagents = this.parseAvailableSubagents(taskTool.description)

      for (const subagent of parsedSubagents) {
        const tokens = await this.tokenizerManager.countTokens(subagent.rawText, tokenModel)

        subagents.push({
          name: subagent.name,
          description: subagent.description,
          tokens,
        })
        totalTokens += tokens
      }
    } catch (error) {
      console.error("Failed to analyze available subagents:", error)
    }

    return { subagents, totalTokens, descriptionTokens }
  }

  /**
   * Parse the subagent list from task tool description
   */
  private parseAvailableSubagents(
    description: string
  ): Array<{ name: string; description: string; rawText: string }> {
    const subagents: Array<{ name: string; description: string; rawText: string }> = []
    const lines = description.split(/\r?\n/)
    const startIndex = lines.findIndex((line) => /available agent types/i.test(line))

    if (startIndex === -1) {
      return subagents
    }

    let parsedAnyEntries = false
    let sawBlankAfterEntries = false

    for (let i = startIndex + 1; i < lines.length; i++) {
      const trimmed = lines[i].trim()

      if (this.isSubagentSectionBoundary(trimmed)) {
        break
      }

      if (trimmed.length === 0) {
        if (parsedAnyEntries) {
          sawBlankAfterEntries = true
        }
        continue
      }

      if (!trimmed.startsWith("- ")) {
        if (parsedAnyEntries) {
          break
        }
        continue
      }

      if (sawBlankAfterEntries) {
        break
      }

      const content = trimmed.slice(2).trim()
      const firstColon = content.indexOf(":")
      if (firstColon <= 0) {
        continue
      }

      const name = content.slice(0, firstColon).trim()
      const rawDescription = content.slice(firstColon + 1).trim()
      if (!name || !rawDescription) {
        continue
      }

      if (!this.isLikelySubagentName(name)) {
        continue
      }

      subagents.push({
        name,
        description: rawDescription.replace(/\s+/g, " ").trim(),
        rawText: `- ${name}: ${rawDescription}`,
      })
      parsedAnyEntries = true
    }

    return subagents
  }

  private isLikelySubagentName(name: string): boolean {
    return /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(name)
  }

  private isSubagentSectionBoundary(line: string): boolean {
    if (!line) {
      return false
    }

    return (
      /^#{1,6}\s/.test(line) ||
      /^<example>/i.test(line) ||
      /^when\s+using\s+the\s+task\s+tool/i.test(line) ||
      /^when\s+to\s+use\s+the\s+task\s+tool/i.test(line) ||
      /^usage\s+notes:/i.test(line) ||
      /^examples?:/i.test(line)
    )
  }

  /**
   * Parse the <available_skills> XML from skill tool description
   */
  private parseAvailableSkillsXml(description: string): Array<{ name: string; description: string }> {
    const skills: Array<{ name: string; description: string }> = []

    // Find the <available_skills> section
    const availableSkillsMatch = description.match(/<available_skills>([\s\S]*?)<\/available_skills>/i)
    if (!availableSkillsMatch) {
      return skills
    }

    const xmlContent = availableSkillsMatch[1]

    // Parse each <skill> block first, then extract known tags.
    // This keeps parsing resilient when upstream adds nested tags
    // (for example, <location> in anomalyco/opencode).
    const skillBlockRegex = /<skill>([\s\S]*?)<\/skill>/gi
    let blockMatch

    while ((blockMatch = skillBlockRegex.exec(xmlContent)) !== null) {
      const block = blockMatch[1]
      const nameMatch = block.match(/<name>([\s\S]*?)<\/name>/i)
      const descriptionMatch = block.match(/<description>([\s\S]*?)<\/description>/i)

      const name = nameMatch?.[1]?.trim() ?? ""
      const description = descriptionMatch?.[1]?.trim() ?? ""

      if (!name || !description) {
        continue
      }

      skills.push({
        name,
        description,
      })
    }

    return skills
  }

  /**
   * Collect loaded skills from session messages with call count tracking
   */
  private async getLoadedSkills(
    messages: SessionMessage[],
    tokenModel: TokenModel
  ): Promise<{ skills: LoadedSkill[]; totalTokens: number }> {
    // Track skills by name to aggregate call counts
    const skillMap = new Map<
      string,
      {
        name: string
        callCount: number
        firstMessageIndex: number
        tokens: number
        content: string
      }
    >()
    let totalTokens = 0
    let messageIndex = 0

    for (const message of messages) {
      // Track message index for user/assistant messages
      if (message.info.role === "user" || message.info.role === "assistant") {
        messageIndex++
      }

      for (const part of message.parts) {
        if (!isToolPart(part)) continue
        if (part.tool !== "skill") continue
        if (part.state.status !== "completed") continue

        // Extract skill name from input or metadata
        const skillName = this.extractSkillName(part.state)
        if (!skillName) continue

        // Get the output content
        const content = (part.state.output ?? "").toString().trim()
        if (!content) continue

        // Check if we've seen this skill before
        const existing = skillMap.get(skillName)
        if (existing) {
          // Increment call count for existing skill
          existing.callCount++
        } else {
          // Tokenize the loaded content (only once per unique skill)
          const tokens = await this.tokenizerManager.countTokens(content, tokenModel)

          skillMap.set(skillName, {
            name: skillName,
            callCount: 1,
            firstMessageIndex: messageIndex,
            tokens,
            content: content.length > 500 ? content.substring(0, 500) + "..." : content,
          })
        }
      }
    }

    // Convert map to array and calculate totals
    // Note: We multiply tokens by callCount because OpenCode does NOT deduplicate
    // skill content. Each call to the skill tool adds the full content to context
    // as a new tool result. See OpenCode source:
    // - Skill tool execution: https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/skill.ts
    // - Tool result handling: https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/message-v2.ts
    const skills: LoadedSkill[] = []
    for (const [, skillData] of skillMap) {
      const totalSkillTokens = skillData.tokens * skillData.callCount
      skills.push({
        name: skillData.name,
        callCount: skillData.callCount,
        firstMessageIndex: skillData.firstMessageIndex,
        tokens: skillData.tokens,
        totalTokens: totalSkillTokens,
        content: skillData.content,
      })
      totalTokens += totalSkillTokens
    }

    // Sort by total tokens descending
    skills.sort((a, b) => b.totalTokens - a.totalTokens)

    return { skills, totalTokens }
  }

  /**
   * Extract skill name from tool state
   */
  private extractSkillName(state: any): string | undefined {
    // Try input.name first
    if (state.input && typeof state.input === "object" && state.input.name) {
      return String(state.input.name)
    }

    // Try metadata.name
    if (state.metadata && typeof state.metadata === "object" && state.metadata.name) {
      return String(state.metadata.name)
    }

    // Try parsing from title "Loaded skill: {name}"
    if (state.title && typeof state.title === "string") {
      const match = state.title.match(/Loaded skill:\s*(.+)/i)
      if (match) {
        return match[1].trim()
      }
    }

    return undefined
  }
}
