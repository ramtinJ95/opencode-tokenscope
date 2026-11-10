// RPC contract between TokenScope's server part and its UI parts.
//
// The server part implements it; the TUI part calls it to render a report natively instead of
// having the model echo a text file. This module is bundled into the compiled TUI part, so it must
// stay free of runtime imports.

import type { Rpc } from "@opencode/plugin/rpc"

export interface ReportRow {
  label: string
  tokens: number
  // Extra lines shown under the row, such as the files behind "Custom Instructions".
  detail?: string[]
}

export interface ReportUsage {
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
  reasoning: number
  cost: number
}

// "recorded" is OpenCode's own cost; "estimated" is API-rate pricing used where OpenCode recorded $0.
export type CostBasis = "recorded" | "estimated"

export interface ReportView {
  sessionID: string
  generatedAt: number
  model: string
  tokenizer: "tiktoken" | "huggingface" | "approx"
  warnings: string[]

  // What fills the context window, by source. The provider reports one count per request, so the
  // split comes from local tokenization. When `scale` is set, the rows were multiplied by it so
  // they add up to the context OpenCode recorded for the last request, and `tools`,
  // `topContributors` and `context` are scaled the same way. Without it, every one of them is an
  // unscaled local estimate.
  content: {
    rows: ReportRow[]
    total: number
    scale?: number
  }
  // Tool output by tool; adds up to the "Tool output" row.
  tools: Array<{ name: string; tokens: number; calls: number }>
  topContributors: ReportRow[]

  // Usage OpenCode recorded for completed provider steps.
  steps: number
  lastStep: ReportUsage
  recorded: ReportUsage
  // Cost of the main session alone.
  costBasis: CostBasis
  cost: number

  // System prompt and tool definitions sent with every request.
  context?: {
    measured: boolean
    total: number
    components: ReportRow[]
  }
  cache?: {
    hitRate: number
    savings: number
    savingsPercent: number
  }
  subagents?: {
    steps: number
    tokens: number
    cost: number
    sessions: Array<{
      title: string
      agent: string
      tokens: number
      cost: number
      costBasis: CostBasis
      steps: number
    }>
  }

  // Main session plus subagents. The cost is "mixed" when it adds recorded and estimated amounts.
  total: { cost: number; costBasis: CostBasis | "mixed"; tokens: number; steps: number }
}

// RPC failures reject with a plain `{ type, message }` value. Solid's createResource replaces any
// rejection that is not an Error with "Unknown error", so callers convert them with this first.
export function toError(failure: unknown): Error {
  if (failure instanceof Error) return failure
  if (failure && typeof failure === "object" && "message" in failure && typeof failure.message === "string") {
    return new Error(
      "type" in failure && failure.type === "rpc.unavailable"
        ? `${failure.message}. The TokenScope server plugin is not loaded for this session's project.`
        : failure.message,
      { cause: failure }
    )
  }
  return new Error(String(failure), { cause: failure })
}

export const TokenscopeRpc = {
  id: "tokenscope",
  methods: {
    report: {
      input: {
        type: "object",
        properties: {
          sessionID: { type: "string" },
          limitMessages: { type: "integer", minimum: 1, maximum: 10 },
          includeSubagents: { type: "boolean" },
        },
        required: ["sessionID"],
        additionalProperties: false,
      },
      // The payload is a ReportView. Its shape is owned by the TypeScript interface above.
      output: { type: "object" },
      // Undeclared handler failures reach callers as an opaque "RPC call failed", so the two ways
      // a report can be unavailable are declared. Their message carries the reason.
      errors: {
        empty_session: { type: "object", additionalProperties: false },
        analysis_failed: { type: "object", additionalProperties: false },
      },
    },
  },
  events: {},
} as const satisfies Rpc.PortableDefinition
