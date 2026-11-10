// TokenScope TUI part (OpenCode V2). `/tokenscope` opens a session panel that renders the report
// natively. The report comes from the server part over RPC, so no model request is made and
// nothing is added to the session being measured.

import { Plugin } from "@opencode/plugin/tui"
import type { PanelInput } from "@opencode/plugin/tui/context"
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { createEffect, createMemo, createResource, For, on, Show } from "solid-js"

import { TokenscopeRpc, type ReportRow, type ReportUsage, type ReportView } from "./tokenscope-lib/rpc.js"

const PANEL_NAME = "tokenscope.report"
const LABEL_WIDTH = 24
const VALUE_WIDTH = 10
const PERCENT_WIDTH = 7
const MIN_BAR_WIDTH = 6
const MAX_BAR_WIDTH = 40
const SCROLL_STEP = 3
const SCROLL_PAGE = 20

const integer = new Intl.NumberFormat("en-US")

function tokens(value: number): string {
  return integer.format(value)
}

function usd(value: number): string {
  return `$${value.toFixed(value !== 0 && Math.abs(value) < 0.01 ? 4 : 2)}`
}

function percent(part: number, whole: number): string {
  return whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : ""
}

// RPC failures arrive as plain `{ type, message }` values, not Error instances.
function failureMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return "type" in error && error.type === "rpc.unavailable"
      ? `${error.message}. The TokenScope server plugin is not loaded for this session's project.`
      : error.message
  }
  return String(error)
}

function usageRows(usage: ReportUsage): ReportRow[] {
  return [
    { label: "Input (fresh)", tokens: usage.input },
    { label: "Cache read", tokens: usage.cacheRead },
    { label: "Cache write", tokens: usage.cacheWrite },
    { label: "Output", tokens: usage.output },
    { label: "Reasoning", tokens: usage.reasoning },
  ].filter((row) => row.tokens > 0)
}

function usageTotal(usage: ReportUsage): number {
  return usage.input + usage.cacheRead + usage.cacheWrite + usage.output + usage.reasoning
}

function TokenscopePanel(props: { context: Plugin.Context; panel: PanelInput }) {
  const theme = props.context.theme
  const accent = () => theme.categorical[0]?.[200] ?? theme.text.base
  let scroll: ScrollBoxRenderable | undefined

  const [report, { refetch }] = createResource(
    () => props.panel.sessionID,
    async (sessionID): Promise<ReportView> => {
      const directory = props.context.data.session.get(sessionID)?.location.directory
      const output = await props.context.client
        .rpc(TokenscopeRpc)
        .report({ sessionID }, directory ? { location: { directory } } : undefined)
      return output as ReportView
    }
  )

  // Keep the open panel current: reload when the session finishes a run.
  const status = createMemo(() => props.context.data.session.status(props.panel.sessionID))
  createEffect(
    on(
      status,
      (current, previous) => {
        if (previous === "running" && current === "idle") void refetch()
      },
      { defer: true }
    )
  )

  props.context.keymap.layer(() => ({
    commands: [
      { bind: "escape", title: "close", run: () => props.panel.close() },
      { bind: "r", title: "refresh", run: () => void refetch() },
      { bind: "f", title: "full screen", run: () => props.panel.toggleFullscreen() },
      { bind: "down", run: () => scroll?.scrollBy(SCROLL_STEP) },
      { bind: "up", run: () => scroll?.scrollBy(-SCROLL_STEP) },
      { bind: "pagedown", run: () => scroll?.scrollBy(SCROLL_PAGE) },
      { bind: "pageup", run: () => scroll?.scrollBy(-SCROLL_PAGE) },
    ],
  }))

  // Two columns of padding on each side, one space between each column.
  const barWidth = createMemo(() =>
    Math.max(
      MIN_BAR_WIDTH,
      Math.min(MAX_BAR_WIDTH, props.panel.width - 4 - LABEL_WIDTH - VALUE_WIDTH - PERCENT_WIDTH - 3)
    )
  )

  const Section = (section: { title: string; note?: string; children: any }) => (
    <box flexDirection="column" flexShrink={0}>
      <box flexDirection="row" gap={1}>
        <text fg={theme.text.base} attributes={TextAttributes.BOLD} wrapMode="none">
          {section.title}
        </text>
        <Show when={section.note}>
          <text fg={theme.text.faint} wrapMode="none">
            {section.note}
          </text>
        </Show>
      </box>
      {section.children}
    </box>
  )

  const Bars = (bars: { rows: ReportRow[]; total: number; suffix?: (row: ReportRow) => string }) => (
    <For each={bars.rows}>
      {(row) => {
        const filled = () =>
          bars.total > 0 ? Math.max(1, Math.round((row.tokens / bars.total) * barWidth())) : 0
        return (
          <>
            <box flexDirection="row" gap={1} height={1}>
              <text fg={theme.text.muted} width={LABEL_WIDTH} wrapMode="none" truncate>
                {row.label}
              </text>
              <box flexDirection="row" width={barWidth()}>
                <text fg={accent()} selectable={false}>
                  {"█".repeat(Math.min(filled(), barWidth()))}
                </text>
                <text fg={theme.text.faint} selectable={false}>
                  {"░".repeat(Math.max(0, barWidth() - filled()))}
                </text>
              </box>
              <text fg={theme.text.base} width={VALUE_WIDTH} wrapMode="none">
                {tokens(row.tokens).padStart(VALUE_WIDTH)}
              </text>
              <text fg={theme.text.muted} wrapMode="none">
                {bars.suffix ? bars.suffix(row) : percent(row.tokens, bars.total).padStart(PERCENT_WIDTH - 1)}
              </text>
            </box>
            <For each={row.detail ?? []}>
              {(line) => (
                <text fg={theme.text.faint} wrapMode="none" truncate>
                  {`  → ${line}`}
                </text>
              )}
            </For>
          </>
        )
      }}
    </For>
  )

  const Line = (line: { label: string; value: string; strong?: boolean }) => (
    <box flexDirection="row" gap={1} height={1}>
      <text fg={theme.text.muted} width={LABEL_WIDTH} wrapMode="none" truncate>
        {line.label}
      </text>
      <text
        fg={theme.text.base}
        attributes={line.strong ? TextAttributes.BOLD : TextAttributes.NONE}
        wrapMode="none"
      >
        {line.value}
      </text>
    </box>
  )

  const Report = (view: { report: ReportView }) => {
    const data = () => view.report
    const toolTotal = () => data().tools.reduce((sum, tool) => sum + tool.tokens, 0)
    const calls = () => new Map(data().tools.map((tool) => [tool.name, tool.calls]))

    return (
      <box flexDirection="column" gap={1}>
        <box flexDirection="column" flexShrink={0}>
          <text fg={theme.text.muted} wrapMode="none" truncate>
            {`${data().model} · ${data().steps} steps · ${data().tokenizer} tokenizer`}
          </text>
          <text fg={theme.text.base} attributes={TextAttributes.BOLD} wrapMode="none">
            {`${usd(data().total.cost)} · ${tokens(data().total.tokens)} tokens`}
            {data().costBasis === "estimated" ? " (API-rate estimate)" : ""}
          </text>
        </box>

        <Show when={data().warnings.length > 0}>
          <box flexDirection="column" flexShrink={0}>
            <For each={data().warnings}>
              {(warning) => <text fg={theme.text.feedback.warning.base}>{`! ${warning}`}</text>}
            </For>
          </box>
        </Show>

        <Show when={data().steps > 0}>
          <Section title="Last request" note="recorded by OpenCode">
            <Bars rows={usageRows(data().lastStep)} total={usageTotal(data().lastStep)} />
            <Line label="Total" value={`${tokens(usageTotal(data().lastStep))} tokens`} strong />
          </Section>
        </Show>

        <Section
          title="Context window"
          note={
            data().content.scale === undefined
              ? "local estimate"
              : `recorded total, local split scaled ×${data().content.scale!.toFixed(2)}`
          }
        >
          <Bars rows={data().content.rows} total={data().content.total} />
          <Line label="Total" value={`${tokens(data().content.total)} tokens`} strong />
        </Section>

        <Show when={data().context}>
          {(context) => (
            <Section
              title="Always-sent context"
              note={context().measured ? "measured from the latest request" : "estimated from the first cache write"}
            >
              <Bars rows={context().components} total={context().total} />
              <Line label="Total" value={`${context().measured ? "~" : ""}${tokens(context().total)} tokens`} strong />
            </Section>
          )}
        </Show>

        <Show when={data().tools.length > 0}>
          <Section title="Tool output">
            <Bars
              rows={data()
                .tools.filter((tool) => tool.tokens > 0)
                .map((tool) => ({ label: tool.name, tokens: tool.tokens }))}
              total={toolTotal()}
              suffix={(row) => `${calls().get(row.label) ?? 0}x`.padStart(PERCENT_WIDTH - 1)}
            />
          </Section>
        </Show>

        <Show when={data().topContributors.length > 0}>
          <Section title="Top contributors">
            <Bars rows={data().topContributors} total={data().content.total} />
          </Section>
        </Show>

        <Section title="Recorded usage" note={`${data().steps} completed steps`}>
          <Bars rows={usageRows(data().recorded)} total={usageTotal(data().recorded)} />
          <Line label="Total" value={`${tokens(usageTotal(data().recorded))} tokens`} strong />
          <Line
            label={data().costBasis === "estimated" ? "Cost (API-rate estimate)" : "Cost (recorded)"}
            value={usd(data().cost)}
            strong
          />
          <Show when={data().cache}>
            {(cache) => (
              <Line
                label="Cache hit rate"
                value={`${cache().hitRate.toFixed(1)}% · saved ${usd(cache().savings)} (${cache().savingsPercent.toFixed(1)}%)`}
              />
            )}
          </Show>
        </Section>

        <Show when={data().subagents}>
          {(subagents) => (
            <Section
              title="Subagents"
              note={`${subagents().sessions.length} child ${subagents().sessions.length === 1 ? "session" : "sessions"}`}
            >
              <For each={subagents().sessions}>
                {(session) => (
                  <Line
                    label={session.agent}
                    value={`${usd(session.cost)} · ${tokens(session.tokens)} tokens · ${session.steps} steps`}
                  />
                )}
              </For>
              <Line
                label="Session + subagents"
                value={`${usd(data().total.cost)} · ${tokens(data().total.tokens)} tokens · ${data().total.steps} steps`}
                strong
              />
            </Section>
          )}
        </Show>
      </box>
    )
  }

  return (
    <box width="100%" height="100%" flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1}>
      <box flexDirection="row" justifyContent="space-between" height={2} flexShrink={0}>
        <text fg={theme.text.base} attributes={TextAttributes.BOLD} wrapMode="none">
          TokenScope
        </text>
        <text fg={theme.text.faint} wrapMode="none">
          r refresh · f full screen · esc close
        </text>
      </box>
      <scrollbox
        ref={(element: ScrollBoxRenderable) => (scroll = element)}
        flexGrow={1}
        minHeight={0}
        verticalScrollbarOptions={{ visible: false }}
        horizontalScrollbarOptions={{ visible: false }}
      >
        <Show
          when={!report.error}
          fallback={
            <text fg={theme.text.feedback.error.base}>{`Could not load the report: ${failureMessage(report.error)}`}</text>
          }
        >
          <Show when={report()} fallback={<text fg={theme.text.muted}>Analyzing session…</text>}>
            {(value) => <Report report={value()} />}
          </Show>
        </Show>
      </scrollbox>
    </box>
  )
}

export default Plugin.define({
  id: "tokenscope.tui",
  setup(context) {
    context.ui.slot({
      append: "session.panel",
      render: (panel) => (
        <Show when={panel.name === PANEL_NAME}>
          <TokenscopePanel context={context} panel={panel} />
        </Show>
      ),
    })

    context.ui.slot({
      append: "app",
      render: () => {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "tokenscope.open",
              title: "Token usage report",
              description: "Show token usage for this session",
              group: "Session",
              slash: { name: "tokenscope" },
              palette: true,
              run: () => {
                context.ui.dialog.clear()
                const route = context.ui.router.current()
                const current = context.ui.panel.current()
                if (route.type === "session" && current?.name === PANEL_NAME && current.sessionID === route.sessionID) {
                  context.ui.panel.close()
                  return
                }
                if (!context.ui.panel.open(PANEL_NAME)) {
                  context.ui.toast.show({ message: "Open a session to see its token usage.", variant: "info" })
                }
              },
            },
          ],
        }))
        return null
      },
    })
  },
})
