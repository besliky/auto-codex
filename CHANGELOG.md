# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- Interactive clarification stage before planning (`single_choice` and `free_text` questions)
- Clarification schema and run artifacts (`clarifications.json`, `clarifications.md`)
- Placeholder quality gate with configurable mode/tokens
- Deterministic Node test suite covering CLI and stubbed orchestration cycle

### Changed

- Default `codex.reasoning_effort` remains `xhigh`
- `run` now treats blocked/invalid task outputs as failures and exits non-zero
- Merge/test handling is strict (no silent test failures)
- `pack:check` now runs with isolated npm cache via `scripts/pack-check.js`

## [0.1.0] - 2026-02-08

### Added

- Node.js CLI distribution through npm (`auto-codex` command)
- Commands for lifecycle management: `version`, `version --check`, `update`
- CI workflow and tag-based npm publish workflow

### Changed

- Runtime migrated from Python to Node.js while preserving core orchestrator behavior
