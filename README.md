# OpenCode-Tokenscope, Token Analyzer Plugin

> Comprehensive token usage analysis and cost tracking for OpenCode AI sessions

Track and optimize your token usage across system prompts, user messages, tool outputs, and more. Get detailed breakdowns, accurate cost estimates, and visual insights for your AI development workflow.

## Features

### Comprehensive Token Analysis
- **5 Category Breakdown**: System prompts, user messages, assistant responses, tool outputs, and reasoning traces
- **Visual Charts**: Easy-to-read ASCII bar charts with percentages and token counts
- **Smart Inference**: Automatically infers system prompts from API telemetry (since they're not exposed in session messages)

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

## Quick Install

### One-Line Install (Recommended)

```bash
curl -sSL https://raw.githubusercontent.com/ramtinJ95/opencode-tokenscope/main/plugin/install.sh | bash
```

Then restart OpenCode and run `/tokenscope`

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
   # Download to plugin directory
   cd plugin
   curl -O https://raw.githubusercontent.com/ramtinJ95/opencode-tokenscope/main/plugin/tokenscope.ts
   curl -O https://raw.githubusercontent.com/ramtinJ95/opencode-tokenscope/main/plugin/models.json
   curl -O https://raw.githubusercontent.com/ramtinJ95/opencode-tokenscope/main/plugin/install.sh
   curl -O https://raw.githubusercontent.com/ramtinJ95/opencode-tokenscope/main/plugin/package.json
   ```

3. **Download command file**:
   ```bash
   cd ../command
   curl -O https://raw.githubusercontent.com/ramtinJ95/opencode-tokenscope/main/command/tokenscope.md
   ```

4. **Install dependencies**:
   ```bash
   cd ../plugin
   chmod +x install.sh
   ./install.sh
   ```

5. **Restart OpenCode**

6. **Test**: Run `/tokenscope` in any session

</details>

## Updating

### Quick Update (v1.2.1+)

If you have v1.2.1 or later installed, use the local update script:

```bash
~/.config/opencode/plugin/install.sh --update
```

### Update from v1.2.0 or Earlier

Use the remote script (this will also install the local update script for future use):

```bash
curl -sSL https://raw.githubusercontent.com/ramtinJ95/opencode-tokenscope/main/plugin/install.sh | bash -s -- --update
```

Both methods download the latest plugin files while skipping dependency installation (faster).

### Full Reinstall

For a full reinstall (if you're having issues):

```bash
curl -sSL https://raw.githubusercontent.com/ramtinJ95/opencode-tokenscope/main/plugin/install.sh | bash
```

## Usage

### Basic Command

Simply type in OpenCode:
```
/tokenscope
```

The plugin will:
1. Analyze the current session
2. Count tokens across all categories
3. Analyze all subagent (Task tool) child sessions recursively
4. Calculate costs based on API telemetry
5. Display results in terminal
6. Save detailed report to `token-usage-output.txt`

### Options

The tool accepts optional parameters:

- **sessionID**: Analyze a specific session instead of the current one
- **limitMessages**: Limit entries shown per category (1-10, default: 3)
- **includeSubagents**: Include subagent child session costs (default: true)

### Reading the Full Report

```bash
cat token-usage-output.txt
```

### Example Output

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

## Troubleshooting

### "Dependencies missing" Error

Run the installer:
```bash
cd ~/.config/opencode/plugin
./install.sh
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
- **Tokenizer not installed**: Re-run `install.sh`

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

The summary section shows a breakdown:
```
                          Cost        Tokens          API Calls
  Main session:      $    0.5677       375,686            15
  Subagents:         $    1.3888       566,474            23
─────────────────────────────────────────────────────────────────────────
  TOTAL:             $    1.9565       942,160            38
```

### Cache Tokens

- **Cache Read**: Tokens retrieved from cache (discounted rate ~90% off)
- **Cache Write**: Tokens written to cache (slight premium ~25% more)
- **Note**: Cache write is a billing charge, not additional context tokens

## Architecture

### File Structure

```
plugin/
├── tokenscope.ts        # Main entry point - Plugin export
├── lib/
│   ├── types.ts         # All interfaces and type definitions
│   ├── config.ts        # Constants, model maps, pricing loader
│   ├── tokenizer.ts     # TokenizerManager class
│   ├── analyzer.ts      # ModelResolver, ContentCollector, TokenAnalysisEngine
│   ├── cost.ts          # CostCalculator class
│   ├── subagent.ts      # SubagentAnalyzer class
│   └── formatter.ts     # OutputFormatter class
├── models.json          # Pricing data for 41+ models
├── package.json         # Plugin metadata
└── install.sh           # Installation script
```

### Core Components

1. **TokenizerManager** (`lib/tokenizer.ts`): Loads and caches tokenizers (tiktoken, transformers)
2. **ModelResolver** (`lib/analyzer.ts`): Detects model and selects appropriate tokenizer
3. **ContentCollector** (`lib/analyzer.ts`): Extracts content from session messages, including tool call counts
4. **TokenAnalysisEngine** (`lib/analyzer.ts`): Counts tokens and applies API telemetry adjustments
5. **CostCalculator** (`lib/cost.ts`): Calculates costs from pricing database with cache-aware pricing
6. **SubagentAnalyzer** (`lib/subagent.ts`): Recursively fetches and analyzes child sessions from Task tool calls
7. **OutputFormatter** (`lib/formatter.ts`): Generates visual reports with charts and summaries

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
