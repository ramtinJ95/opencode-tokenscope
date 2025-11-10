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

### Dual Tracking System
- **Current Context**: Matches what OpenCode TUI displays (~2K difference expected)
- **Session Total**: Cumulative billing across all API calls
- **Clear Separation**: Understand the difference between current context and total costs

### Advanced Features
- **Tool Usage Stats**: Track which tools consume the most tokens
- **Top Contributors**: Identify the biggest token consumers
- **Model Normalization**: Handles `provider/model` format automatically
- **Multi-Tokenizer Support**: Uses official tokenizers (tiktoken for OpenAI, transformers for others)

## Quick Install

### One-Line Install (Recommended)

```bash
curl -sSL https://raw.githubusercontent.com/ramtinJ95/opencode-tokenscope/main/install.sh | bash
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

6. **Test**: Run `/tokens` in any session

</details>

## Usage

### Basic Command

Simply type in OpenCode:
```
/tokenscope
```

The plugin will:
1. Analyze the current session
2. Count tokens across all categories
3. Calculate costs based on API telemetry
4. Display results in terminal
5. Save detailed report to `token-usage-output.txt`

### Reading the Full Report

```bash
cat token-usage-output.txt
```

### Example Output

```
═══════════════════════════════════════════════════════════════════════════
Token Analysis: Session abc123
Model: claude-sonnet-4.5
═══════════════════════════════════════════════════════════════════════════

LOCAL TOKEN BREAKDOWN (Estimated from content analysis)
─────────────────────────────────────────────────────────────────────────

Input Categories:
  SYSTEM    ███████████████░░░░░░░░░░░░░░░    51.5% (16,963)
  USER      █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░        2.3% (753)
  TOOLS     ██████████████░░░░░░░░░░░░░░░░    46.2% (15,202)

  Subtotal: 32,918 estimated input tokens

Output Categories:
  ASSISTANT ██████████████████████████████     100.0% (1,214)

  Subtotal: 1,214 estimated output tokens

Local Total: 34,132 tokens (estimated)

═══════════════════════════════════════════════════════════════════════════
CURRENT CONTEXT WINDOW (Matches OpenCode TUI display)
─────────────────────────────────────────────────────────────────────────

Most recent API call telemetry:
  Input (fresh):              6 tokens
  Cache read:            32,912 tokens
  Output:                     2 tokens
  Total (API):           32,920 tokens

Context breakdown (estimated):
  System prompts:        16,963 tokens
  User messages:            753 tokens
  Tool outputs:          15,202 tokens
  Assistant msgs:         1,214 tokens
  Reasoning:                  0 tokens
  ───────────────────────────────────
  Current Context:       34,132 tokens

This should closely match the OpenCode TUI header.

═══════════════════════════════════════════════════════════════════════════
SESSION-WIDE BILLING (All 26 API calls aggregated)
─────────────────────────────────────────────────────────────────────────

Total tokens processed across the entire session (for cost calculation):

  Input tokens:              96 (fresh tokens across all calls)
  Cache read:           490,200 (cached tokens across all calls)
  Cache write:          114,217 (tokens written to cache)
  Output tokens:          2,691 (all model responses)
  ───────────────────────────────────
  Session Total:        607,204 tokens (for billing)

═══════════════════════════════════════════════════════════════════════════
SUMMARY
─────────────────────────────────────────────────────────────────────────

Current Context (TUI):           34,132 tokens
Session Total (Billing):        492,987 tokens
API Calls Made:              26

Note: "Current Context" shows tokens in the most recent API call context
(matching what OpenCode TUI displays). "Session Total" shows all tokens
processed across all API calls (for accurate cost calculation).

═══════════════════════════════════════════════════════════════════════════

COST ESTIMATION (Based on API telemetry)
─────────────────────────────────────────────────────────────────────────
Input tokens:            96 × $3.00/M  = $0.0003
Output tokens:        2,691 × $15.00/M = $0.0404
Cache read:         490,200 × $0.30/M  = $0.1471
Cache write:        114,217 × $3.75/M  = $0.4283
─────────────────────────────────────────────────────────────────────────
TOTAL COST: $0.6160

TOOL USAGE BREAKDOWN
─────────────────────────────────────────────────────────────────────────
bash                 ████████████████████░░░░░░░░░░    65.8% (10,005)   11x
task                 ████████░░░░░░░░░░░░░░░░░░░░░░     26.9% (4,094)    1x
token_usage          ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░      7.3% (1,103)   12x

TOP CONTRIBUTORS
─────────────────────────────────────────────────────────────────────────
• System (inferred from API)   16,963 tokens (49.7%)
• bash                         10,005 tokens (29.3%)
• task                         4,094 tokens (12.0%)
• token_usage                  1,103 tokens (3.2%)
• Assistant#3                  720 tokens (2.1%)

═══════════════════════════════════════════════════════════════════════════
```

## Supported Models

**41+ models with accurate pricing:**

### Claude Models
- Claude Opus 4, 4.1
- Claude Sonnet 4, 4-5, 3.7, 3.5, 3
- Claude Haiku 4-5, 3.5, 3

### OpenAI Models
- GPT-4, GPT-4 Turbo, GPT-4o, GPT-4o Mini
- GPT-3.5 Turbo
- o1, o1-mini, o1-pro, o3, o3-mini
- GPT-5

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

- **Current Context (34K)**: What's in your context window right now
  - Matches OpenCode TUI display
  - Based on most recent API call
  - Used to understand current memory usage

- **Session Total (493K)**: All tokens processed in this session
  - Sum of all 26 API calls
  - What you're actually billed for
  - Used for cost calculation

### Cache Tokens

- **Cache Read**: Tokens retrieved from cache (discounted rate ~90% off)
- **Cache Write**: Tokens written to cache (slight premium ~25% more)
- **Note**: Cache write is a billing charge, not additional context tokens

## Architecture

### Core Components

1. **TokenizerManager**: Loads and caches tokenizers (tiktoken, transformers)
2. **ModelResolver**: Detects model and selects appropriate tokenizer
3. **ContentCollector**: Extracts content from session messages
4. **TokenAnalysisEngine**: Counts tokens and applies API telemetry
5. **CostCalculator**: Calculates costs from pricing database
6. **OutputFormatter**: Generates visual reports

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

- **Issues**: [GitHub Issues](https://github.com/YOUR_USERNAME/opencode-token-analyzer/issues)
- **Discussions**: [GitHub Discussions](https://github.com/YOUR_USERNAME/opencode-token-analyzer/discussions)
