// SkillAnalyzer - analyzes skill usage and token consumption

import type {
  SessionMessage,
  SkillAnalysis,
  AvailableSkill,
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
      loadedSkills: [],
      totalAvailableTokens: 0,
      totalLoadedTokens: 0,
      skillToolDescriptionTokens: 0,
    }

    try {
      // 1. Get available skills from tool.list() API
      const availableResult = await this.getAvailableSkills(providerID, modelID, tokenModel)
      result.availableSkills = availableResult.skills
      result.totalAvailableTokens = availableResult.totalTokens
      result.skillToolDescriptionTokens = availableResult.descriptionTokens

      // 2. Get loaded skills from session messages
      const loadedResult = await this.getLoadedSkills(messages, tokenModel)
      result.loadedSkills = loadedResult.skills
      result.totalLoadedTokens = loadedResult.totalTokens
    } catch (error) {
      console.error("Skill analysis failed:", error)
    }

    return result
  }

  /**
   * Fetch available skills from the tool.list() API and parse them
   */
  private async getAvailableSkills(
    providerID: string,
    modelID: string,
    tokenModel: TokenModel
  ): Promise<{ skills: AvailableSkill[]; totalTokens: number; descriptionTokens: number }> {
    const skills: AvailableSkill[] = []
    let totalTokens = 0
    let descriptionTokens = 0

    try {
      // Call the experimental tool list API
      const response = await this.client.tool.list({
        query: {
          provider: providerID,
          model: modelID,
        },
      })

      const tools = (response as any)?.data ?? response ?? []

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

    // Parse each <skill> entry
    const skillRegex = /<skill>\s*<name>([^<]+)<\/name>\s*<description>([^<]*)<\/description>\s*<\/skill>/gi
    let match

    while ((match = skillRegex.exec(xmlContent)) !== null) {
      skills.push({
        name: match[1].trim(),
        description: match[2].trim(),
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
    // - Skill tool execution: https://github.com/sst/opencode/blob/main/packages/opencode/src/tool/skill.ts
    // - Tool result handling: https://github.com/sst/opencode/blob/main/packages/opencode/src/session/message-v2.ts
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
