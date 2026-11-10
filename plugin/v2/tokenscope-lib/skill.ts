// SkillAnalyzer - analyzes skill and subagent catalogs and loaded skill content

import type {
  SessionMessage,
  SkillAnalysis,
  AvailableSkill,
  AvailableSubagent,
  LoadedSkill,
  RequestSnapshot,
  TokenModel,
  TokenscopeConfig,
} from "./types.js"
import { TokenizerManager } from "./tokenizer.js"
import { WarningCollector, formatErrorMessage } from "./warnings.js"
import type { CatalogReader, OpenCodeAgent, OpenCodeSkill } from "./opencode.js"

type PermissionRule = OpenCodeAgent["permissions"][number]

const SKILL_TOOL = "skill"
const SUBAGENT_TOOL = "subagent"
const SKILL_GUIDANCE_KEY = "core/skill-guidance"

export interface SkillAnalysisInput {
  messages: SessionMessage[]
  // The latest captured model request for the session, when one has been observed.
  snapshot?: RequestSnapshot
  // Session-level permission rules; OpenCode evaluates them after the agent's rules.
  sessionPermissions?: readonly PermissionRule[]
  tokenModel: TokenModel
  config: TokenscopeConfig
}

export class SkillAnalyzer {
  constructor(
    private catalog: CatalogReader,
    private tokenizerManager: TokenizerManager,
    private warnings?: WarningCollector
  ) {}

  /**
   * Main entry point - analyzes skill usage in a session
   */
  async analyze(input: SkillAnalysisInput): Promise<SkillAnalysis | undefined> {
    const { messages, snapshot, tokenModel, config } = input
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
      availableSkillsContextTokens: 0,
      skillToolDescriptionTokens: 0,
      subagentToolDescriptionTokens: 0,
    }

    try {
      const [agents, skills] = await Promise.all([this.catalog.agent.list(), this.catalog.skill.list()])
      const currentAgent = this.resolveCurrentAgent(messages, agents.data)
      const rules = [...(currentAgent?.permissions ?? []), ...(input.sessionPermissions ?? [])]

      // 1. Skills listed in the system prompt on every request
      const accessibleSkills = this.filterAccessibleSkills(skills.data, rules)
      const availableResult = await this.getAvailableSkills(accessibleSkills, snapshot, tokenModel)
      result.availableSkills = availableResult.skills
      result.totalAvailableTokens = availableResult.totalTokens
      result.availableSkillsContextTokens = availableResult.contextTokens
      result.skillToolDescriptionTokens = await this.toolDescriptionTokens(SKILL_TOOL, snapshot, tokenModel)

      // 2. Subagents listed in the subagent tool description on every request
      const accessibleSubagents = this.filterAccessibleSubagents(agents.data, rules)
      const subagentResult = await this.getAvailableSubagents(accessibleSubagents, tokenModel)
      result.availableSubagents = subagentResult.subagents
      result.totalAvailableSubagentTokens = subagentResult.totalTokens
      result.subagentToolDescriptionTokens = await this.toolDescriptionTokens(SUBAGENT_TOOL, snapshot, tokenModel)

      // 3. Skill content loaded into the conversation
      const loadedResult = await this.getLoadedSkills(messages, tokenModel)
      result.loadedSkills = loadedResult.skills
      result.totalLoadedTokens = loadedResult.totalTokens
    } catch (error) {
      this.warnings?.add(`Skill analysis was skipped: ${formatErrorMessage(error)}`, "skill-analysis")
    }

    return result
  }

  private async getAvailableSkills(
    skills: OpenCodeSkill[],
    snapshot: RequestSnapshot | undefined,
    tokenModel: TokenModel
  ): Promise<{ skills: AvailableSkill[]; totalTokens: number; contextTokens: number }> {
    const available: AvailableSkill[] = []
    let totalTokens = 0

    for (const skill of skills) {
      const tokens = await this.tokenizerManager.countTokens(this.buildSkillEntry(skill), tokenModel)
      available.push({ name: skill.id, description: skill.description ?? "", tokens })
      totalTokens += tokens
    }

    // Prefer the catalog text OpenCode actually sent; rebuild it only when no request was captured.
    const sentGuidance = snapshot?.system
      .flatMap((part) => part.instructions ?? [])
      .find((instruction) => instruction.key === SKILL_GUIDANCE_KEY)?.text
    const guidance = snapshot ? sentGuidance : skills.length > 0 ? this.buildSkillGuidance(skills) : undefined
    const contextTokens = guidance ? await this.tokenizerManager.countTokens(guidance, tokenModel) : 0

    return { skills: available, totalTokens, contextTokens }
  }

  private async getAvailableSubagents(
    agents: OpenCodeAgent[],
    tokenModel: TokenModel
  ): Promise<{ subagents: AvailableSubagent[]; totalTokens: number }> {
    const subagents: AvailableSubagent[] = []
    let totalTokens = 0

    for (const agent of agents) {
      const description = this.getSubagentDescription(agent)
      const tokens = await this.tokenizerManager.countTokens(`- ${agent.id}: ${description}`, tokenModel)
      subagents.push({ name: agent.id, description, tokens })
      totalTokens += tokens
    }

    return { subagents, totalTokens }
  }

  private async toolDescriptionTokens(
    toolID: string,
    snapshot: RequestSnapshot | undefined,
    tokenModel: TokenModel
  ): Promise<number> {
    const description = snapshot?.tools.find((tool) => tool.id === toolID)?.description
    return description ? this.tokenizerManager.countTokens(description, tokenModel) : 0
  }

  /**
   * Collect loaded skills from session messages with call count tracking.
   */
  private async getLoadedSkills(
    messages: SessionMessage[],
    tokenModel: TokenModel
  ): Promise<{ skills: LoadedSkill[]; totalTokens: number }> {
    const skillMap = new Map<
      string,
      {
        name: string
        callCount: number
        firstMessageIndex: number
        tokens: number
        totalTokens: number
        content: string
      }
    >()
    let totalTokens = 0
    let messageIndex = 0

    for (const message of messages) {
      if (message.info.role === "user" || message.info.role === "assistant") {
        messageIndex++
      }

      for (const part of message.parts) {
        if (part.type !== "tool") continue
        if (part.tool !== SKILL_TOOL) continue
        if (part.state.status !== "completed") continue

        const skillName = this.extractSkillName(part.state.input, part.state.metadata)
        if (!skillName) continue

        const content = (part.state.output ?? "").trim()
        if (!content) continue

        // Every load stays in context as its own result, so each one is tokenized and summed.
        const tokens = await this.tokenizerManager.countTokens(content, tokenModel)
        const existing = skillMap.get(skillName)
        if (existing) {
          existing.callCount++
          existing.totalTokens += tokens
        } else {
          skillMap.set(skillName, {
            name: skillName,
            callCount: 1,
            firstMessageIndex: messageIndex,
            tokens,
            totalTokens: tokens,
            content: content.length > 500 ? content.substring(0, 500) + "..." : content,
          })
        }
      }
    }

    const skills: LoadedSkill[] = []
    for (const [, skillData] of skillMap) {
      skills.push({
        name: skillData.name,
        callCount: skillData.callCount,
        firstMessageIndex: skillData.firstMessageIndex,
        tokens: skillData.tokens,
        totalTokens: skillData.totalTokens,
        content: skillData.content,
      })
      totalTokens += skillData.totalTokens
    }

    skills.sort((a, b) => b.totalTokens - a.totalTokens)

    return { skills, totalTokens }
  }

  // The skill tool takes `{ id }`; its result metadata carries the display name.
  private extractSkillName(input?: Record<string, unknown>, metadata?: Record<string, unknown>): string | undefined {
    if (typeof input?.id === "string" && input.id) return input.id
    if (typeof metadata?.name === "string" && metadata.name) return metadata.name
    return undefined
  }

  private resolveCurrentAgent(messages: SessionMessage[], agents: readonly OpenCodeAgent[]): OpenCodeAgent | undefined {
    const agentID = messages
      .map((message) => message.info.agent)
      .filter((agent): agent is string => typeof agent === "string" && agent.trim().length > 0)
      .at(-1)

    return agentID ? agents.find((agent) => agent.id === agentID) : undefined
  }

  // Mirrors OpenCode's skill catalog: skills without a description or with autoinvoke disabled are not advertised.
  private filterAccessibleSkills(skills: readonly OpenCodeSkill[], rules: readonly PermissionRule[]): OpenCodeSkill[] {
    return skills
      .filter((skill) => skill.description !== undefined && skill.autoinvoke !== false)
      .filter((skill) => this.evaluatePermission(SKILL_TOOL, skill.id, rules) !== "deny")
      .sort((a, b) => a.id.localeCompare(b.id))
  }

  // Mirrors the subagent tool: primary and hidden agents are not offered as subagents.
  private filterAccessibleSubagents(agents: readonly OpenCodeAgent[], rules: readonly PermissionRule[]): OpenCodeAgent[] {
    return agents
      .filter((agent) => agent.mode !== "primary" && !agent.hidden)
      .filter((agent) => this.evaluatePermission(SUBAGENT_TOOL, agent.id, rules) !== "deny")
      .sort((a, b) => a.id.localeCompare(b.id))
  }

  // The last matching rule wins; an action with no matching rule asks.
  private evaluatePermission(action: string, resource: string, rules: readonly PermissionRule[]): PermissionRule["effect"] {
    const match = [...rules]
      .reverse()
      .find((rule) => this.matchesWildcard(action, rule.action) && this.matchesWildcard(resource, rule.resource))

    return match?.effect ?? "ask"
  }

  private matchesWildcard(value: string, pattern: string): boolean {
    const normalizedValue = value.replaceAll("\\", "/")
    const normalizedPattern = pattern.replaceAll("\\", "/")

    let escaped = normalizedPattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".")

    if (escaped.endsWith(" .*")) {
      escaped = escaped.slice(0, -3) + "( .*)?"
    }

    const flags = process.platform === "win32" ? "si" : "s"
    return new RegExp("^" + escaped + "$", flags).test(normalizedValue)
  }

  private buildSkillEntry(skill: OpenCodeSkill): string {
    return [
      "  <skill>",
      `    <id>${skill.id}</id>`,
      `    <name>${skill.name}</name>`,
      `    <description>${skill.description ?? ""}</description>`,
      "  </skill>",
    ].join("\n")
  }

  private buildSkillGuidance(skills: OpenCodeSkill[]): string {
    return [
      "Skills provide specialized instructions and workflows for specific tasks.",
      "Use the skill tool to load a skill when a task matches its description.",
      "The user may also invoke a skill directly. When that happens, its instructions appear in the conversation as a <skill_content> block, the same shape the skill tool returns. A skill that is already present this way does not need to be invoked again.",
      "<available_skills>",
      ...skills.map((skill) => this.buildSkillEntry(skill)),
      "</available_skills>",
    ].join("\n")
  }

  private getSubagentDescription(agent: OpenCodeAgent): string {
    return agent.description ?? "This subagent should only be called when explicitly requested."
  }
}
