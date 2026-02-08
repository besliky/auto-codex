# Repository Guidelines

## Project Structure & Module Organization
`auto-codex` is a Node.js CLI with a small runtime surface:
- `src/cli.js`: main orchestration logic.
- `bin/auto-codex.js`: npm-exposed executable entrypoint.
- `auto-codex`: local development launcher.
- `templates/`: scaffold assets (`skills/`, `schemas/`, default config).
- `docs/`: design and migration notes (`ARCHITECTURE.md`, `MIGRATION-PLAN.md`).

There is no dedicated `test/` directory today; verification is script-based via npm commands.

## Build, Test, and Development Commands
- `npm install`: install dependencies (Node 20+).
- `npm run lint`: syntax check for `src/cli.js` (`node --check`).
- `npm run test`: CLI smoke test (`--help` path).
- `npm run test:smoke`: version command smoke test.
- `npm run pack:check`: verify npm package contents (`npm pack --dry-run`).
- `node ./bin/auto-codex.js --help`: run CLI directly during local debugging.

Release helpers:
- `npm run release:patch|minor|major`: bumps SemVer and creates tags.

## Coding Style & Naming Conventions
- Runtime: Node.js `>=20`, CommonJS modules, `"use strict"`.
- Match existing formatting in `src/cli.js`: 2-space indentation, double quotes, semicolons.
- Prefer Node stdlib over new dependencies unless justified.
- Keep functions small and behavior-focused; preserve CLI command parity.
- Follow existing naming patterns: lowercase filenames, kebab-case directories in `templates/skills/*`.

## Testing Guidelines
- Current tests are smoke checks, not framework-based unit suites.
- Before opening a PR, run:
  - `npm run lint`
  - `npm run test`
  - `npm run pack:check`
- For behavior changes, include exact CLI commands and observed output in the PR description.
- If you add non-trivial logic, add or extend deterministic script checks in `package.json`.

## Commit & Pull Request Guidelines
- Existing history is minimal (`init`), so keep commit subjects short, imperative, and specific.
- Recommended style: `<area>: <action>` (example: `cli: validate run id format`).
- PRs should include:
  - What changed and why
  - Linked issue (if applicable)
  - Commands run locally and results
  - Sample CLI output when user-facing behavior changes
- Keep PR scope tight; CI must pass (`lint`, `test`, `pack:check`).

## Security & Configuration Tips
- Required tools: `node`, `git`, and `codex` in `PATH`.
- Do not commit runtime artifacts under `.auto-codex/runs/` or `.auto-codex/worktrees/`.
- Never hardcode API keys or tokens; use environment variables.
