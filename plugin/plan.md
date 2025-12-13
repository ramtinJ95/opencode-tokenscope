# Tokenscope Plugin Enhancement Plan

## Overview

Add detailed context breakdown analysis to the tokenscope plugin, showing users exactly what consumes tokens in their context window. This includes system prompt breakdown, tool definition costs, and cache efficiency metrics.

## Goals

1. Show users what's consuming tokens in their context (system prompts, tools, environment, etc.)
2. Estimate token costs for each enabled tool's schema
3. Calculate cache efficiency (hit rate, cost savings)
4. Make all new features configurable via `tokenscope-config.json`

## Data Source

Use `opencode export <sessionID>` CLI command to get comprehensive session data including:
- `messages[].info.system[]` - Actual system prompt content
- `messages[].info.tools` - Map of enabled/disabled tools
- `messages[].parts[]` - Tool calls with argument structure
- `messages[].info.tokens` - Token usage per message

## New Files

### 1. `tokenscope-config.json`

Location: `plugin/tokenscope-config.json` (alongside `tokenscope.ts`)

```json
{
  "enableContextBreakdown": true,
  "enableToolSchemaEstimation": true,
  "enableCacheEfficiency": true,
  "enableSubagentAnalysis": true
}
```

All features enabled by default. Users can disable any section by setting to `false`.

### 2. `tokenscope-lib/context.ts`

New file containing `ContextAnalyzer` class with methods:

- `analyzeFromExport(sessionID, tokenModel, pricing)` - Main entry point
- `runExport(sessionID)` - Execute `opencode export`, strip prefix, parse JSON
- `extractSystemPrompts(exported)` - Get system[] from assistant messages
- `extractEnabledTools(exported)` - Get tools map from user messages
- `analyzeBreakdown(systemPrompts, tokenModel)` - Tokenize and categorize prompts
- `estimateToolSchemas(enabledTools, exported)` - Dynamic inference from tool calls
- `calculateCacheEfficiency(exported, pricing)` - Compute hit rate and savings

## Modified Files

### 1. `tokenscope-lib/types.ts`

Add new interfaces:

```typescript
// Context breakdown
export interface ContextBreakdown {
  baseSystemPrompt: ContextComponent
  toolDefinitions: ContextComponent & { toolCount: number }
  environmentContext: ContextComponent & { components: string[] }
  projectTree: ContextComponent & { fileCount: number }
  customInstructions: ContextComponent & { sources: string[] }
  totalCachedContext: number
}

export interface ContextComponent {
  tokens: number
  identified: boolean  // true = found in prompts, false = estimated
}

// Tool schema estimation
export interface ToolSchemaEstimate {
  name: string
  enabled: boolean
  estimatedTokens: number
  argumentCount: number
  hasComplexArgs: boolean
}

// Cache efficiency
export interface CacheEfficiency {
  cacheReadTokens: number
  freshInputTokens: number
  cacheWriteTokens: number
  totalInputTokens: number
  cacheHitRate: number
  costWithoutCaching: number
  costWithCaching: number
  costSavings: number
  savingsPercent: number
  effectiveRate: number
  standardRate: number
}

// Export parsing
export interface ExportedSession {
  info: ExportedSessionInfo
  messages: ExportedMessage[]
}

export interface ExportedSessionInfo {
  id: string
  title: string
  parentID?: string
}

export interface ExportedMessage {
  info: ExportedMessageInfo
  parts: ExportedPart[]
}

export interface ExportedMessageInfo {
  id: string
  role: "user" | "assistant"
  system?: string[]
  tools?: Record<string, boolean>
  tokens?: TokenUsage
  cost?: number
  modelID?: string
  providerID?: string
}

export interface ExportedPart {
  type: string
  tool?: string
  state?: {
    status: string
    input?: Record<string, unknown>
  }
}

// Config
export interface TokenscopeConfig {
  enableContextBreakdown: boolean
  enableToolSchemaEstimation: boolean
  enableCacheEfficiency: boolean
  enableSubagentAnalysis: boolean
}
```

Also update `TokenAnalysis` interface to include optional new fields:

```typescript
export interface TokenAnalysis {
  // ... existing fields ...
  contextBreakdown?: ContextBreakdown
  toolEstimates?: ToolSchemaEstimate[]
  cacheEfficiency?: CacheEfficiency
}
```

### 2. `tokenscope-lib/config.ts`

Add config loading:

```typescript
export const DEFAULT_TOKENSCOPE_CONFIG: TokenscopeConfig = {
  enableContextBreakdown: true,
  enableToolSchemaEstimation: true,
  enableCacheEfficiency: true,
  enableSubagentAnalysis: true,
}

let TOKENSCOPE_CONFIG_CACHE: TokenscopeConfig | null = null

export async function loadTokenscopeConfig(): Promise<TokenscopeConfig> {
  if (TOKENSCOPE_CONFIG_CACHE) return TOKENSCOPE_CONFIG_CACHE

  try {
    const configPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "tokenscope-config.json"
    )
    const data = await fs.readFile(configPath, "utf8")
    TOKENSCOPE_CONFIG_CACHE = { ...DEFAULT_TOKENSCOPE_CONFIG, ...JSON.parse(data) }
    return TOKENSCOPE_CONFIG_CACHE
  } catch {
    TOKENSCOPE_CONFIG_CACHE = DEFAULT_TOKENSCOPE_CONFIG
    return TOKENSCOPE_CONFIG_CACHE
  }
}
```

### 3. `tokenscope-lib/formatter.ts`

Add three new sections to `formatVisualOutput()`:

1. **CONTEXT BREAKDOWN** - Shows token distribution across system prompt components
2. **TOOL DEFINITION COSTS** - Lists enabled tools with estimated schema tokens
3. **CACHE EFFICIENCY** - Shows hit rate, cost comparison, savings

Each section:
- Only rendered if enabled in config
- Only rendered if data is available (export succeeded)
- Includes "Note:" clarifying estimates

### 4. `tokenscope.ts`

Update main execute function:

1. Load config at start: `const config = await loadTokenscopeConfig()`
2. Pass `$` (Bun shell) to ContextAnalyzer for running export
3. Conditionally run context analysis based on config
4. Pass config to formatter to control section rendering
5. Update `includeSubagents` logic to respect config

## Algorithm Details

### System Prompt Pattern Matching

Identify sections in `system[]` strings by patterns:

| Pattern | Section |
|---------|---------|
| `"You are OpenCode"` or `"You are Claude"` | Base System Prompt |
| `"Working directory:"` or `"Platform:"` | Environment Context |
| `"<files>"` or indented file paths | Project Tree |
| `"Instructions from:"` | Custom Instructions |
| `"<functions>"` or JSON schemas | Tool Definitions |

### Tool Schema Token Estimation

Dynamic inference from tool call arguments:

```
base_tokens = 200  (description + schema overhead)
per_simple_arg = 30
per_complex_arg = 60  (arrays, objects)
description_bonus = 80 (simple) or 120 (complex)

estimated_tokens = base_tokens + (simple_args * 30) + (complex_args * 60) + description_bonus
```

If no tool calls found for a tool, use conservative estimate: 3 args, 1 complex.

### Cache Efficiency Calculation

```
cache_hit_rate = cache_read / (cache_read + fresh_input)

cost_without_caching = (cache_read + fresh_input) * input_price / 1M
cost_with_caching = (fresh_input * input_price + cache_read * cache_read_price) / 1M

cost_savings = cost_without_caching - cost_with_caching
savings_percent = (cost_savings / cost_without_caching) * 100

effective_rate = cost_with_caching / (cache_read + fresh_input) * 1M
```

## Output Format

New sections appear **before SUMMARY**, in this order:

1. CONTEXT BREAKDOWN (if enabled)
2. TOOL DEFINITION COSTS (if enabled)
3. CACHE EFFICIENCY (if enabled)
4. SUBAGENT COSTS (existing, now config-controlled)
5. SUMMARY (existing)

### Sample Output

```
═══════════════════════════════════════════════════════════════════════════
CONTEXT BREAKDOWN (Estimated from system prompts)
───────────────────────────────────────────────────────────────────────────

  Base System Prompt     ████████████░░░░░░░░░░░░░░░░░░   ~1,735 tokens
  Tool Definitions       ████████████████████████░░░░░░   ~4,820 tokens (13 tools)
  Environment Context    ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░     ~180 tokens
  Project Tree           ████░░░░░░░░░░░░░░░░░░░░░░░░░░     ~520 tokens
  Custom Instructions    ███░░░░░░░░░░░░░░░░░░░░░░░░░░░     ~380 tokens
  ─────────────────────────────────────────────────────────────────────────
  Total Cached Context:                                    ~7,635 tokens

  Note: Values estimated by tokenizing actual system prompt content.

TOOL DEFINITION COSTS (Estimated from argument analysis)
───────────────────────────────────────────────────────────────────────────

  Tool             Est. Tokens   Args   Complexity
  ─────────────────────────────────────────────────────────────────────────
  task                 ~480        3    complex (arrays/objects)
  edit                 ~450        3    complex (arrays/objects)
  read                 ~420        2    complex (arrays/objects)
  batch                ~410        1    complex (arrays/objects)
  bash                 ~350        3    simple
  write                ~340        2    simple
  grep                 ~330        3    simple
  webfetch             ~320        2    simple
  glob                 ~300        2    simple
  todowrite            ~290        1    complex (arrays/objects)
  list                 ~280        2    simple
  todoread             ~260        0    simple
  tokenscope           ~290        3    simple
  ─────────────────────────────────────────────────────────────────────────
  Total:              ~4,520 tokens (13 enabled tools)

  Note: Estimates inferred from tool call arguments in this session.
        Actual schema tokens may vary +/-20%.

CACHE EFFICIENCY
───────────────────────────────────────────────────────────────────────────

  Token Distribution:
    Cache Read:        85,230 tokens   ████████████████████████████░░  89.2%
    Fresh Input:       10,340 tokens   ███░░░░░░░░░░░░░░░░░░░░░░░░░░░  10.8%
  ─────────────────────────────────────────────────────────────────────────
  Cache Hit Rate:      89.2%

  Cost Analysis (Claude Sonnet @ $3.00/M input, $0.30/M cache read):
    Without caching:   $0.2867  (95,570 tokens x $3.00/M)
    With caching:      $0.0568  (fresh x $3.00/M + cached x $0.30/M)
  ─────────────────────────────────────────────────────────────────────────
  Cost Savings:        $0.2299  (80.2% reduction)
  Effective Rate:      $0.59/M tokens  (vs. $3.00/M standard)
```

## Error Handling

1. **Export fails**: Fall back to SDK-only analysis, omit new sections
2. **No system prompts found**: Show "Context breakdown unavailable" or omit section
3. **No tool calls in session**: Use conservative estimates for all enabled tools
4. **Config file missing**: Use defaults (all features enabled)
5. **Config file invalid JSON**: Use defaults, log warning

## Implementation Order

1. Create `tokenscope-config.json` with defaults
2. Update `types.ts` with new interfaces
3. Update `config.ts` with config loader
4. Create `context.ts` with ContextAnalyzer class
5. Update `formatter.ts` with new sections
6. Update `tokenscope.ts` to integrate everything
7. Test with various sessions

## Testing Checklist

- [ ] Config file missing - defaults work
- [ ] Config with all features disabled - no new sections
- [ ] Config with partial features - only enabled sections appear
- [ ] Export fails (invalid session ID) - graceful fallback
- [ ] Session with no tool calls - conservative estimates shown
- [ ] Session with many tool calls - accurate inference
- [ ] Subagent sessions - subagent analysis respects config
- [ ] Different models - pricing calculations correct
- [ ] Cache hit rate edge cases (0%, 100%)
