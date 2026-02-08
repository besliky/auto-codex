---
name: auto-codex-init
description: Bootstrap this repository for auto-codex (create/update .auto-codex/config.json + AGENTS.md). Use ONLY during initialization.
---

# auto-codex-init

You are running in a **git repository**. Your job is to initialize Auto‑Codex with **minimum changes**.

## Create or update

1) `.auto-codex/config.json`
2) `AGENTS.md` in the repository root

## Rules

- Be **idempotent**: re-running should not break anything.
- Prefer **existing** commands/scripts; don't invent new tooling.
- Do **not** add production dependencies.
- Keep AGENTS.md short.

## Infer repo commands (if possible)

Try to infer these commands (leave empty if unsure):

- `setup` (install deps)
- `test`
- `lint`
- `format`
- `build`

Prefer these sources:

- `package.json` scripts / workspace configs
- `Makefile` / `Justfile`
- `pyproject.toml` / `poetry.lock` / `requirements*.txt`
- `README.md` / `CONTRIBUTING.md`

## Write `.auto-codex/config.json`

- Must remain valid JSON.
- Keep any existing user values.
- Use this structure:

```json
{
  "version": 1,
  "agents": 4,
  "commands": {"setup":"","test":"","lint":"","format":"","build":""},
  "codex": {
    "model": "gpt-5.2-codex",
    "sandbox": "workspace-write",
    "web_search": "cached",
    "network_access": false,
    "reasoning_effort": "xhigh",
    "full_auto": true,
    "api_keys_env": []
  }
}
```

## Git ignore

Auto‑Codex writes run artifacts and worktrees into `.auto-codex/`. Ensure they don't block future runs:

- ignore `.auto-codex/runs/`
- ignore `.auto-codex/worktrees/`

## Write `AGENTS.md`

Include:

- Setup command(s)
- Test command(s)
- Lint/format/build (if known)
- Conventions:
  - keep diffs small
  - follow existing patterns
  - run relevant checks before claiming done

## Final output

Print a short summary: detected stack + chosen commands + files written.
