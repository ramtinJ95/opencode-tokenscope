// SkillAnalyzer - analyzes skill usage and token consumption

import { pathToFileURL } from "url"

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
import { WarningCollector, formatErrorMessage } from "./warnings"

interface ToolListItem {
  id: string
  description?: string
}

interface PermissionRule {
  permission: string
  pattern: string
  action: "allow" | "deny" | "ask"
}

interface RemoteAgent {
  name: string
  description?: string
  mode?: string
  permission?: unknown
}

interface RemoteSkill {
  name: string
  description: string
  location?: string
}

interface ParsedSkillEntry {
  name: string
  description: string
  rawText: string
}

export class SkillAnalyzer {
  constructor(
    private client: any,
    private tokenizerManager: TokenizerManager,
    private serverUrl: URL,
    private directory: string,
    private warnings?: WarningCollector
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
      availableSkillsContextTokens: 0,
      skillToolDescriptionTokens: 0,
      taskToolDescriptionTokens: 0,
    }

    try {
      const tools = await this.listTools(providerID, modelID)
      const [agents, skills] = await Promise.all([this.fetchAgents(), this.fetchSkills()])
      const currentAgent = this.resolveCurrentAgent(messages, agents)
      const accessibleSkills = this.filterAccessibleSkills(skills, currentAgent)
      const accessibleSubagents = this.filterAccessibleSubagents(agents, currentAgent)

      // 1. Get available skills from current OpenCode catalogs / tool metadata
      const availableResult = await this.getAvailableSkills(tools, accessibleSkills, tokenModel)
      result.availableSkills = availableResult.skills
      result.totalAvailableTokens = availableResult.totalTokens
      result.availableSkillsContextTokens = availableResult.contextTokens
      result.skillToolDescriptionTokens = availableResult.descriptionTokens

      // 2. Get available subagents from current OpenCode catalogs / task tool description
      const subagentResult = await this.getAvailableSubagents(tools, accessibleSubagents, tokenModel)
      result.availableSubagents = subagentResult.subagents
      result.totalAvailableSubagentTokens = subagentResult.totalTokens
      result.taskToolDescriptionTokens = subagentResult.descriptionTokens

      // 3. Get loaded skills from session messages
      const loadedResult = await this.getLoadedSkills(messages, tokenModel)
      result.loadedSkills = loadedResult.skills
      result.totalLoadedTokens = loadedResult.totalTokens
    } catch (error) {
      this.warnings?.add(`Skill analysis was skipped: ${formatErrorMessage(error)}`, "skill-analysis")
    }

    return result
  }

  /**
   * Fetch current tool definitions for the provider/model
   */
  private async listTools(providerID: string, modelID: string): Promise<ToolListItem[]> {
    try {
      const response = await this.client.tool.list({
        query: {
          provider: providerID,
          model: modelID,
        },
      })

      const tools = (response as any)?.data ?? response ?? []
      return Array.isArray(tools) ? (tools as ToolListItem[]) : []
    } catch (error) {
      this.warnings?.add(
        `Could not fetch tool metadata for ${providerID}/${modelID}. Skill and subagent catalog sections were skipped: ${formatErrorMessage(error)}`,
        `tool-list:${providerID}:${modelID}`
      )
      return []
    }
  }

  /**
   * Fetch available skills from current OpenCode APIs when possible.
   * Falls back to parsing the tool description for older versions.
   */
  private async getAvailableSkills(
    tools: ToolListItem[],
    availableSkills: RemoteSkill[] | undefined,
    tokenModel: TokenModel
  ): Promise<{ skills: AvailableSkill[]; totalTokens: number; contextTokens: number; descriptionTokens: number }> {
    const skills: AvailableSkill[] = []
    let totalTokens = 0
    let contextTokens = 0
    let descriptionTokens = 0

    try {
      if (availableSkills) {
        const sortedSkills = [...availableSkills].sort((a, b) => a.name.localeCompare(b.name))
        const skillToolDescription = this.buildSkillToolDescription(sortedSkills)
        descriptionTokens = await this.tokenizerManager.countTokens(skillToolDescription, tokenModel)

        const systemPromptCatalog = this.buildSkillSystemPrompt(sortedSkills)
        contextTokens = await this.tokenizerManager.countTokens(systemPromptCatalog, tokenModel)

        for (const skill of sortedSkills) {
          const entry = this.buildVerboseSkillEntry(skill)
          const tokens = await this.tokenizerManager.countTokens(entry, tokenModel)
          skills.push({
            name: skill.name,
            description: skill.description,
            tokens,
          })
          totalTokens += tokens
        }

        return { skills, totalTokens, contextTokens, descriptionTokens }
      }

      const skillTool = tools.find((t) => t.id === "skill")
      if (!skillTool?.description) {
        return { skills, totalTokens, contextTokens, descriptionTokens }
      }

      descriptionTokens = await this.tokenizerManager.countTokens(skillTool.description, tokenModel)
      const parsedSkills = this.parseAvailableSkills(skillTool.description)

      for (const skill of parsedSkills) {
        const tokens = await this.tokenizerManager.countTokens(skill.rawText, tokenModel)
        skills.push({
          name: skill.name,
          description: skill.description,
          tokens,
        })
        totalTokens += tokens
      }
    } catch (error) {
      this.warnings?.add(`Available skill estimates were skipped: ${formatErrorMessage(error)}`, "available-skills")
    }

    return { skills, totalTokens, contextTokens, descriptionTokens }
  }

  /**
   * Fetch available subagents from current OpenCode APIs when possible.
   * Falls back to parsing the task tool description for older versions.
   */
  private async getAvailableSubagents(
    tools: ToolListItem[],
    availableSubagents: RemoteAgent[] | undefined,
    tokenModel: TokenModel
  ): Promise<{ subagents: AvailableSubagent[]; totalTokens: number; descriptionTokens: number }> {
    const subagents: AvailableSubagent[] = []
    let totalTokens = 0
    let descriptionTokens = 0

    try {
      const taskTool = tools.find((t) => t.id === "task")

      if (availableSubagents) {
        const sortedSubagents = [...availableSubagents].sort((a, b) => a.name.localeCompare(b.name))

        if (taskTool?.description) {
          const filteredDescription = this.buildFilteredTaskDescription(taskTool.description, sortedSubagents)
          descriptionTokens = await this.tokenizerManager.countTokens(filteredDescription, tokenModel)
        }

        for (const subagent of sortedSubagents) {
          const rawText = this.buildSubagentBullet(subagent)
          const tokens = await this.tokenizerManager.countTokens(rawText, tokenModel)
          subagents.push({
            name: subagent.name,
            description: this.getSubagentDescription(subagent),
            tokens,
          })
          totalTokens += tokens
        }

        return { subagents, totalTokens, descriptionTokens }
      }

      if (!taskTool?.description) {
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
      this.warnings?.add(
        `Available subagent estimates were skipped: ${formatErrorMessage(error)}`,
        "available-subagents"
      )
    }

    return { subagents, totalTokens, descriptionTokens }
  }

  /**
   * Parse available subagents from the task tool description.
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

      if (!this.isLikelyIdentifier(name)) {
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

  /**
   * Parse the available skills list from both current markdown and legacy XML formats.
   */
  private parseAvailableSkills(description: string): ParsedSkillEntry[] {
    const xmlSkills = this.parseAvailableSkillsXml(description)
    if (xmlSkills.length > 0) {
      return xmlSkills
    }

    return this.parseAvailableSkillsMarkdown(description)
  }

  private parseAvailableSkillsXml(description: string): ParsedSkillEntry[] {
    const skills: ParsedSkillEntry[] = []
    const availableSkillsMatch = description.match(/<available_skills>([\s\S]*?)<\/available_skills>/i)
    if (!availableSkillsMatch) {
      return skills
    }

    const xmlContent = availableSkillsMatch[1]
    const skillBlockRegex = /<skill>([\s\S]*?)<\/skill>/gi
    let blockMatch: RegExpExecArray | null

    while ((blockMatch = skillBlockRegex.exec(xmlContent)) !== null) {
      const block = blockMatch[0]
      const body = blockMatch[1]
      const nameMatch = body.match(/<name>([\s\S]*?)<\/name>/i)
      const descriptionMatch = body.match(/<description>([\s\S]*?)<\/description>/i)

      const name = nameMatch?.[1]?.trim() ?? ""
      const skillDescription = descriptionMatch?.[1]?.trim() ?? ""
      if (!name || !skillDescription) {
        continue
      }

      skills.push({
        name,
        description: skillDescription,
        rawText: block,
      })
    }

    return skills
  }

  private parseAvailableSkillsMarkdown(description: string): ParsedSkillEntry[] {
    const skills: ParsedSkillEntry[] = []
    const lines = description.split(/\r?\n/)
    const startIndex = lines.findIndex((line) => /^##\s+available skills\s*$/i.test(line.trim()))

    if (startIndex === -1) {
      return skills
    }

    let parsedAnyEntries = false

    for (let i = startIndex + 1; i < lines.length; i++) {
      const trimmed = lines[i].trim()

      if (!trimmed) {
        if (parsedAnyEntries) {
          break
        }
        continue
      }

      if (/^#{1,6}\s/.test(trimmed)) {
        break
      }

      const match = trimmed.match(/^-\s+\*\*([^*]+)\*\*:\s*(.+)$/) ?? trimmed.match(/^-\s+([^:]+):\s*(.+)$/)
      if (!match) {
        if (parsedAnyEntries) {
          break
        }
        continue
      }

      const name = match[1]?.trim() ?? ""
      const skillDescription = match[2]?.trim() ?? ""
      if (!name || !skillDescription || !this.isLikelyIdentifier(name)) {
        continue
      }

      skills.push({
        name,
        description: skillDescription.replace(/\s+/g, " ").trim(),
        rawText: trimmed,
      })
      parsedAnyEntries = true
    }

    return skills
  }

  private isLikelyIdentifier(name: string): boolean {
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
        if (!isToolPart(part)) continue
        if (part.tool !== "skill") continue
        if (part.state.status !== "completed") continue

        const skillName = this.extractSkillName(part.state)
        if (!skillName) continue

        const content = (part.state.output ?? "").toString().trim()
        if (!content) continue

        const existing = skillMap.get(skillName)
        if (existing) {
          existing.callCount++
        } else {
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

    skills.sort((a, b) => b.totalTokens - a.totalTokens)

    return { skills, totalTokens }
  }

  /**
   * Extract skill name from tool state.
   */
  private extractSkillName(state: any): string | undefined {
    if (state.input && typeof state.input === "object" && state.input.name) {
      return String(state.input.name)
    }

    if (state.metadata && typeof state.metadata === "object" && state.metadata.name) {
      return String(state.metadata.name)
    }

    if (state.title && typeof state.title === "string") {
      const match = state.title.match(/Loaded skill:\s*(.+)/i)
      if (match) {
        return match[1].trim()
      }
    }

    return undefined
  }

  private resolveCurrentAgent(messages: SessionMessage[], agents?: RemoteAgent[]): RemoteAgent | undefined {
    if (!agents || agents.length === 0) {
      return undefined
    }

    const agentName = [...messages]
      .reverse()
      .map((message) => message.info.agent)
      .find((value) => typeof value === "string" && value.trim().length > 0)

    if (!agentName) {
      return undefined
    }

    return agents.find((agent) => agent.name === agentName)
  }

  private filterAccessibleSkills(skills?: RemoteSkill[], currentAgent?: RemoteAgent): RemoteSkill[] | undefined {
    if (!skills) {
      return undefined
    }

    const rules = this.getPermissionRules(currentAgent?.permission)
    const filtered = rules
      ? skills.filter((skill) => this.evaluatePermission("skill", skill.name, rules).action !== "deny")
      : skills

    return [...filtered].sort((a, b) => a.name.localeCompare(b.name))
  }

  private filterAccessibleSubagents(agents?: RemoteAgent[], currentAgent?: RemoteAgent): RemoteAgent[] | undefined {
    if (!agents) {
      return undefined
    }

    const rules = this.getPermissionRules(currentAgent?.permission)
    const subagents = agents.filter((agent) => agent.mode !== "primary")
    const filtered = rules
      ? subagents.filter((agent) => this.evaluatePermission("task", agent.name, rules).action !== "deny")
      : subagents

    return [...filtered].sort((a, b) => a.name.localeCompare(b.name))
  }

  private getPermissionRules(value: unknown): PermissionRule[] | undefined {
    if (!Array.isArray(value)) {
      return undefined
    }

    const rules = value.filter(
      (item): item is PermissionRule =>
        !!item &&
        typeof item === "object" &&
        typeof (item as any).permission === "string" &&
        typeof (item as any).pattern === "string" &&
        typeof (item as any).action === "string"
    )

    return rules.length > 0 ? rules : undefined
  }

  private evaluatePermission(permission: string, pattern: string, ruleset: PermissionRule[]): PermissionRule {
    const match = [...ruleset]
      .reverse()
      .find(
        (rule) => this.matchesWildcard(permission, rule.permission) && this.matchesWildcard(pattern, rule.pattern)
      )

    return match ?? { permission, pattern: "*", action: "ask" }
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

  private buildVerboseSkillEntry(skill: RemoteSkill): string {
    const lines = [
      "  <skill>",
      `    <name>${skill.name}</name>`,
      `    <description>${skill.description}</description>`,
    ]

    if (skill.location) {
      lines.push(`    <location>${pathToFileURL(skill.location).href}</location>`)
    }

    lines.push("  </skill>")
    return lines.join("\n")
  }

  private buildSkillSystemPrompt(skills: RemoteSkill[]): string {
    return [
      "Skills provide specialized instructions and workflows for specific tasks.",
      "Use the skill tool to load a skill when a task matches its description.",
      skills.length > 0 ? this.buildVerboseSkillCatalog(skills) : "No skills are currently available.",
    ].join("\n")
  }

  private buildVerboseSkillCatalog(skills: RemoteSkill[]): string {
    return ["<available_skills>", ...skills.map((skill) => this.buildVerboseSkillEntry(skill)), "</available_skills>"].join(
      "\n"
    )
  }

  private buildSkillToolDescription(skills: RemoteSkill[]): string {
    if (skills.length === 0) {
      return "Load a specialized skill that provides domain-specific instructions and workflows. No skills are currently available."
    }

    return [
      "Load a specialized skill that provides domain-specific instructions and workflows.",
      "",
      "When you recognize that a task matches one of the available skills listed below, use this tool to load the full skill instructions.",
      "",
      "The skill will inject detailed instructions, workflows, and access to bundled resources (scripts, references, templates) into the conversation context.",
      "",
      'Tool output includes a `<skill_content name="...">` block with the loaded content.',
      "",
      "The following skills provide specialized sets of instructions for particular tasks",
      "Invoke this tool to load a skill when a task matches one of the available skills listed below:",
      "",
      [
        "## Available Skills",
        ...skills.map((skill) => `- **${skill.name}**: ${skill.description}`),
      ].join("\n"),
    ].join("\n")
  }

  private buildSubagentBullet(agent: RemoteAgent): string {
    return `- ${agent.name}: ${this.getSubagentDescription(agent)}`
  }

  private getSubagentDescription(agent: RemoteAgent): string {
    return agent.description ?? "This subagent should only be called manually by the user."
  }

  private buildFilteredTaskDescription(description: string, agents: RemoteAgent[]): string {
    const lines = description.split(/\r?\n/)
    const headerIndex = lines.findIndex((line) => /available agent types/i.test(line))
    const nextSectionIndex = lines.findIndex((line, index) => index > headerIndex && /^When using the Task tool:/i.test(line.trim()))

    if (headerIndex === -1 || nextSectionIndex === -1) {
      return description
    }

    return [
      ...lines.slice(0, headerIndex + 1),
      ...agents.map((agent) => this.buildSubagentBullet(agent)),
      "",
      ...lines.slice(nextSectionIndex),
    ].join("\n")
  }

  private async fetchAgents(): Promise<RemoteAgent[] | undefined> {
    try {
      const agents = await this.fetchInternalJson<RemoteAgent[]>("agent")
      if (Array.isArray(agents)) {
        return agents
      }
    } catch {}

    try {
      const appAgents = (this.client as any)?.app?.agents
      if (typeof appAgents === "function") {
        const response = await appAgents.call((this.client as any).app)
        const agents = (response as any)?.data ?? response
        if (Array.isArray(agents)) {
          return agents as RemoteAgent[]
        }
      }
    } catch {}

    return undefined
  }

  private async fetchSkills(): Promise<RemoteSkill[] | undefined> {
    try {
      const skills = await this.fetchInternalJson<RemoteSkill[]>("skill")
      if (Array.isArray(skills)) {
        return skills
      }
    } catch {}

    try {
      const appSkills = (this.client as any)?.app?.skills
      if (typeof appSkills === "function") {
        const response = await appSkills.call((this.client as any).app)
        const skills = (response as any)?.data ?? response
        if (Array.isArray(skills)) {
          return skills as RemoteSkill[]
        }
      }
    } catch {}

    return undefined
  }

  private async fetchInternalJson<T>(pathname: string): Promise<T> {
    const base = new URL(this.serverUrl)
    if (!base.pathname.endsWith("/")) {
      base.pathname += "/"
    }

    const url = new URL(pathname.replace(/^\//, ""), base)
    url.searchParams.set("directory", this.directory)

    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Request failed (${response.status} ${response.statusText})`)
    }

    return (await response.json()) as T
  }
}
