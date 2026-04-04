# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/ramtinJ95/opencode-tokenscope/compare/v1.6.0...HEAD
[1.6.0]: https://github.com/ramtinJ95/opencode-tokenscope/compare/v1.5.2...v1.6.0
[1.5.2]: https://github.com/ramtinJ95/opencode-tokenscope/compare/v1.5.1...v1.5.2
[1.5.1]: https://github.com/ramtinJ95/opencode-tokenscope/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/ramtinJ95/opencode-tokenscope/releases/tag/v1.5.0
