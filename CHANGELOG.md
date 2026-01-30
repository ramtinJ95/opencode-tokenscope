# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.5.2]: https://github.com/ramtinJ95/opencode-tokenscope/compare/v1.5.1...v1.5.2
[1.5.1]: https://github.com/ramtinJ95/opencode-tokenscope/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/ramtinJ95/opencode-tokenscope/releases/tag/v1.5.0
