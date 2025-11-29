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

6. **Test**: Run `/tokenscope` in any session

</details>

## Updating

To update to the latest version, run the install script with the `--update` flag:

```bash
curl -sSL https://raw.githubusercontent.com/ramtinJ95/opencode-tokenscope/main/install.sh | bash -s -- --update
```

This will download the latest plugin files while skipping dependency installation (faster).

For a full reinstall (if you're having issues):

```bash
curl -sSL https://raw.githubusercontent.com/ramtinJ95/opencode-tokenscope/main/install.sh | bash
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
Token Analysis: Session ses_53ff1f1b1ffe6jaY3aYMppLOj3
Model: claude-opus-4-5-20251101
═══════════════════════════════════════════════════════════════════════════

📊 TOKEN BREAKDOWN BY CATEGORY
─────────────────────────────────────────────────────────────────────────
Estimated using tokenizer analysis of message content:

Input Categories:
  SYSTEM    ████████████████████░░░░░░░░░░    66.0% (87,132)
  USER      ███░░░░░░░░░░░░░░░░░░░░░░░░░░░     9.3% (12,300)
  TOOLS     ███████░░░░░░░░░░░░░░░░░░░░░░░    24.7% (32,645)

  Subtotal: 132,077 estimated input tokens

Output Categories:
  ASSISTANT █████████████░░░░░░░░░░░░░░░░░    42.3% (12,140)
  REASONING █████████████████░░░░░░░░░░░░░    57.7% (16,530)

  Subtotal: 28,670 estimated output tokens

Local Total: 160,747 tokens (estimated)

═══════════════════════════════════════════════════════════════════════════
📐 MOST RECENT API CALL
─────────────────────────────────────────────────────────────────────────

Raw telemetry from last API response:
  Input (fresh):              7 tokens
  Cache read:           132,070 tokens
  Cache write:              839 tokens
  Output:                    93 tokens
  ───────────────────────────────────
  Total:                133,009 tokens

═══════════════════════════════════════════════════════════════════════════
📡 SESSION TOTALS (All 128 API calls)
─────────────────────────────────────────────────────────────────────────

Total tokens processed across the entire session (for cost calculation):

  Input tokens:             973 (fresh tokens across all calls)
  Cache read:         8,973,570 (cached tokens across all calls)
  Cache write:        1,408,260 (tokens written to cache)
  Output tokens:         56,142 (all model responses)
  ───────────────────────────────────
  Session Total:     10,438,945 tokens (for billing)

═══════════════════════════════════════════════════════════════════════════
📊 SUMMARY
─────────────────────────────────────────────────────────────────────────

Last API Call:           133,009 tokens
Session Total:        10,438,945 tokens
API Calls Made:              128
═══════════════════════════════════════════════════════════════════════════

💰 ESTIMATED SESSION COST (API Key Pricing)
─────────────────────────────────────────────────────────────────────────

You appear to be on a subscription plan (API cost is $0).
Here's what this session would cost with direct API access:

  Input tokens:             973 × $5.00/M  = $0.0049
  Output tokens:         56,142 × $25.00/M  = $1.4035
  Cache read:         8,973,570 × $0.50/M  = $4.4868
  Cache write:        1,408,260 × $6.25/M  = $8.8016
─────────────────────────────────────────────────────────────────────────
ESTIMATED TOTAL: $14.6968

Note: This estimate uses standard API pricing from models.json.
Actual API costs may vary based on provider and context size.

🔧 TOOL USAGE BREAKDOWN
─────────────────────────────────────────────────────────────────────────
read                 ████████████████████████░░░░░░    78.6% (25,649)   18x
bash                 ███░░░░░░░░░░░░░░░░░░░░░░░░░░░      9.0% (2,943)   36x
task                 ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░      5.8% (1,889)    1x
todowrite            █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░      4.3% (1,409)    9x
edit                 ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░        1.1% (366)   15x
write                ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░        0.7% (226)    4x
batch                ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░        0.3% (110)    4x
list                 ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░         0.2% (49)    1x
glob                 ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░          0.0% (4)    1x

⭐ TOP CONTRIBUTORS
─────────────────────────────────────────────────────────────────────────
• System (inferred from API)   87,132 tokens (54.2%)
• read                         25,649 tokens (16.0%)
• bash                         2,943 tokens (1.8%)
• task                         1,889 tokens (1.2%)
• User#32                      1,469 tokens (0.9%)

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

- **Issues**: [GitHub Issues](https://github.com/ramtinJ95/opencode-tokenscope/issues)
- **Discussions**: [GitHub Discussions](https://github.com/ramtinJ95/opencode-tokenscope/discussions)
