---
name: auto-codex-task
description: Execute ONE task inside the current worktree. You may edit files and run commands, but do not commit.
---

# auto-codex-task

You are working inside a git worktree on a single task.

## Rules

- Follow `AGENTS.md` and repository conventions.
- Keep changes small and focused.
- You may run targeted checks (`test`, `lint`) if available.
- Do NOT run `git commit`.

## Output

Return **ONLY JSON** matching the output schema:

- task_id
- status: done|blocked
- summary (short markdown)
- files_changed
- commands_run
- tests
- notes

Include all fields required by schema; use empty `[]`/`""` when not applicable.
