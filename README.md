# OpenCode-Tokenscope, Token Analyzer Plugin

> Comprehensive token usage analysis and cost tracking for OpenCode AI sessions

Track and optimize your token usage across system prompts, user messages, tool outputs, and more. Get detailed breakdowns, accurate cost estimates, and visual insights for your AI development workflow.

## Installation

```bash
curl -sSL https://raw.githubusercontent.com/ramtinJ95/opencode-tokenscope/main/plugin/install.sh | bash
```

Then restart OpenCode and run `/tokenscope`

## Updating

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

### Context Analysis (New in v1.4.0)
- **Tool Definitions Breakdown**: See exactly how many tokens each tool's description and JSON schema consume
- **System Prompt Sections**: Detailed breakdown of system prompt components (identity, rules, environment, custom instructions)
- **Request Composition**: Visual breakdown of what's sent with each API request (tools, system, conversation, user message)
- **Cache Efficiency Metrics**: See your cache hit rate and effective cost reduction from caching

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

## Example Output

```
═══════════════════════════════════════════════════════════════════════════
Token Analysis: Session ses_50c712089ffeshuuuJPmOoXCPX
Model: claude-sonnet-4-20250514
Provider: anthropic
═══════════════════════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════════════════════
TOOL DEFINITIONS (Static Context)
─────────────────────────────────────────────────────────────────────────

These tool schemas are sent with EVERY API request. They define what
capabilities the AI has access to and consume tokens on each call.

  Tool Count: 14 tools registered

  Token Breakdown:
    Descriptions:         4,850 tokens
    JSON Schemas:           892 tokens
    ─────────────────────────────────────
    Total:                5,742 tokens

  Per-Tool Breakdown (sorted by token count):
  bash                      ████████████████░░░░░░░░░░░░░░  52.3% (3,003)
  task                      ████░░░░░░░░░░░░░░░░░░░░░░░░░░  13.5% (775)
  read                      ███░░░░░░░░░░░░░░░░░░░░░░░░░░░  10.2% (586)
  edit                      ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░   7.8% (448)
  todowrite                 ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░   6.1% (350)
  ...

═══════════════════════════════════════════════════════════════════════════
SYSTEM PROMPT BREAKDOWN
─────────────────────────────────────────────────────────────────────────

The system prompt defines the AI's identity, capabilities, and behavior.
It is sent with every request and typically cached for efficiency.

  Total System Prompt: 8,234 tokens

  Section Breakdown:

  Tool Usage Policy             2,145 tokens (26.1%)
    └─ Rules for when and how to use available tools
  Task Management               1,890 tokens (23.0%)
    └─ Instructions for using todo tools and tracking progress
  Identity & Role               1,456 tokens (17.7%)
    └─ Defines who the AI is and its primary purpose
  Environment Info                525 tokens ( 6.4%)
    └─ Current working directory, platform, date, git status
  Custom Instructions             273 tokens ( 3.3%)
    └─ User-defined instructions from AGENTS.md or CLAUDE.md

═══════════════════════════════════════════════════════════════════════════
MOST RECENT REQUEST COMPOSITION
─────────────────────────────────────────────────────────────────────────

What was sent to the API in the most recent request:

  Tool Definitions          ██████████░░░░░░░░░░░░░░░░░░░░  33.2% (5,742)
  System Prompt             ████████████░░░░░░░░░░░░░░░░░░  47.6% (8,234)
  Conversation History      █████░░░░░░░░░░░░░░░░░░░░░░░░░  16.8% (2,905)
  User Message              ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   2.4% (415)

  ─────────────────────────────────────
  Total Request Size:          17,296 tokens

  Static Context (cached):     13,976 tokens (80.8%)
  Dynamic Content:              3,320 tokens

  Note: Static context is typically served from cache at 1/10th the cost.

═══════════════════════════════════════════════════════════════════════════
CONTEXT CACHING EFFICIENCY
─────────────────────────────────────────────────────────────────────────

How effectively caching is reducing your API costs:

  Most Recent Request Input Breakdown:

    Fresh Input (full price):         415 tokens (2.4%)
    Cache Read (1/10 price):       16,881 tokens (97.6%)
    ─────────────────────────────────────
    Total Input:                   17,296 tokens

  Cache Hit Rate: [█████████████████████████████░] 97.6%

  Cost Impact:
    Without caching: 17,296 tokens at full price
    With caching:    415 full + 16,881 @ 10% = ~2,103 effective tokens

  Effective Cost Reduction: 87.8%

  ✓ Excellent caching! Your static context is being efficiently reused.

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

## Customization

### Add New Model Pricing

Edit `~/.config/opencode/plugin/models.json`:

```json
{
  "your-model-name": {
    "input": 1.50,
    "output": 5.00,
    "cacheWrite": 0.50,
    "cacheRead": 0.10
  }
}
```

Save the file and restart OpenCode. The plugin will automatically use the new pricing.

### Update Existing Model Pricing

Simply edit the values in `models.json` and restart OpenCode. No code changes needed!

## How It Works

### System Prompt Inference
OpenCode doesn't expose system prompts in the session messages API. The plugin intelligently infers them using:

```
System Tokens = (API Input + Cache Read) - (User Tokens + Tool Tokens)
```

This works because the API input includes everything sent to the model.

### Dual Tracking
- **Current Context**: Uses the most recent API call with non-zero tokens (matches TUI)
- **Session Total**: Aggregates all API calls for accurate billing

### Subagent Analysis
The plugin uses OpenCode's session API to:
1. Fetch all child sessions spawned by the Task tool
2. Recursively analyze nested subagents (subagents can spawn their own subagents)
3. Aggregate tokens, costs, and API call counts
4. Calculate estimated costs using the same pricing as the main session

### Model Name Normalization
Automatically handles `provider/model` format (e.g., `qwen/qwen3-coder` → `qwen3-coder`)

## Understanding the Numbers

### Current Context vs Session Total

- **Current Context**: What's in your context window right now
  - Based on most recent API call
  - Used to understand current memory usage

- **Session Total**: All tokens processed in this session
  - Sum of all API calls in the main session
  - What you're billed for (main session only)
  - Used for cost calculation

### Subagent Totals

When using the Task tool, OpenCode spawns subagent sessions. These are tracked separately:

- **Subagent Tokens**: Combined tokens from all child sessions
- **Subagent API Calls**: Total API calls made by all subagents
- **Grand Total**: Main session + all subagents combined

### Cache Tokens

- **Cache Read**: Tokens retrieved from cache (discounted rate ~90% off)
- **Cache Write**: Tokens written to cache (slight premium ~25% more)
- **Note**: Cache write is a billing charge, not additional context tokens

## Troubleshooting

### "Dependencies missing" Error

Run the installer:
```bash
curl -sSL https://raw.githubusercontent.com/ramtinJ95/opencode-tokenscope/main/plugin/install.sh | bash
```

### Command Not Appearing

1. Verify `tokenscope.md` exists:
   ```bash
   ls ~/.config/opencode/command/tokenscope.md
   ```
2. Restart OpenCode completely
3. Check OpenCode logs for plugin errors

### Wrong Token Counts

The plugin uses API telemetry (ground truth). If counts seem off:
- **Expected ~2K difference from TUI**: Plugin analyzes before its own response is added
- **Model detection**: Check that the model name is recognized in the output
- **Tokenizer not installed**: Re-run the installer

### New Model Not Showing Correct Pricing

1. Check if model exists in `models.json`
2. Try exact match or prefix match (e.g., `claude-sonnet-4` matches `claude-sonnet-4-20250514`)
3. Add entry to `models.json` if missing
4. Restart OpenCode after editing `models.json`

### Plugin Fails to Load

1. Validate JSON syntax:
   ```bash
   cd ~/.config/opencode/plugin
   node -e "JSON.parse(require('fs').readFileSync('models.json', 'utf8'))"
   ```
2. Check for trailing commas or syntax errors
3. Plugin falls back to default pricing if file is invalid

## Architecture

### File Structure

```
plugin/
├── tokenscope.ts        # Main entry point - Plugin export
├── tokenscope-lib/
│   ├── types.ts         # All interfaces and type definitions
│   ├── config.ts        # Constants, model maps, pricing loader
│   ├── tokenizer.ts     # TokenizerManager class
│   ├── analyzer.ts      # ModelResolver, ContentCollector, TokenAnalysisEngine
│   ├── cost.ts          # CostCalculator class
│   ├── subagent.ts      # SubagentAnalyzer class
│   ├── formatter.ts     # OutputFormatter class
│   └── context.ts       # ContextAnalyzer class (tool defs, system prompt breakdown)
├── models.json          # Pricing data for 41+ models
├── package.json         # Plugin metadata
└── install.sh           # Installation script
```

### Core Components

1. **TokenizerManager** (`tokenscope-lib/tokenizer.ts`): Loads and caches tokenizers (tiktoken, transformers)
2. **ModelResolver** (`tokenscope-lib/analyzer.ts`): Detects model and selects appropriate tokenizer
3. **ContentCollector** (`tokenscope-lib/analyzer.ts`): Extracts content from session messages, including tool call counts
4. **TokenAnalysisEngine** (`tokenscope-lib/analyzer.ts`): Counts tokens and applies API telemetry adjustments
5. **CostCalculator** (`tokenscope-lib/cost.ts`): Calculates costs from pricing database with cache-aware pricing
6. **SubagentAnalyzer** (`tokenscope-lib/subagent.ts`): Recursively fetches and analyzes child sessions from Task tool calls
7. **ContextAnalyzer** (`tokenscope-lib/context.ts`): Fetches tool definitions via API and parses system prompt sections
8. **OutputFormatter** (`tokenscope-lib/formatter.ts`): Generates visual reports with charts and summaries

## Privacy & Security

- **All processing is local**: No session data sent to external services
- **Tokenizers from official sources**:
  - OpenAI tokenizers: npm registry
  - Transformers: Hugging Face Hub
- **Open source**: Audit the code yourself

## Performance

- **Fast**: Tokenizers cached after first load
- **Parallel**: Categories processed concurrently
- **Efficient**: Only analyzes on demand
- **First-run download**: Transformers models download on demand (5-50MB per model)
- **Subsequent runs**: Instant (uses cache)

## Manual Installation

<details>
<summary>Click to expand manual installation steps</summary>

### Requirements
- OpenCode installed (`~/.config/opencode` directory exists)
- npm (for tokenizer dependencies)
- ~50MB disk space (for tokenizer models)

### Installation Steps

1. **Navigate to OpenCode config**:
   ```bash
   cd ~/.config/opencode
   ```

2. **Download plugin files**:
   ```bash
   mkdir -p plugin/tokenscope-lib
   cd plugin
   curl -O https://raw.githubusercontent.com/ramtinJ95/opencode-tokenscope/main/plugin/tokenscope.ts
   curl -O https://raw.githubusercontent.com/ramtinJ95/opencode-tokenscope/main/plugin/models.json
   curl -O https://raw.githubusercontent.com/ramtinJ95/opencode-tokenscope/main/plugin/package.json
   cd tokenscope-lib
   curl -O https://raw.githubusercontent.com/ramtinJ95/opencode-tokenscope/main/plugin/tokenscope-lib/types.ts
   curl -O https://raw.githubusercontent.com/ramtinJ95/opencode-tokenscope/main/plugin/tokenscope-lib/config.ts
   curl -O https://raw.githubusercontent.com/ramtinJ95/opencode-tokenscope/main/plugin/tokenscope-lib/tokenizer.ts
   curl -O https://raw.githubusercontent.com/ramtinJ95/opencode-tokenscope/main/plugin/tokenscope-lib/analyzer.ts
   curl -O https://raw.githubusercontent.com/ramtinJ95/opencode-tokenscope/main/plugin/tokenscope-lib/cost.ts
   curl -O https://raw.githubusercontent.com/ramtinJ95/opencode-tokenscope/main/plugin/tokenscope-lib/subagent.ts
   curl -O https://raw.githubusercontent.com/ramtinJ95/opencode-tokenscope/main/plugin/tokenscope-lib/formatter.ts
   curl -O https://raw.githubusercontent.com/ramtinJ95/opencode-tokenscope/main/plugin/tokenscope-lib/context.ts
   ```

3. **Download command file**:
   ```bash
   cd ../../command
   curl -O https://raw.githubusercontent.com/ramtinJ95/opencode-tokenscope/main/command/tokenscope.md
   ```

4. **Install dependencies**:
   ```bash
   cd ../plugin
   npm install js-tiktoken@1.0.15 @huggingface/transformers@3.1.2
   ```

5. **Restart OpenCode**

6. **Test**: Run `/tokenscope` in any session

</details>

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
