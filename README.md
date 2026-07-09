# OpenCode-Tokenscope, Token Analyzer Plugin

[![npm version](https://img.shields.io/npm/v/@ramtinj95/opencode-tokenscope.svg)](https://www.npmjs.com/package/@ramtinj95/opencode-tokenscope)

> Comprehensive token usage analysis and cost tracking for OpenCode AI sessions

Track recoverable OpenCode usage, cache activity, model costs, and retained message content. Recorded telemetry is kept separate from explanatory estimates so the report does not imply precision the source data cannot support.

## Installation

### Option 1: npm (Recommended)

1. **Install globally:**
   ```bash
   npm install -g @ramtinj95/opencode-tokenscope
   ```

2. **Add to your `opencode.json`** (create one in your project root or `~/.config/opencode/opencode.json` for global config):
   ```json
   {
     "$schema": "https://opencode.ai/config.json",
     "plugin": ["@ramtinj95/opencode-tokenscope"]
   }
   ```

3. **Create the `/tokenscope` command** by creating `~/.config/opencode/command/tokenscope.md`:

```bash
mkdir -p ~/.config/opencode/command
cat > ~/.config/opencode/command/tokenscope.md << 'EOF'
---
description: Analyze token usage across the current session with detailed breakdowns by category
---

Call the tokenscope tool directly without delegating to other agents.
Leave sessionID unset unless the user explicitly asked to analyze a different session.
Then read the exact unique report path returned by TokenScope. Return that file verbatim and do nothing else with it.
EOF
```

4. **Restart OpenCode** and run `/tokenscope`

To always get the latest version automatically, use `@latest`:
```json
{
  "plugin": ["@ramtinj95/opencode-tokenscope@latest"]
}
```

### Option 2: Install Script

```bash
curl -sSL https://raw.githubusercontent.com/ramtinJ95/opencode-tokenscope/main/plugin/install.sh | bash
```

Then restart OpenCode and run `/tokenscope`

## Compatibility

TokenScope supports the OpenCode plugin client from `@opencode-ai/plugin >=1.1.48`. The accuracy contracts in this release were verified against OpenCode v1.17.18; older runtimes can differ in explanatory skill/tool formatting even when core telemetry remains available. Live OpenCode provider metadata is used when available; otherwise TokenScope falls back to its bundled pricing catalog with a visible warning.

## Updating

### If installed via npm:

| Config in `opencode.json` | Behavior |
|---------------------------|----------|
| `"@ramtinj95/opencode-tokenscope"` | Uses the version installed at install time. **Never auto-updates.** |
| `"@ramtinj95/opencode-tokenscope@latest"` | Fetches latest version **every time OpenCode starts**. |
| `"@ramtinj95/opencode-tokenscope@1.6.5"` | Pins to exact version 1.6.5. Never updates. |

To manually update:
```bash
npm update -g @ramtinj95/opencode-tokenscope
```

Or use `@latest` in your `opencode.json` to auto-update on OpenCode restart.

### If installed via script:

**Option 1: Local script** (if you have the plugin installed)
```bash
bash ~/.config/opencode/plugin/install.sh --update
```

**Option 2: Remote script** (always works)
```bash
curl -sSL https://raw.githubusercontent.com/ramtinJ95/opencode-tokenscope/main/plugin/install.sh | bash -s -- --update
```

The `--update` flag refreshes dependencies from the downloaded `package.json` before rebuilding.

## Usage

Simply type in OpenCode:
```
/tokenscope
```

The plugin will:
1. Analyze the current session
2. Tokenize retained text content into explanatory categories
3. Analyze all subagent (Task tool) child sessions recursively
4. Report OpenCode-recorded costs and separate public API-rate estimates
5. Save a unique, atomically written report under the OS temporary directory and return its exact path

### Options

- **sessionID**: Optional explicit session ID. Leave unset to analyze the current session; blank values are ignored
- **limitMessages**: Limit entries shown per category (1-10, default: 3)
- **includeSubagents**: Include subagent child session costs (default: true)

### Reading the Full Report

Use the exact path returned by the tool. Reports live in a private per-invocation directory under OpenCode's OS temporary directory rather than the analyzed worktree. Filenames include the analyzed session, invocation, and a unique nonce so concurrent sessions cannot overwrite each other; the OS owns eventual cleanup.

### Accuracy Boundary

- Recorded usage comes from persisted OpenCode `step-finish` parts. These are the strongest available source for fresh input, cache read/write, visible output, reasoning, completed provider-step count, and OpenCode-recorded cost.
- The provider step that invoked TokenScope is not included: OpenCode persists its `step-finish` only after the tool returns. Later report-reading/final-response steps are outside the same snapshot.
- OpenCode normally calculates recorded cost from normalized usage and model metadata; it is not necessarily a provider invoice. Public API-rate cost is shown separately when the recorded cost is zero.
- Local content categories are tokenizer estimates over retained text and replayable tool output. They exclude generated system prompts, provider framing, tool-call arguments, and media; they are not billable usage or an exact post-compaction active-context reconstruction.
- Compaction and active reverts can make retained transcript differ from the next provider request; deleted/reverted-away history cannot be reconstructed as lifetime spend from the session API.
- Context components, tool schemas, and skill/subagent catalogs are visibly marked estimates. TokenScope does not infer a precise system-prompt total from aggregate usage.

## Features

### Comprehensive Token Analysis
- **5 Category Breakdown**: Exposed system overrides, user messages, assistant responses, tool outputs, and reasoning traces
- **Visual Charts**: Easy-to-read ASCII bar charts with percentages and token counts
- **Explicit Uncertainty**: Keeps generated system content out of local totals when OpenCode does not expose it

### Context Breakdown Analysis
- **Observed Cache Anchor**: Uses the first recorded `cache_write` only as a bounded reference point
- **Heuristic Attribution**: Separates estimated tool definitions and environment context from unattributed cached prompt content
- **Conservative Totals**: Estimated components never exceed the observed cache-write count and no nonexistent project tree is invented

### Tool Definition Cost Estimates
- **Per-Tool Estimates**: Tokenizes raw/default-agent OpenCode tool metadata when available
- **Argument Analysis**: Infers argument count and complexity from actual tool calls in the session
- **Complexity Detection**: Distinguishes between simple arguments and complex ones (arrays/objects)

### Cache Efficiency Metrics
- **Cache Hit Rate**: Visual display of cache read vs fresh input token distribution
- **Cost Savings**: Estimates API-rate savings from prompt caching
- **Effective Rate**: Estimates the blended input rate from recorded usage and model metadata

### Accurate Cost Tracking
- **Live OpenCode Pricing Metadata**: Uses the running OpenCode instance's provider/model prices first, with a bundled models.dev-derived fallback
- **Cache-Aware Pricing**: Properly handles cache read/write tokens with discounted rates
- **Per-Call Step Telemetry**: Reads stored `step-finish` records so multi-step assistant turns and tool loops count every completed provider step, not just the final step saved on the assistant message
- **OpenCode-Compatible Tiers**: Applies arbitrary and multiple context-price thresholds per call before the legacy 200K fallback
- **Recoverable Usage Snapshot**: Aggregates persisted steps before the TokenScope invocation completes

### Subagent Cost Tracking
- **Child Session Analysis**: Recursively analyzes all subagent sessions spawned by the Task tool
- **Aggregated Totals**: Shows combined tokens, costs, and completed provider steps across the main session and all subagents
- **Per-Agent Breakdown**: Lists each subagent with its type, token usage, cost, and completed provider-step count
- **Detailed Cost Buckets**: Optional config flag expands each subagent with fresh input, cache read, cache write, output, and reasoning token buckets plus estimated per-bucket costs
- **Optional Toggle**: Enable/disable subagent analysis with the `includeSubagents` parameter

### Advanced Features
- **Tool Usage Stats**: Track which tools consume the most tokens and how many times each is called
- **Provider-Step Tracking**: See completed provider-step totals for the main session and subagents
- **Top Contributors**: Identify the biggest token consumers
- **Model Normalization**: Handles `provider/model` format automatically
- **Multi-Tokenizer Support**: Uses tiktoken for OpenAI-family models and public Hugging Face tokenizer implementations where available, with visible approximate fallbacks
- **Configurable Sections**: Enable/disable analysis features via `tokenscope-config.json`

### Skill Analysis
- **Available Skills**: Shows the available skill catalog token cost, including the verbose system-prompt catalog OpenCode injects into provider requests when skills are available
- **Available Subagents**: Shows all subagents listed in the Task tool definition with their token cost
- **Loaded Skills**: Tracks skills loaded during the session with call counts
- **Cumulative Result Tracking**: Tokenizes and sums every persisted skill result, even when repeated calls return different content sizes

## Understanding OpenCode Skill Behavior

This section explains how OpenCode handles skills and why the token counting works the way it does.

### How Skills Work

Skills are on-demand instructions that agents can load via the `skill` tool. They have multiple token consumption points:

1. **Available Skill Catalog**: Current OpenCode versions inject a verbose XML skill catalog into each provider request when skills are available to the active agent.

2. **Skill Tool Description**: The `skill` tool has a static description. TokenScope reports that description here; the schema is covered separately by tool-definition estimates.

3. **Loaded Skill Content**: When an agent calls `skill({ name: "my-skill" })`, the full SKILL.md content is loaded and returned as a tool result.

### Why Multiple Skill Calls Add Retained Content

**Important**: OpenCode does **not** deduplicate skill content. Each time the same skill is called, the full content is added to context again as a new tool result.

This means if you call `skill({ name: "git-release" })` 3 times and each result contains 500 tokens:
- Retained skill-result content = 500 × 3 = **1,500 tokens**, before accounting for how later provider calls replay or cache that content

This behavior is by design in OpenCode. You can verify this in the source code:

| Component | Source Link |
|-----------|-------------|
| Skill tool execution | [packages/opencode/src/tool/skill.ts](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/skill.ts) |
| Tool result handling | [packages/opencode/src/session/message-v2.ts](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/message-v2.ts) |
| Skill pruning protection | [packages/opencode/src/session/compaction.ts](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/compaction.ts) |

### Skill Content is Protected from Pruning

OpenCode protects skill tool results from being pruned during context management. From the [compaction.ts source](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/compaction.ts):

```typescript
const PRUNE_PROTECTED_TOOLS = ["skill"]
```

This means loaded skill content stays in context for the duration of the session (unless full session compaction/summarization occurs).

### Recommendations

- **Call skills sparingly**: Since each call adds full content, avoid calling the same skill multiple times
- **Monitor skill token usage**: Use TokenScope to see which skills consume the most tokens
- **Consider skill size**: Large skills (1000+ tokens) can quickly inflate context when called repeatedly

## Report Shape

The report deliberately separates three layers:

1. **Local content inventory** — tokenizer estimates over retained text and replayable tool output.
2. **Recorded usage snapshot** — non-overlapping OpenCode telemetry from completed provider steps.
3. **Explanatory estimates** — public API-rate cost, cache savings, cached-context attribution, tool schemas, and catalogs.

Warnings appear at the top whenever pricing, tokenizer, metadata, export, or child-session data is unavailable. The summary uses recorded cost when OpenCode stored a non-zero value; otherwise it uses the visibly labeled API-rate estimate.

## Supported Models

**Pricing resolution uses live OpenCode metadata first; the bundled fallback covers thousands of models.dev-derived provider/model entries:**

### Claude Models
- Claude Opus 4.5, 4.1, 4
- Claude Sonnet 4, 4-5, 3.7, 3.5, 3
- Claude Haiku 4-5, 3.5, 3

### OpenAI Models
- GPT-4, GPT-4 Turbo, GPT-4o, GPT-4o Mini
- GPT-3.5 Turbo
- GPT-5 and all its variations

### Other Models
- DeepSeek (R1, V2, V3)
- Llama (3.1, 3.2, 3.3)
- Mistral (Large, Small)
- Qwen, Kimi, GLM, Grok
- And more...

**Free/Open models** are marked with zero pricing.

## Configuration

TokenScope now supports a stable user override file at:

```bash
~/.config/opencode/tokenscope-config.json
```

On startup, the plugin loads config in this order:
1. `~/.config/opencode/tokenscope-config.json`
2. bundled package config: `tokenscope-config.json`
3. in-code defaults

Any missing keys are filled from the built-in defaults, so you can override only the flags you care about.
This is safer than editing the file inside the global npm package directory, because `npm update -g` can replace that installed package and overwrite local changes.

Default flags:

```json
{
  "enableContextBreakdown": true,
  "enableToolSchemaEstimation": true,
  "enableCacheEfficiency": true,
  "enableSubagentAnalysis": true,
  "enableDetailedSubagentCostBreakdown": false,
  "enableSkillAnalysis": true
}
```

Example user override:

```json
{
  "enableDetailedSubagentCostBreakdown": true,
  "enableSkillAnalysis": false
}
```

Set any option to `false` to hide that section from the output.
Set `enableDetailedSubagentCostBreakdown` to `true` to expand the subagent section with per-session token buckets and estimated API-rate cost splits. When OpenCode records a nonzero child cost, that value remains the displayed subagent total, so the estimated split may not sum exactly to it.

## Troubleshooting

### Command `/tokenscope` Not Appearing

1. Verify `tokenscope.md` exists:
   ```bash
   ls ~/.config/opencode/command/tokenscope.md
   ```
2. If missing, create it (see Installation step 3)
3. Restart OpenCode completely

### Wrong Token Counts

The plugin uses persisted OpenCode telemetry as the source of truth for recoverable completed provider steps. If counts seem off:
- **Current-turn difference from the TUI**: TokenScope runs before OpenCode persists the provider step that invoked it, and before later report-reading/final-response steps
- **Approximate fallback warning**: If the report says token counting fell back to approximate mode, reinstall the plugin (`npm install -g @ramtinj95/opencode-tokenscope@latest`) or rerun `~/.config/opencode/plugin/install.sh`
- **Model detection**: Check that the model name is recognized in the output

## Privacy & Security

- **All processing is local**: No session data sent to external services
- **Private reports**: Report directories use owner-only permissions on Unix and live outside analyzed worktrees
- **Open source**: Audit the code yourself

## Contributing

Contributions welcome! Ideas for enhancement:

- Historical trend analysis
- Export to CSV/JSON/PDF
- Optimization suggestions
- Custom categorization rules
- Real-time monitoring with alerts
- Compare sessions
- Token burn rate calculation

## Support

- **Issues**: [GitHub Issues](https://github.com/ramtinJ95/opencode-tokenscope/issues)
- **Discussions**: [GitHub Discussions](https://github.com/ramtinJ95/opencode-tokenscope/discussions)
