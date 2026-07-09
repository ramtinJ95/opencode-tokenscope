# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.8.0] - 2026-07-09

### Added

- Added OpenCode-compatible arbitrary and multiple context-price tiers, selected independently for every completed provider step before the legacy 200K fallback.
- Added reconciliation between message-derived `step-finish` telemetry and OpenCode's session aggregate, with visible warnings when token buckets or recorded cost disagree.
- Added explicit snapshot-boundary, retained-content, active-revert, missing-metadata, and approximate-tokenizer warnings so incomplete data cannot look exact.
- Added adaptive precision for small USD values and per-million rates, preserving values such as `$0.00001234` and `$0.00875/M` in displayed formulas.
- Added dedicated regression coverage for session reconciliation, current OpenCode skill formatting, tokenizer fallbacks, multi-tier pricing, report isolation, and cyclic child-session graphs.

### Changed

- Reframed reports into three distinct layers: locally tokenized retained content, recoverable OpenCode-recorded usage, and visibly labeled explanatory estimates.
- Renamed API-call totals to completed provider steps and documented that the step invoking TokenScope, later report reads, and the final response are outside the snapshot.
- Updated pricing estimates to use live OpenCode provider metadata first, with the bundled models.dev-derived catalog retained only as a warned fallback.
- Updated skill accounting for OpenCode v1.17.18: the verbose permission-filtered catalog belongs to system context, while the static skill-tool description is counted separately from its schema.
- Changed repeated skill accounting to tokenize and sum each persisted result instead of multiplying the first result size by the call count.
- Changed zero-cost and mixed-cost reporting to distinguish OpenCode-recorded cost from public API-rate estimates without assuming a subscription or provider invoice.
- Changed report output to unique, atomically written files in private per-invocation directories under OpenCode's temporary path, leaving analyzed worktrees untouched.
- Changed updater behavior to reinstall declared dependencies before rebuilding, preventing stale plugin SDK and tokenizer packages from surviving an update.
- Documented the v1.17.18 accuracy target and the remaining limits around generated system prompts, provider-transformed tools, compaction, reverts, and bundled-pricing freshness.

### Fixed

- Fixed sub-200K and multi-tier cost estimates, strict threshold selection, tier-before-legacy-fallback precedence, per-step tiering, and zero-valued omitted tier cache rates to match OpenCode.
- Fixed cost formulas and labels so reasoning uses the output rate, fresh/cache-read/cache-write buckets remain non-overlapping, and displayed rates agree with the calculated totals.
- Removed invalid system-prompt remainder inference that could double-count assistant history and removed the nonexistent fixed project-tree estimate.
- Bounded heuristic context components so they cannot exceed the observed first cache-write bucket, which is now labeled as an allocation anchor rather than a context-window measurement.
- Fixed OpenCode-hosted Claude and other non-OpenAI models being tokenized as OpenAI, mapped newer GPT/o-series models to the GPT-4o tokenizer family, and preserved real model names when tokenization is approximate.
- Fixed silent tokenizer fallbacks by reporting unknown encodings, load failures, and encode failures before using an approximate count.
- Fixed retained-content handling for `ignored:true` text, completed compacted tools, and replayable errored or interrupted tool results.
- Fixed tool-schema reporting that implied current metadata was the exact historical enabled toolset; active-agent permissions, MCP additions, and provider transforms are now called out explicitly.
- Fixed skill-catalog reconstruction that double-attributed an obsolete catalog-bearing tool description and made unavailable skill/agent metadata visible.
- Fixed recursive subagent attribution by preferring the session's agent field and stopping duplicate or cyclic traversal.
- Fixed unsafe pricing-prefix matches that could assign a related model's price without a valid model-version boundary.
- Fixed concurrent report overwrites, repository pollution, shell-path handling, and stale fixed-filename instructions.

### Security

- Restricted report directories to owner-only permissions and report files to mode `0600` on Unix.
- Added ownership, symlink, and writable-parent validation before writing potentially sensitive session reports under OpenCode's allowed temporary path.

## [1.7.2] - 2026-07-02

### Fixed

- Fixed OpenCode Desktop context exports by falling back to the OpenCode SDK when the `opencode` CLI is unavailable.

## [1.7.1] - 2026-06-13

### Added

- Added an opt-in `enableDetailedSubagentCostBreakdown` config flag that expands subagent report sections with fresh input, cache read, cache write, output, and reasoning token buckets plus estimated per-bucket costs.

### Fixed

- Fixed the default context export runner so npm-installed plugins no longer require Bun to analyze exported session data.
- Fixed subagent cost reporting to show recorded child-session API costs when available, including mixed main-session subscription and child-session API-cost cases.
- Fixed subagent estimated cost splits to clearly distinguish API-rate estimates from recorded API costs.
- Fixed live metadata fallback merging for provider-qualified and bare model aliases when provider metadata is partial.

## [1.7.0] - 2026-06-07

### Added

- Added live OpenCode provider/model metadata lookup for pricing, with bundled `models.json` retained as a fallback.
- Added support for current OpenCode nested cache pricing and large-context pricing metadata (`cost.cache`, `cost.tiers`, and `experimentalOver200K`).
- Added directory-routed OpenCode client calls for session messages, child sessions, tool metadata, and provider metadata so TokenScope analyzes the correct project context.

### Changed

- Reworked cost estimation to price each API call by its own context tier instead of applying large-context rates to aggregated session totals.
- Improved cache-efficiency cost math by recalculating uncached costs per call and per tier.
- Updated cost report wording to distinguish OpenCode-recorded actual cost from TokenScope API-equivalent estimates.
- Raised the supported OpenCode plugin peer range to `@opencode-ai/plugin >=1.1.48`.

### Fixed

- Fixed context exports to run from the active session directory.
- Fixed script-installed plugins by including all split library files, installing build dependencies, and building `dist/` during install/update.
- Fixed report summary paths to print a safely shell-quoted full report path.
- Fixed live pricing alias handling for provider model keys, API model IDs, ambiguous bare aliases, incomplete metadata, cache rates, and non-200K context thresholds.
- Fixed subagent cost estimates to use the same per-call context-tier pricing as main sessions.

## [1.6.5] - 2026-05-31

### Changed

- Aligned TokenScope's OpenCode SDK calls with current session, child-session, and experimental tool endpoint request shapes.
- Improved context breakdown and tool schema accounting by using current OpenCode tool metadata, workspace-routed tool definitions, generated prompt detection, and cache-write model selection.
- Updated skill and subagent analysis for current OpenCode skill metadata, optional skill descriptions, and directory-scoped tool definitions.

### Fixed

- Avoided treating user-supplied system overrides as generated OpenCode context unless they match stronger generated-context markers.
- Stopped using current OpenCode `info.tools` permission overrides to hide model-visible tool definitions.

## [1.6.4] - 2026-05-20

### Added

- Added DeepSeek V4 Flash and DeepSeek V4 Pro pricing entries
- Added a compiled `dist/` ESM smoke test to catch strict loader regressions

### Fixed

- Added explicit `.js` extensions to compiled ESM imports so TokenScope loads in strict ESM environments such as OpenCode Desktop (#30)

## [1.6.3] - 2026-04-14

### Added

- Added Bun regression tests covering `sessionID` fallback behavior and bundled asset resolution for TokenScope

### Changed

- Hardened the suggested `/tokenscope` slash-command prompt to keep `sessionID` unset unless the user explicitly asked to analyze a different session

### Fixed

- Normalized blank `sessionID` tool arguments so OpenCode models that emit `sessionID=""` still fall back to the current session instead of failing with "No session ID available for token analysis" (#21)
- Fixed bundled asset lookup so built/npm TokenScope installs loaded from `dist/` still resolve `models.json` and `tokenscope-config.json` from the published package root instead of silently falling back to default pricing

## [1.6.2] - 2026-04-13

### Changed

- Switched non-OpenAI token counting from `@huggingface/transformers` to lightweight `@huggingface/tokenizers`, removing the transitive `onnxruntime-node` install dependency and fixing the CUDA 13 install failure path reported in #22
- Updated the installer verification to expect `@huggingface/tokenizers` instead of Transformers.js
- Sanitized non-OpenAI tokenizer fallback warnings so reports say approximation was used instead of surfacing raw Hugging Face auth/network errors, and skip known non-public tokenizer hubs up front

## [1.6.1] - 2026-04-04

### Changed

- Switched session and subagent telemetry aggregation to per-call `step-finish` parts, so multi-step/tool-heavy turns count every API call instead of only the final step stored on each assistant message, fixing historical undercounting in tool-heavy sessions (#20)
- Added direct session-derived telemetry details for cache activity and most-recent call cost/total reporting

### Fixed

- Fixed tokenizer runtime loading to resolve installed npm dependencies from `node_modules` instead of a non-existent `vendor/node_modules` tree, fixing npm/script installs that previously fell back to approximate counting (#20)
- Updated the install script to install runtime dependencies from `package.json`, keeping script installs aligned with the published npm package

## [1.6.0] - 2026-04-04

### Added

- Added available subagent analysis from the Task tool definition, including per-subagent token estimates and total overhead reporting
- Added warning collection and fallback report output so analysis failures degrade gracefully instead of aborting the session, fixing unsupported-model/TUI failure reports (#15)

### Changed

- Synced pricing from models.dev across thousands of provider/model entries and improved provider-aware pricing lookup
- Aligned skill catalog accounting with current OpenCode behavior, including always-available skill catalogs, task tool metadata parsing, and permission-aware filtering
- Added support for user-level overrides at `~/.config/opencode/tokenscope-config.json`
- Improved API call counting, context attribution heuristics, and cache efficiency calculations to include cache writes
- Synced the root and packaged READMEs with the latest skill and subagent accounting behavior

### Fixed

- Added compatibility helpers for newer OpenCode session payloads and route shapes, addressing newer OpenCode UI/startup breakage reports (#9, #14)
- Corrected Claude pricing rates and updated parsing assumptions for current telemetry/export payloads
- Refreshed the install script to include new library modules required by the latest plugin state

## [1.5.2] - 2026-01-30

### Changed

- Refactored `SubagentAnalyzer` to use injected `CostCalculator.getPricing()` instead of duplicating pricing lookup logic
- Removed unused `pricingData` constructor parameter from `SubagentAnalyzer`

### Removed

- Removed dead code: unused `looksLikeFileTree` method from `ContextAnalyzer`

## [1.5.1] - 2024-12-29

### Fixed

- Use quiet mode in `opencode export` to separate stdout from stderr, fixing JSON parsing issues

## [1.5.0] - 2024-12-29

### Added

- Skill analysis feature: tracks available and loaded skills with call count multipliers
- Context breakdown analysis: estimates system prompt component token distribution
- Cache efficiency metrics: calculates savings from prompt caching

### Changed

- Synced READMEs and removed version tags from feature headers
- Updated install script for better testing before npm push

[Unreleased]: https://github.com/ramtinJ95/opencode-tokenscope/compare/v1.8.0...HEAD
[1.8.0]: https://github.com/ramtinJ95/opencode-tokenscope/compare/v1.7.2...v1.8.0
[1.7.2]: https://github.com/ramtinJ95/opencode-tokenscope/compare/v1.7.1...v1.7.2
[1.7.1]: https://github.com/ramtinJ95/opencode-tokenscope/compare/v1.7.0...v1.7.1
[1.7.0]: https://github.com/ramtinJ95/opencode-tokenscope/compare/v1.6.5...v1.7.0
[1.6.5]: https://github.com/ramtinJ95/opencode-tokenscope/compare/v1.6.4...v1.6.5
[1.6.4]: https://github.com/ramtinJ95/opencode-tokenscope/compare/v1.6.3...v1.6.4
[1.6.3]: https://github.com/ramtinJ95/opencode-tokenscope/compare/v1.6.2...v1.6.3
[1.6.2]: https://github.com/ramtinJ95/opencode-tokenscope/compare/v1.6.1...v1.6.2
[1.6.1]: https://github.com/ramtinJ95/opencode-tokenscope/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/ramtinJ95/opencode-tokenscope/compare/v1.5.2...v1.6.0
[1.5.2]: https://github.com/ramtinJ95/opencode-tokenscope/compare/v1.5.1...v1.5.2
[1.5.1]: https://github.com/ramtinJ95/opencode-tokenscope/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/ramtinJ95/opencode-tokenscope/releases/tag/v1.5.0
