# OpenCode-Tokenscope, Token Analyzer Plugin

[![npm version](https://img.shields.io/npm/v/@ramtinj95/opencode-tokenscope.svg)](https://www.npmjs.com/package/@ramtinj95/opencode-tokenscope)

> Comprehensive token usage analysis and cost tracking for OpenCode AI sessions

Track and optimize your token usage across system prompts, user messages, tool outputs, and more. Get detailed breakdowns, accurate cost estimates, and visual insights for your AI development workflow.

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
Then cat the token-usage-output.txt. DONT DO ANYTHING ELSE WITH THE OUTPUT.
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

## Updating

### If installed via npm:

| Config in `opencode.json` | Behavior |
|---------------------------|----------|
| `"@ramtinj95/opencode-tokenscope"` | Uses the version installed at install time. **Never auto-updates.** |
| `"@ramtinj95/opencode-tokenscope@latest"` | Fetches latest version **every time OpenCode starts**. |
| `"@ramtinj95/opencode-tokenscope@1.4.0"` | Pins to exact version 1.4.0. Never updates. |

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

The `--update` flag skips dependency installation for faster updates.

## Usage

Simply type in OpenCode:
```
/tokenscope
```

The plugin will:
1. Analyze the current session
2. Count tokens across all categories
3. Analyze all subagent (Task tool) child sessions recursively
4. Calculate costs based on API telemetry
5. Save detailed report to `token-usage-output.txt`

### Options

- **sessionID**: Analyze a specific session instead of the current one
- **limitMessages**: Limit entries shown per category (1-10, default: 3)
- **includeSubagents**: Include subagent child session costs (default: true)

### Reading the Full Report

```bash
cat token-usage-output.txt
```

## Features

### Comprehensive Token Analysis
- **5 Category Breakdown**: System prompts, user messages, assistant responses, tool outputs, and reasoning traces
- **Visual Charts**: Easy-to-read ASCII bar charts with percentages and token counts
- **Smart Inference**: Automatically infers system prompts from API telemetry (since they're not exposed in session messages)

### Context Breakdown Analysis
- **System Prompt Components**: See token distribution across base prompt, tool definitions, environment context, project tree, and custom instructions
- **Automatic Estimation**: Estimates breakdown from `cache_write` tokens when system prompt content isn't directly available
- **Tool Count**: Shows how many tools are loaded and their combined token cost

### Tool Definition Cost Estimates
- **Per-Tool Estimates**: Lists all enabled tools with estimated schema token costs
- **Argument Analysis**: Infers argument count and complexity from actual tool calls in the session
- **Complexity Detection**: Distinguishes between simple arguments and complex ones (arrays/objects)

### Cache Efficiency Metrics
- **Cache Hit Rate**: Visual display of cache read vs fresh input token distribution
- **Cost Savings**: Calculates actual savings from prompt caching
- **Effective Rate**: Shows what you're actually paying per token vs standard rates

### Accurate Cost Tracking
- **41+ Models Supported**: Comprehensive pricing database for Claude, GPT, DeepSeek, Llama, Mistral, and more
- **Cache-Aware Pricing**: Properly handles cache read/write tokens with discounted rates
- **Session-Wide Billing**: Aggregates costs across all API calls in your session

### Subagent Cost Tracking
- **Child Session Analysis**: Recursively analyzes all subagent sessions spawned by the Task tool
- **Aggregated Totals**: Shows combined tokens, costs, and API calls across main session and all subagents
- **Per-Agent Breakdown**: Lists each subagent with its type, token usage, cost, and API call count
- **Optional Toggle**: Enable/disable subagent analysis with the `includeSubagents` parameter

### Advanced Features
- **Tool Usage Stats**: Track which tools consume the most tokens and how many times each is called
- **API Call Tracking**: See total API calls for main session and subagents
- **Top Contributors**: Identify the biggest token consumers
- **Model Normalization**: Handles `provider/model` format automatically
- **Multi-Tokenizer Support**: Uses official tokenizers (tiktoken for OpenAI, transformers for others)
- **Configurable Sections**: Enable/disable analysis features via `tokenscope-config.json`

### Skill Analysis
- **Available Skills**: Shows all skills listed in the skill tool definition with their token cost
- **Loaded Skills**: Tracks skills loaded during the session with call counts
- **Cumulative Token Tracking**: Accurately counts token cost when skills are called multiple times

## Understanding OpenCode Skill Behavior

This section explains how OpenCode handles skills and why the token counting works the way it does.

### How Skills Work

Skills are on-demand instructions that agents can load via the `skill` tool. They have two token consumption points:

1. **Available Skills List**: Skill names and descriptions are embedded in the `skill` tool's description as XML. This is part of the system prompt and costs tokens on **every API call**.

2. **Loaded Skill Content**: When an agent calls `skill({ name: "my-skill" })`, the full SKILL.md content is loaded and returned as a tool result.

### Why Multiple Skill Calls Multiply Token Cost

**Important**: OpenCode does **not** deduplicate skill content. Each time the same skill is called, the full content is added to context again as a new tool result.

This means if you call `skill({ name: "git-release" })` 3 times and it contains 500 tokens:
- Total context cost = 500 × 3 = **1,500 tokens**

This behavior is by design in OpenCode. You can verify this in the source code:

| Component | Source Link |
|-----------|-------------|
| Skill tool execution | [packages/opencode/src/tool/skill.ts](https://github.com/sst/opencode/blob/main/packages/opencode/src/tool/skill.ts) |
| Tool result handling | [packages/opencode/src/session/message-v2.ts](https://github.com/sst/opencode/blob/main/packages/opencode/src/session/message-v2.ts) |
| Skill pruning protection | [packages/opencode/src/session/compaction.ts](https://github.com/sst/opencode/blob/main/packages/opencode/src/session/compaction.ts) |

### Skill Content is Protected from Pruning

OpenCode protects skill tool results from being pruned during context management. From the [compaction.ts source](https://github.com/sst/opencode/blob/main/packages/opencode/src/session/compaction.ts):

```typescript
const PRUNE_PROTECTED_TOOLS = ["skill"]
```

This means loaded skill content stays in context for the duration of the session (unless full session compaction/summarization occurs).

### Recommendations

- **Call skills sparingly**: Since each call adds full content, avoid calling the same skill multiple times
- **Monitor skill token usage**: Use TokenScope to see which skills consume the most tokens
- **Consider skill size**: Large skills (1000+ tokens) can quickly inflate context when called repeatedly

## Example Output

```
═══════════════════════════════════════════════════════════════════════════
Token Analysis: Session ses_50c712089ffeshuuuJPmOoXCPX
Model: claude-opus-4-5
═══════════════════════════════════════════════════════════════════════════

TOKEN BREAKDOWN BY CATEGORY
─────────────────────────────────────────────────────────────────────────
Estimated using tokenizer analysis of message content:

Input Categories:
  SYSTEM    ██████████████░░░░░░░░░░░░░░░░    45.8% (22,367)
  USER      ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░        0.8% (375)
  TOOLS     ████████████████░░░░░░░░░░░░░░    53.5% (26,146)

  Subtotal: 48,888 estimated input tokens

Output Categories:
  ASSISTANT ██████████████████████████████     100.0% (1,806)

  Subtotal: 1,806 estimated output tokens

Local Total: 50,694 tokens (estimated)

TOOL USAGE BREAKDOWN
─────────────────────────────────────────────────────────────────────────
bash                 ██████████░░░░░░░░░░░░░░░░░░░░     34.0% (8,886)    4x
read                 ██████████░░░░░░░░░░░░░░░░░░░░     33.1% (8,643)    3x
task                 ████████░░░░░░░░░░░░░░░░░░░░░░     27.7% (7,245)    4x
webfetch             █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░      4.9% (1,286)    1x
tokenscope           ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░         0.3% (75)    2x
batch                ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░         0.0% (11)    1x

TOP CONTRIBUTORS
─────────────────────────────────────────────────────────────────────────
• System (inferred from API)   22,367 tokens (44.1%)
• bash                         8,886 tokens (17.5%)
• read                         8,643 tokens (17.0%)
• task                         7,245 tokens (14.3%)
• webfetch                     1,286 tokens (2.5%)

═══════════════════════════════════════════════════════════════════════════
MOST RECENT API CALL
─────────────────────────────────────────────────────────────────────────

Raw telemetry from last API response:
  Input (fresh):              2 tokens
  Cache read:            48,886 tokens
  Cache write:               54 tokens
  Output:                   391 tokens
  ───────────────────────────────────
  Total:                 49,333 tokens

═══════════════════════════════════════════════════════════════════════════
SESSION TOTALS (All 15 API calls)
─────────────────────────────────────────────────────────────────────────

Total tokens processed across the entire session (for cost calculation):

  Input tokens:              10 (fresh tokens across all calls)
  Cache read:           320,479 (cached tokens across all calls)
  Cache write:           51,866 (tokens written to cache)
  Output tokens:          3,331 (all model responses)
  ───────────────────────────────────
  Session Total:        375,686 tokens (for billing)

═══════════════════════════════════════════════════════════════════════════
ESTIMATED SESSION COST (API Key Pricing)
─────────────────────────────────────────────────────────────────────────

You appear to be on a subscription plan (API cost is $0).
Here's what this session would cost with direct API access:

  Input tokens:              10 × $5.00/M  = $0.0001
  Output tokens:          3,331 × $25.00/M  = $0.0833
  Cache read:           320,479 × $0.50/M  = $0.1602
  Cache write:           51,866 × $6.25/M  = $0.3242
─────────────────────────────────────────────────────────────────────────
ESTIMATED TOTAL: $0.5677

Note: This estimate uses standard API pricing from models.json.
Actual API costs may vary based on provider and context size.

═══════════════════════════════════════════════════════════════════════════
CONTEXT BREAKDOWN (Estimated from cache_write tokens)
─────────────────────────────────────────────────────────────────────────

  Base System Prompt   ████████████░░░░░░░░░░░░░░░░░░   ~42,816 tokens
  Tool Definitions (14)██████░░░░░░░░░░░░░░░░░░░░░░░░    ~4,900 tokens
  Environment Context  █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░      ~150 tokens
  Project Tree         ████░░░░░░░░░░░░░░░░░░░░░░░░░░    ~4,000 tokens
  ───────────────────────────────────────────────────────────────────────
  Total Cached Context:                                  ~51,866 tokens

  Note: Breakdown estimated from first cache_write. Actual distribution may vary.

═══════════════════════════════════════════════════════════════════════════
TOOL DEFINITION COSTS (Estimated from argument analysis)
─────────────────────────────────────────────────────────────────────────

  Tool                Est. Tokens   Args   Complexity
  ───────────────────────────────────────────────────────────────────────
  task                       ~480      3   complex (arrays/objects)
  batch                      ~410      1   complex (arrays/objects)
  edit                       ~370      4   simple
  read                       ~340      3   simple
  bash                       ~340      3   simple
  ───────────────────────────────────────────────────────────────────────
  Total:                   ~4,520 tokens (14 enabled tools)

  Note: Estimates inferred from tool call arguments in this session.
        Actual schema tokens may vary +/-20%.

═══════════════════════════════════════════════════════════════════════════
CACHE EFFICIENCY
─────────────────────────────────────────────────────────────────────────

  Token Distribution:
    Cache Read:           320,479 tokens   ████████████████████████████░░  86.2%
    Fresh Input:           51,320 tokens   ████░░░░░░░░░░░░░░░░░░░░░░░░░░  13.8%
  ───────────────────────────────────────────────────────────────────────
  Cache Hit Rate:      86.2%

  Cost Analysis (claude-opus-4-5 @ $5.00/M input, $0.50/M cache read):
    Without caching:   $1.8590  (371,799 tokens x $5.00/M)
    With caching:      $0.4169  (fresh x $5.00/M + cached x $0.50/M)
  ───────────────────────────────────────────────────────────────────────
  Cost Savings:        $1.4421  (77.6% reduction)
  Effective Rate:      $1.12/M tokens  (vs. $5.00/M standard)

═══════════════════════════════════════════════════════════════════════════
SUBAGENT COSTS (4 child sessions, 23 API calls)
─────────────────────────────────────────────────────────────────────────

  docs                         $0.3190  (194,701 tokens, 8 calls)
  general                      $0.2957  (104,794 tokens, 4 calls)
  docs                         $0.2736  (69,411 tokens, 4 calls)
  general                      $0.5006  (197,568 tokens, 7 calls)
─────────────────────────────────────────────────────────────────────────
Subagent Total:            $1.3888  (566,474 tokens, 23 calls)

═══════════════════════════════════════════════════════════════════════════
SUMMARY
─────────────────────────────────────────────────────────────────────────

                          Cost        Tokens          API Calls
  Main session:      $    0.5677       375,686            15
  Subagents:         $    1.3888       566,474            23
─────────────────────────────────────────────────────────────────────────
  TOTAL:             $    1.9565       942,160            38

═══════════════════════════════════════════════════════════════════════════

```

## Supported Models

**41+ models with accurate pricing:**

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

The plugin includes a `tokenscope-config.json` file with these defaults:

```json
{
  "enableContextBreakdown": true,
  "enableToolSchemaEstimation": true,
  "enableCacheEfficiency": true,
  "enableSubagentAnalysis": true,
  "enableSkillAnalysis": true
}
```

Set any option to `false` to hide that section from the output.

## Troubleshooting

### Command `/tokenscope` Not Appearing

1. Verify `tokenscope.md` exists:
   ```bash
   ls ~/.config/opencode/command/tokenscope.md
   ```
2. If missing, create it (see Installation step 3)
3. Restart OpenCode completely

### Wrong Token Counts

The plugin uses API telemetry (ground truth). If counts seem off:
- **Expected ~2K difference from TUI**: Plugin analyzes before its own response is added
- **Model detection**: Check that the model name is recognized in the output

## Privacy & Security

- **All processing is local**: No session data sent to external services
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
