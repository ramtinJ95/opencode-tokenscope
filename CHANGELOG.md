# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Added an opt-in `enableDetailedSubagentCostBreakdown` config flag that expands subagent report sections with fresh input, cache read, cache write, output, and reasoning token buckets plus estimated per-bucket costs.

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

[Unreleased]: https://github.com/ramtinJ95/opencode-tokenscope/compare/v1.7.0...HEAD
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
