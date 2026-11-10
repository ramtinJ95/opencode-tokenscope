// OpenCode V2 plugin boundary. Everything TokenScope reads from the host goes through the
// plugin context here and is converted into TokenScope's own normalized types.

import type { Plugin } from "@opencode/plugin"
import type { SessionContext } from "@opencode/plugin/promise/session"

import type {
  ChildSession,
  RequestSnapshot,
  SessionMessage,
  SessionMessagePart,
  SystemSnapshotPart,
  ToolState,
} from "./types.js"

export type OpenCodeContext = Plugin.Context
type SessionApi = OpenCodeContext["session"]

export type SessionReader = Pick<SessionApi, "context" | "list">
export type ModelReader = Pick<OpenCodeContext["model"], "list">
export type CatalogReader = {
  agent: Pick<OpenCodeContext["agent"], "list">
  skill: Pick<OpenCodeContext["skill"], "list">
}

export type OpenCodeMessage = Awaited<ReturnType<SessionApi["context"]>>[number]
export type OpenCodeSession = Awaited<ReturnType<SessionApi["get"]>>
export type OpenCodeModel = Awaited<ReturnType<OpenCodeContext["model"]["list"]>>["data"][number]
export type OpenCodeAgent = Awaited<ReturnType<OpenCodeContext["agent"]["list"]>>["data"][number]
export type OpenCodeSkill = Awaited<ReturnType<OpenCodeContext["skill"]["list"]>>["data"][number]

type AssistantMessage = Extract<OpenCodeMessage, { type: "assistant" }>
type AssistantContent = AssistantMessage["content"][number]
type ToolContent = ReadonlyArray<{ type: string; text?: string }>

const CHILD_SESSION_PAGE_SIZE = 100
const MAX_REQUEST_SNAPSHOTS = 32

function toolContentText(content: ToolContent | undefined): string | undefined {
  const text = (content ?? [])
    .map((item) => (item.type === "text" ? (item.text ?? "") : ""))
    .filter(Boolean)
    .join("\n")
  return text || undefined
}

function normalizeToolState(state: Extract<AssistantContent, { type: "tool" }>["state"]): ToolState {
  switch (state.status) {
    case "streaming":
      return { status: "streaming" }
    case "running":
      return { status: "running", input: state.input, metadata: state.metadata }
    case "completed":
      return {
        status: "completed",
        input: state.input,
        output: toolContentText(state.content),
        metadata: state.metadata,
      }
    case "error":
      return {
        status: "error",
        input: state.input,
        output: toolContentText(state.content) ?? state.error.message,
        metadata: state.metadata,
      }
  }
}

function normalizeAssistantContent(content: AssistantContent): SessionMessagePart {
  switch (content.type) {
    case "text":
      return { type: "text", text: content.text }
    case "reasoning":
      return { type: "reasoning", text: content.text }
    case "tool":
      return { type: "tool", tool: content.name, state: normalizeToolState(content.state) }
  }
}

/**
 * Converts one OpenCode message into TokenScope's transcript shape. Returns undefined for
 * bookkeeping messages that carry no model-visible content or usage.
 */
export function normalizeMessage(message: OpenCodeMessage): SessionMessage | undefined {
  switch (message.type) {
    case "user":
    case "synthetic":
      return { info: { id: message.id, role: "user" }, parts: [{ type: "text", text: message.text }] }

    case "system":
      return { info: { id: message.id, role: "system" }, parts: [{ type: "text", text: message.text }] }

    // A skill the user invoked directly reaches the model in the same shape the skill tool returns.
    case "skill":
      return {
        info: { id: message.id, role: "user" },
        parts: [
          {
            type: "tool",
            tool: "skill",
            state: {
              status: "completed",
              input: { id: message.skill },
              output: message.text,
              metadata: { name: message.name },
            },
          },
        ],
      }

    case "shell":
      return {
        info: { id: message.id, role: "user" },
        parts: [
          {
            type: "tool",
            tool: "shell",
            state: {
              status: message.status === "running" ? "running" : "completed",
              input: { command: message.command },
              output: message.output?.output,
            },
          },
        ],
      }

    case "assistant":
      return {
        info: {
          id: message.id,
          role: "assistant",
          agent: message.agent,
          model: { providerID: message.model.providerID, modelID: message.model.id },
          tokens: message.tokens,
          cost: message.cost,
        },
        parts: message.content.map(normalizeAssistantContent),
      }

    // A compaction is a model request of its own. Its summary replaces the history before it.
    case "compaction":
      if (message.status === "running") return undefined
      return {
        info: {
          id: message.id,
          role: "assistant",
          model:
            message.status === "completed" && message.model
              ? { providerID: message.model.providerID, modelID: message.model.id }
              : undefined,
          tokens: message.tokens,
          cost: message.cost,
        },
        parts: message.status === "completed" ? [{ type: "text", text: message.summary }] : [],
      }

    case "agent-switched":
    case "model-switched":
    case "location-switched":
    case "idle":
      return undefined
  }
}

export function normalizeMessages(messages: readonly OpenCodeMessage[]): SessionMessage[] {
  return messages.flatMap((message) => normalizeMessage(message) ?? [])
}

/**
 * OpenCode only exposes the active context to plugins: the messages from the last completed
 * compaction onward. A completed compaction in that window means earlier history is not visible.
 */
export function hasCompactedHistory(messages: readonly OpenCodeMessage[]): boolean {
  return messages.some((message) => message.type === "compaction" && message.status === "completed")
}

export async function loadSessionMessages(session: Pick<SessionApi, "context">, sessionID: string): Promise<SessionMessage[]> {
  return normalizeMessages(await session.context({ sessionID }))
}

export async function listChildSessions(session: Pick<SessionApi, "list">, parentID: string): Promise<ChildSession[]> {
  const children: ChildSession[] = []
  let cursor: string | undefined

  do {
    const page = await session.list(
      cursor ? { cursor, limit: CHILD_SESSION_PAGE_SIZE } : { parentID, limit: CHILD_SESSION_PAGE_SIZE }
    )
    for (const child of page.data) {
      children.push({ id: child.id, title: child.title, agent: child.agent })
    }
    cursor = page.cursor.next ?? undefined
  } while (cursor)

  return children
}

function readInstructionSources(metadata: unknown): SystemSnapshotPart["instructions"] {
  const sources = (metadata as { experimental?: { instructions?: unknown } } | undefined)?.experimental?.instructions
  if (!Array.isArray(sources)) return undefined

  const instructions = sources.flatMap((source) =>
    source && typeof source.key === "string" && typeof source.text === "string"
      ? [{ key: source.key as string, text: source.text as string }]
      : []
  )
  return instructions.length > 0 ? instructions : undefined
}

export function captureRequestSnapshot(event: Pick<SessionContext, "system" | "tools">): RequestSnapshot {
  return {
    system: event.system.map((part) => ({ text: part.text, instructions: readInstructionSources(part.metadata) })),
    tools: Object.entries(event.tools).map(([id, tool]) => ({ id, description: tool.description, schema: tool.input })),
  }
}

/**
 * Remembers the system prompt and tool definitions of the latest model request per session.
 * Bounded so long-running servers do not retain a prompt for every session they ever served.
 */
export class RequestSnapshotStore {
  private snapshots = new Map<string, RequestSnapshot>()

  set(sessionID: string, snapshot: RequestSnapshot): void {
    this.snapshots.delete(sessionID)
    this.snapshots.set(sessionID, snapshot)

    if (this.snapshots.size > MAX_REQUEST_SNAPSHOTS) {
      const oldest = this.snapshots.keys().next().value
      if (oldest !== undefined) this.snapshots.delete(oldest)
    }
  }

  get(sessionID: string): RequestSnapshot | undefined {
    return this.snapshots.get(sessionID)
  }
}
