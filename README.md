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

# create plan with clarification step disabled
auto-codex plan "Implement feature X with tests" --no-questions

# limit clarification questions and force non-interactive defaults
auto-codex plan "Implement feature X with tests" --non-interactive --max-questions 2

# run full cycle (plan -> parallel tasks -> merge)
auto-codex run "Implement feature X with tests" -j 4

# run without merge
auto-codex run "Implement feature X with tests" --no-merge

# cleanup run-specific branches/worktrees
auto-codex clean <run_id>

# show version
auto-codex version

# check for updates on npm
auto-codex version --check

# update globally
auto-codex update
```

## Orchestration Cycle

`auto-codex run` executes a strict lifecycle:

1. Scaffold + config loading (`.auto-codex/*`)
2. Clarification stage (question generation + CLI answers)
3. Plan generation (`plan.json`)
4. Parallel task execution in isolated git worktrees
5. Task output validation (`task.schema.json`, status must be `done`)
6. Ordered merge back to base branch
7. Post-merge quality checks (placeholder token scan)
8. Optional test command (`commands.test`)
9. Run summary and artifacts under `.auto-codex/runs/<run_id>/`

Clarification artifacts are always stored as:

- `.auto-codex/runs/<run_id>/clarifications.json`
- `.auto-codex/runs/<run_id>/clarifications.md`

## Planning Questions

The planner can ask clarification questions before task planning:

- `single_choice`: numbered options, optional custom text
- `free_text`: open answer from CLI input

Controls:

- `--no-questions`
- `--non-interactive`
- `--max-questions <n>`

In non-interactive mode, `single_choice` defaults to the first option and `free_text` defaults to empty text.

## Config Highlights

Generated `.auto-codex/config.json` supports:

```json
{
  "planning": {
    "ask_questions": true,
    "max_questions": 3,
    "non_interactive": false
  },
  "quality": {
    "placeholder_check": "warn",
    "placeholder_tokens": []
  },
  "commands": {
    "test": "",
    "test_shell": false
  },
  "codex": {
    "reasoning_effort": "xhigh"
  }
}
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

## Project Layout

```text
auto-codex
bin/
src/
templates/
```

## License

MIT. See `LICENSE`.
