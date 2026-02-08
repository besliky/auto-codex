# auto-codex

<p align="center">
  <strong>Thin, production-minded multi-agent orchestrator for Codex CLI.</strong><br />
  Plan in parallel, execute in isolated git worktrees, merge safely.
</p>

<p align="center">
  <img alt="Node" src="https://img.shields.io/badge/Node-20+-0b7a43?style=flat-square" />
  <img alt="npm" src="https://img.shields.io/badge/npm-package-cb0000?style=flat-square" />
  <img alt="License" src="https://img.shields.io/badge/License-MIT-0969da?style=flat-square" />
</p>

## Why This Exists

`auto-codex` keeps orchestration intentionally thin:

- Parallel execution via isolated `git worktree` branches
- Structured planning and merging with Codex skills
- Minimal runtime surface (Node.js stdlib only)
- Deterministic run artifacts under `.auto-codex/`

## Install

### Global install (recommended)

```bash
npm install -g auto-codex
```

### One-off run

```bash
npx auto-codex --help
```

### Local dev install

```bash
git clone https://github.com/besliky/auto-codex
cd auto-codex
npm install
npm run lint
npm run test
```

## Requirements

- `node >= 20`
- `git`
- `codex` CLI in `PATH`

## Usage

```bash
# initialize repository scaffold (.auto-codex + AGENTS.md)
auto-codex init

# create plan only
auto-codex plan "Implement feature X with tests"

# run full cycle (plan -> parallel tasks -> merge)
auto-codex run "Implement feature X with tests" -j 4

# cleanup run-specific branches/worktrees
auto-codex clean <run_id>

# show version
auto-codex version

# check for updates on npm
auto-codex version --check

# update globally
auto-codex update
```

## Versioning And Updates

- SemVer in `package.json`
- Git tags `vX.Y.Z`
- npm publish from GitHub Actions on tag push
- Built-in `version` and `update` commands

Release quick path:

```bash
npm version patch
git push origin main --follow-tags
```

Detailed architecture and migration rationale:

- `docs/ARCHITECTURE.md`
- `docs/MIGRATION-PLAN.md`

## Project Layout

```text
auto-codex
bin/
src/
templates/
docs/
```

## License

MIT. See `LICENSE`.
