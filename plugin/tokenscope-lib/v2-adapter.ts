// OpenCode v2 plugin-context adapter.
//
// OpenCode v2 plugins receive a domain-scoped context instead of the v1 SDK
// client, and v2 persists a different message shape:
//
//   v2: { type: "assistant", model: {...}, content: [{ type, ... }], tokens, cost }
//   v1: { info: { role, model, tokens, cost, system }, parts: [{ type, ... }] }
//
// The rest of TokenScope is written against the v1 shape and the normalized
// client surface in opencode.ts. This adapter converts a v2 context and message
// list into those shapes so the analysis pipeline stays single-sourced.

import type { SessionMessage, SessionMessagePart, ToolState } from "./types.js"

function unwrap<T>(value: any): T {
  return ((value as any)?.data ?? value) as T
}

function resolveSessionID(args: any): string | undefined {
  return args?.sessionID ?? args?.path?.id ?? args?.path?.sessionID ?? args?.id
}

function toolStateToV1(state: any): ToolState {
  const status = state?.status
  const normalizedStatus: ToolState["status"] =
    status === "completed" || status === "error" || status === "running" ? status : "running"

  const content = Array.isArray(state?.content) ? state.content : undefined
  const text = content
    ?.map((item: any) => {
      if (item?.type === "text") return item.text ?? ""
      if (item?.type === "file") return `[file: ${item?.name ?? item?.uri ?? "attachment"}]`
      return ""
    })
    .filter((value: string) => value.length > 0)
    .join("\n")

  return {
    status: normalizedStatus,
    input: state?.input,
    output: text || state?.output,
    error: state?.error?.message,
    metadata: state?.metadata,
    time: state?.time,
  }
}

/**
 * Convert an OpenCode v2 message list into the v1 { info, parts } shape the
 * analyzer and telemetry helpers consume.
 */
export function toV1Messages(messages: readonly any[] | undefined): SessionMessage[] {
  const converted: SessionMessage[] = []

  for (const message of messages ?? []) {
    const type = message?.type

    if (type === "user") {
      const parts: SessionMessagePart[] = []
      if (typeof message.text === "string" && message.text.trim()) {
        parts.push({ type: "text", text: message.text })
      }
      converted.push({
        info: { id: message.id, role: "user", agent: message.agent, tokens: message.tokens, cost: message.cost },
        parts,
      })
      continue
    }

    if (type === "assistant") {
      const parts: SessionMessagePart[] = []
      for (const content of message.content ?? []) {
        if (content?.type === "text") {
          parts.push({ type: "text", text: content.text ?? "" })
        } else if (content?.type === "reasoning") {
          parts.push({ type: "reasoning", text: content.text ?? "" })
        } else if (content?.type === "tool") {
          parts.push({ type: "tool", tool: content.name, state: toolStateToV1(content.state) })
        }
      }
      converted.push({
        info: {
          id: message.id,
          role: "assistant",
          agent: message.agent,
          model: message.model,
          providerID: message.model?.providerID,
          modelID: message.model?.id,
          tokens: message.tokens,
          cost: message.cost,
        },
        parts,
        model: message.model,
        providerID: message.model?.providerID,
        modelID: message.model?.id,
      })
      continue
    }

    // System context updates persist as their own message type in v2. Surface
    // them as the v1 "system override on a user message" so the system category
    // and context breakdown can see them.
    if (type === "system") {
      converted.push({
        info: { id: message.id, role: "user", system: typeof message.text === "string" ? message.text : undefined },
        parts: [],
      })
      continue
    }

    // A loaded skill and a shell result are model-visible output in v2. Present
    // them as completed tool results so tool accounting and loaded-skill
    // detection keep working.
    if (type === "skill") {
      converted.push({
        info: { id: message.id, role: "assistant" },
        parts: [
          {
            type: "tool",
            tool: "skill",
            state: {
              status: "completed",
              input: { name: message.name ?? message.skill },
              output: typeof message.text === "string" ? message.text : "",
              metadata: { name: message.name ?? message.skill },
            },
          },
        ],
      })
      continue
    }

    if (type === "shell") {
      const output = message.output?.output
      const status = message.status === "exited" ? "completed" : "running"
      converted.push({
        info: { id: message.id, role: "assistant" },
        parts: [
          {
            type: "tool",
            tool: "shell",
            state: {
              status: status as ToolState["status"],
              input: { command: message.command },
              output: typeof output === "string" ? output : undefined,
            },
          },
        ],
      })
      continue
    }

    // Synthetic messages are injected user-role context.
    if (type === "synthetic") {
      const parts: SessionMessagePart[] = []
      if (typeof message.text === "string" && message.text.trim()) {
        parts.push({ type: "text", text: message.text })
      }
      converted.push({ info: { id: message.id, role: "user" }, parts })
    }

    // agent-switched / model-switched / location-switched / compaction / idle
    // carry no retained model-visible text worth counting here.
  }

  return converted
}

export interface V2ProviderPricingModel {
  id: string
  cost?: Record<string, unknown>
  limit?: Record<string, unknown>
}

/**
 * Build the `{ all: [{ id, models }] }` pricing view that metadata.ts expects,
 * from the v2 model catalog.
 */
export function buildProviderPricing(models: readonly any[] | undefined): Array<{ id: string; models: Record<string, any> }> {
  const providers = new Map<string, { id: string; models: Record<string, any> }>()

  for (const model of models ?? []) {
    const providerID = model?.providerID
    if (!providerID) continue

    let provider = providers.get(providerID)
    if (!provider) {
      provider = { id: providerID, models: {} }
      providers.set(providerID, provider)
    }

    const costs = Array.isArray(model.cost) ? model.cost : []
    const base = costs.find((entry: any) => !entry?.tier) ?? costs[0]
    const tiers = costs.filter((entry: any) => entry?.tier)

    const modelID = model.modelID ?? model.id
    if (!modelID) continue

    provider.models[modelID] = {
      id: modelID,
      cost: base
        ? {
            input: base.input,
            output: base.output,
            cache: { read: base.cache?.read ?? 0, write: base.cache?.write ?? 0 },
            tiers: tiers.map((tier: any) => ({
              tier: tier.tier,
              input: tier.input,
              output: tier.output,
              cache: { read: tier.cache?.read ?? 0, write: tier.cache?.write ?? 0 },
            })),
          }
        : undefined,
      limit: model.limit,
    }
  }

  return Array.from(providers.values())
}

/**
 * Adapt an OpenCode v2 plugin context into the normalized client surface used
 * throughout tokenscope-lib.
 */
export function createV2Client(ctx: any, directory: string) {
  const listTools = async () => {
    const list = unwrap<any[]>(await ctx.tool.list()) ?? []
    return list.map((tool: any) => ({
      id: tool?.name ?? tool?.id,
      description: tool?.description,
      jsonSchema: tool?.input,
    }))
  }

  return {
    session: {
      async messages(args: any) {
        const sessionID = resolveSessionID(args)
        const messages = await ctx.session.context({ sessionID })
        return { data: toV1Messages(unwrap<any[]>(messages) ?? []) }
      },
      async get(args: any) {
        const sessionID = resolveSessionID(args)
        return { data: unwrap(await ctx.session.get({ sessionID })) }
      },
      async children(args: any) {
        const parentID = resolveSessionID(args)
        const list = (ctx.session as any)?.list
        if (typeof list !== "function") {
          throw new Error("OpenCode v2 plugin session list API is unavailable")
        }
        const children = await list.call(ctx.session, { parentID, directory })
        return { data: unwrap<any[]>(children) ?? [] }
      },
    },
    tool: {
      async list() {
        return { data: await listTools() }
      },
    },
    provider: {
      async list() {
        const models = unwrap<any[]>(await ctx.model.list()) ?? []
        return { data: { all: buildProviderPricing(models) } }
      },
    },
    app: {
      async agents() {
        return { data: unwrap<any[]>(await ctx.agent.list()) ?? [] }
      },
      async skills() {
        return { data: unwrap<any[]>(await ctx.skill.list()) ?? [] }
      },
    },
  }
}
