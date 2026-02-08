#!/usr/bin/env node
"use strict";

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");

const CONFLICT_MARKER_RE = /^(<<<<<<<|=======|>>>>>>>)( |$)/m;

const DEFAULT_MODEL = "gpt-5.2-codex";
const DEFAULT_REASONING_EFFORT = "xhigh";
const VALID_REASONING_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh"]);

function die(msg, code = 1) {
  console.error(`auto-codex: ${msg}`);
  process.exit(code);
}

function formatCmd(cmd) {
  return cmd.map((part) => {
    if (/^[a-zA-Z0-9._/:=-]+$/.test(part)) {
      return part;
    }
    return JSON.stringify(part);
  }).join(" ");
}

async function sh(cmd, options = {}) {
  const {
    cwd,
    capture = false,
    check = true,
    env = process.env,
    shell = false,
    timeoutMs = 0,
  } = options;

  const stdio = capture ? ["ignore", "pipe", "pipe"] : "inherit";

  return await new Promise((resolve, reject) => {
    const child = shell
      ? spawn(cmd.join(" "), {
          cwd,
          env,
          stdio,
          shell: true,
        })
      : spawn(cmd[0], cmd.slice(1), {
          cwd,
          env,
          stdio,
        });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timer = null;

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, timeoutMs);
    }

    if (capture) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }

    child.on("error", (err) => {
      if (err && err.code === "ENOENT") {
        die(`command not found: ${shell ? cmd.join(" ") : cmd[0]}`);
      }
      reject(err);
    });

    child.on("close", (code) => {
      if (timer) {
        clearTimeout(timer);
      }

      if (timedOut) {
        reject(new Error(`command timed out after ${timeoutMs}ms: ${formatCmd(cmd)}`));
        return;
      }

      const result = {
        code: code ?? 1,
        stdout,
        stderr,
      };

      if (check && result.code !== 0) {
        const err = new Error(`command failed (${result.code}): ${formatCmd(cmd)}`);
        err.result = result;
        reject(err);
        return;
      }

      resolve(result);
    });
  });
}

function which(binary) {
  const cp = spawnSync("which", [binary], { stdio: "ignore" });
  if (cp.status !== 0) {
    die(`'${binary}' not found in PATH`);
  }
}

async function gitRoot(cwd) {
  const cp = await sh(["git", "rev-parse", "--show-toplevel"], { cwd, capture: true });
  const root = cp.stdout.trim();
  if (!root) {
    die("not inside a git repo");
  }
  return root;
}

async function gitBranch(repo) {
  const cp = await sh(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd: repo, capture: true });
  const branch = cp.stdout.trim();
  if (!branch) {
    die("cannot determine current branch");
  }
  return branch;
}

async function ensureClean(repo) {
  const cp = await sh(["git", "status", "--porcelain"], { cwd: repo, capture: true });
  if (cp.stdout.trim()) {
    die("working tree is not clean (commit/stash first)");
  }
}

function nowId() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const ts = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
  ].join("") + "-" + [
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
  const rnd = crypto.randomBytes(6).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6);
  return `${ts}-${rnd}`;
}

async function readJson(filePath) {
  const raw = await fsp.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function writeText(filePath, content) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, content, "utf8");
}

async function fileExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function hasConflictMarkers(filePath) {
  try {
    const text = await fsp.readFile(filePath, { encoding: "utf8" });
    return CONFLICT_MARKER_RE.test(text);
  } catch {
    return false;
  }
}

function normalizeReasoningEffort(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return DEFAULT_REASONING_EFFORT;
  }
  if (VALID_REASONING_EFFORTS.has(normalized)) {
    return normalized;
  }
  die(
    `invalid config.codex.reasoning_effort ${JSON.stringify(value)}; expected one of ${JSON.stringify(Array.from(VALID_REASONING_EFFORTS).sort())}`,
  );
}

async function ensureGitExcludes(repo, patterns) {
  let exclude;
  try {
    const gp = await sh(["git", "rev-parse", "--git-path", "info/exclude"], { cwd: repo, capture: true });
    const rel = gp.stdout.trim();
    if (!rel) {
      return;
    }
    exclude = path.resolve(repo, rel);
  } catch {
    return;
  }

  await fsp.mkdir(path.dirname(exclude), { recursive: true });

  let existing = "";
  if (await fileExists(exclude)) {
    existing = await fsp.readFile(exclude, { encoding: "utf8" });
  }

  const missing = patterns.filter((entry) => !existing.includes(entry));
  if (missing.length === 0) {
    return;
  }

  const lines = [];
  if (existing && !existing.endsWith("\n")) {
    lines.push("");
  }
  lines.push("# auto-codex");
  for (const pattern of missing) {
    lines.push(`${pattern.replace(/\/+$/, "")}/`);
  }
  await fsp.appendFile(exclude, `${lines.join("\n")}\n`, "utf8");
}

function scriptDir() {
  return __dirname;
}

function templatesDir() {
  return path.resolve(scriptDir(), "..", "templates");
}

function repoScaffoldPaths(repo) {
  const ac = path.join(repo, ".auto-codex");
  return {
    ac,
    config: path.join(ac, "config.json"),
    schemas: path.join(ac, "schemas"),
    runs: path.join(ac, "runs"),
    worktrees: path.join(ac, "worktrees"),
    skills: path.join(repo, ".agents", "skills"),
  };
}

async function copyFileEnsureDir(src, dst) {
  await fsp.mkdir(path.dirname(dst), { recursive: true });
  await fsp.copyFile(src, dst);
}

async function ensureScaffold(repo) {
  const t = templatesDir();
  const p = repoScaffoldPaths(repo);

  await ensureGitExcludes(repo, [".auto-codex/runs", ".auto-codex/worktrees"]);

  await fsp.mkdir(p.schemas, { recursive: true });
  await fsp.mkdir(p.runs, { recursive: true });
  await fsp.mkdir(p.worktrees, { recursive: true });
  await fsp.mkdir(p.skills, { recursive: true });

  if (!(await fileExists(p.config))) {
    await copyFileEnsureDir(path.join(t, "config.default.json"), p.config);
  }

  for (const name of ["plan.schema.json", "task.schema.json", "merge.schema.json"]) {
    await copyFileEnsureDir(path.join(t, "schemas", name), path.join(p.schemas, name));
  }

  for (const skill of ["auto-codex-init", "auto-codex-plan", "auto-codex-task", "auto-codex-merge"]) {
    const src = path.join(t, "skills", skill, "SKILL.md");
    const dst = path.join(p.skills, skill, "SKILL.md");
    if (!(await fileExists(dst))) {
      await copyFileEnsureDir(src, dst);
    }
  }
}

async function loadConfig(repo) {
  const cfg = path.join(repo, ".auto-codex", "config.json");
  if (!(await fileExists(cfg))) {
    return {};
  }
  try {
    return await readJson(cfg);
  } catch (err) {
    die(`failed to parse ${cfg}: ${err.message}`);
  }
}

function cfgGet(cfg, pathParts, fallback) {
  let current = cfg;
  for (const key of pathParts) {
    if (current === null || typeof current !== "object" || !(key in current)) {
      return fallback;
    }
    current = current[key];
  }
  return current;
}

function pickApiKey(cfg, workerI) {
  const envNames = cfgGet(cfg, ["codex", "api_keys_env"], []);
  if (!Array.isArray(envNames) || envNames.length === 0) {
    return null;
  }
  const name = String(envNames[workerI % envNames.length] || "").trim();
  if (!name) {
    return null;
  }
  const value = String(process.env[name] || "").trim();
  if (!value) {
    die(`env var ${JSON.stringify(name)} referenced in config.codex.api_keys_env is not set`);
  }
  return value;
}

async function codexExec({
  cwd,
  prompt,
  outPath,
  logPath,
  schemaPath,
  fullAuto,
  sandbox,
  model,
  webSearch,
  networkAccess,
  reasoningEffort,
  apiKey,
}) {
  which("codex");

  const cmd = ["codex", "exec"];
  if (fullAuto) {
    cmd.push("--full-auto");
  }
  cmd.push("--sandbox", sandbox);

  if (model) {
    cmd.push("--model", model);
  }

  if (webSearch) {
    cmd.push("--config", `web_search=\"${webSearch}\"`);
    if (webSearch === "live") {
      cmd.push("--search");
    }
  }

  if (reasoningEffort) {
    cmd.push("--config", `model_reasoning_effort=\"${normalizeReasoningEffort(reasoningEffort)}\"`);
  }

  if (sandbox === "workspace-write") {
    cmd.push("--config", `sandbox_workspace_write.network_access=${String(Boolean(networkAccess))}`);
  }

  if (schemaPath) {
    cmd.push("--output-schema", schemaPath);
  }

  cmd.push("-o", outPath, prompt);

  const env = { ...process.env };
  if (apiKey) {
    env.CODEX_API_KEY = apiKey;
  }

  await fsp.mkdir(path.dirname(outPath), { recursive: true });
  await fsp.mkdir(path.dirname(logPath), { recursive: true });

  const header = `# cwd: ${cwd}\n# cmd: ${formatCmd(cmd)}\n\n`;
  await fsp.writeFile(logPath, header, "utf8");

  return await new Promise((resolve, reject) => {
    const log = fs.createWriteStream(logPath, { flags: "a", encoding: "utf8" });
    const child = spawn(cmd[0], cmd.slice(1), {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk) => log.write(chunk));
    child.stderr.on("data", (chunk) => log.write(chunk));

    child.on("error", (err) => {
      log.end();
      if (err && err.code === "ENOENT") {
        die(`command not found: ${cmd[0]}`);
      }
      reject(err);
    });

    child.on("close", (code) => {
      log.end();
      resolve(code ?? 1);
    });
  });
}

function branchName(runId, taskId) {
  const safe = String(runId).replace(/[^a-zA-Z0-9._-]/g, "-");
  return `acdx/${safe}/${taskId}`;
}

function worktreeDir(repo, runId, taskId) {
  return path.join(repo, ".auto-codex", "worktrees", runId, taskId);
}

async function worktreeAdd(repo, baseRef, branch, worktreePath) {
  await fsp.mkdir(path.dirname(worktreePath), { recursive: true });
  await sh(["git", "worktree", "add", "-b", branch, worktreePath, baseRef], { cwd: repo });
}

async function worktreeRemove(repo, worktreePath) {
  await sh(["git", "worktree", "remove", "--force", worktreePath], { cwd: repo, check: false });
}

async function branchDelete(repo, branch) {
  await sh(["git", "branch", "-D", branch], { cwd: repo, check: false });
}

async function commitIfNeeded(worktreePath, message) {
  const st = await sh(["git", "status", "--porcelain"], { cwd: worktreePath, capture: true });
  if (!st.stdout.trim()) {
    return null;
  }
  await sh(["git", "add", "-A"], { cwd: worktreePath });
  const cp = await sh(["git", "commit", "--no-verify", "-m", message], {
    cwd: worktreePath,
    check: false,
    capture: true,
  });
  if (cp.code !== 0) {
    return null;
  }
  const sha = await sh(["git", "rev-parse", "HEAD"], { cwd: worktreePath, capture: true });
  return sha.stdout.trim() || null;
}

async function mergeDepsIntoWorktree(worktreePath, {
  repo,
  runId,
  taskId,
  deps,
  model,
  webSearch,
  reasoningEffort,
  apiKey,
}) {
  if (!deps || deps.length === 0) {
    return;
  }

  const schema = path.join(repo, ".auto-codex", "schemas", "merge.schema.json");
  const depMergeDir = path.join(repo, ".auto-codex", "runs", runId, "dep-merges", taskId);

  const depBranches = deps.map((depId) => branchName(runId, depId));
  for (const depBranch of depBranches) {
    const mergeResult = await sh(["git", "merge", "--no-ff", "--no-edit", depBranch], {
      cwd: worktreePath,
      check: false,
      capture: true,
    });

    if (mergeResult.code === 0) {
      continue;
    }

    const cf = await sh(["git", "diff", "--name-only", "--diff-filter=U"], {
      cwd: worktreePath,
      check: false,
      capture: true,
    });
    const conflicted = cf.stdout.split("\n").map((line) => line.trim()).filter(Boolean);

    if (conflicted.length === 0) {
      await sh(["git", "merge", "--abort"], { cwd: worktreePath, check: false });
      const output = `${mergeResult.stdout || ""}${mergeResult.stderr || ""}`.trim();
      die(`failed to merge dependency ${depBranch} into ${taskId} worktree:\n${output}`);
    }

    const contextPath = path.join(depMergeDir, `MERGE_DEPS_CONTEXT-${depBranch.replaceAll("/", "_")}.md`);

    const lines = [
      `# Dependency merge context (run ${runId})`,
      "",
      `Dependent task: ${taskId}`,
      `Merging dependency branch: ${depBranch}`,
      "",
      "## Conflicted files",
      ...conflicted.map((entry) => `- ${entry}`),
      "",
      "## Dependency summaries",
    ];

    for (const depId of deps) {
      const outPath = path.join(repo, ".auto-codex", "runs", runId, "results", `${depId}.json`);
      if (!(await fileExists(outPath))) {
        continue;
      }
      try {
        const obj = await readJson(outPath);
        lines.push("", `### ${depId}`, String(obj.summary || ""));
        if (obj.notes) {
          lines.push("", "Notes:", String(obj.notes));
        }
      } catch {
        continue;
      }
    }

    await writeText(contextPath, `${lines.join("\n")}\n`);

    const outPath = path.join(depMergeDir, `merge-dep-${depBranch.replaceAll("/", "_")}.json`);
    const logPath = path.join(depMergeDir, `merge-dep-${depBranch.replaceAll("/", "_")}.log`);

    const prompt = [
      "$auto-codex-merge",
      `Run ID: ${runId}`,
      `Task ID: ${taskId}`,
      `Merging dependency branch: ${depBranch}`,
      "",
      "Resolve conflicts by editing files only. Do NOT run git add/commit.",
      "",
      `Context: ${contextPath}`,
      "",
    ].join("\n");

    const rc = await codexExec({
      cwd: worktreePath,
      prompt,
      outPath,
      logPath,
      schemaPath: schema,
      fullAuto: true,
      sandbox: "workspace-write",
      model,
      webSearch,
      networkAccess: false,
      reasoningEffort,
      apiKey,
    });

    if (rc !== 0) {
      await sh(["git", "merge", "--abort"], { cwd: worktreePath, check: false });
      die(`dependency merge agent failed (rc=${rc}). See ${logPath}`);
    }

    const stillMarked = [];
    for (const fileRel of conflicted) {
      const fullPath = path.join(worktreePath, fileRel);
      if (await fileExists(fullPath)) {
        if (await hasConflictMarkers(fullPath)) {
          stillMarked.push(fileRel);
        }
      }
    }

    if (stillMarked.length > 0) {
      await sh(["git", "merge", "--abort"], { cwd: worktreePath, check: false });
      die(`dependency merge conflict markers remain:\n${stillMarked.join("\n")}\nSee ${logPath}`);
    }

    await sh(["git", "add", "-A"], { cwd: worktreePath });
    const cf2 = await sh(["git", "diff", "--name-only", "--diff-filter=U"], {
      cwd: worktreePath,
      check: false,
      capture: true,
    });
    const remaining = cf2.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
    if (remaining.length > 0) {
      await sh(["git", "merge", "--abort"], { cwd: worktreePath, check: false });
      die(`dependency merge conflicts remain (unmerged paths):\n${remaining.join("\n")}\nSee ${logPath}`);
    }

    await sh(["git", "commit", "--no-verify", "-m", `Merge ${depBranch} (deps for ${taskId})`], {
      cwd: worktreePath,
      check: false,
    });
  }
}

function topoSortTaskIds(tasks) {
  const depsMap = new Map();
  for (const task of tasks) {
    const tid = String(task.id || "");
    const deps = task.depends_on || [];
    if (!Array.isArray(deps)) {
      die(`task ${tid} depends_on must be a list`);
    }
    depsMap.set(tid, deps.map((dep) => String(dep)));
  }

  const indeg = new Map();
  const rev = new Map();
  for (const tid of depsMap.keys()) {
    indeg.set(tid, 0);
    rev.set(tid, []);
  }

  for (const [tid, deps] of depsMap.entries()) {
    const uniq = Array.from(new Set(deps));
    indeg.set(tid, uniq.length);
    for (const dep of uniq) {
      const bucket = rev.get(dep);
      if (!bucket) {
        die(`task ${tid} depends on unknown task ${dep}`);
      }
      bucket.push(tid);
    }
  }

  const ready = Array.from(indeg.entries())
    .filter(([, deg]) => deg === 0)
    .map(([tid]) => tid)
    .sort();

  const order = [];
  while (ready.length > 0) {
    const current = ready.shift();
    order.push(current);
    for (const next of [...(rev.get(current) || [])].sort()) {
      indeg.set(next, (indeg.get(next) || 0) - 1);
      if (indeg.get(next) === 0) {
        ready.push(next);
        ready.sort();
      }
    }
  }

  if (order.length !== depsMap.size) {
    die("task dependency cycle detected in plan");
  }

  return order;
}

async function parsePlan(planPath) {
  const data = await readJson(planPath);
  const title = String(data.title || "");
  const overview = String(data.overview || "");
  const mergeNotes = String(data.merge_notes || "");
  const tasks = data.tasks;

  if (!Array.isArray(tasks) || tasks.length === 0) {
    die("plan has no tasks");
  }

  const ids = [];
  const seen = new Set();

  for (const task of tasks) {
    if (task === null || typeof task !== "object" || Array.isArray(task)) {
      die("plan task is not an object");
    }

    const tid = String(task.id || "");
    if (!/^T\d{2}$/.test(tid)) {
      die(`bad task id: ${JSON.stringify(tid)}`);
    }
    if (seen.has(tid)) {
      die(`duplicate task id: ${JSON.stringify(tid)}`);
    }

    ids.push(tid);
    seen.add(tid);

    const deps = task.depends_on || [];
    if (!Array.isArray(deps)) {
      die(`task ${tid} depends_on must be a list`);
    }

    for (const dep of deps) {
      if (String(dep) === tid) {
        die(`task ${tid} depends on itself`);
      }
    }
  }

  const idSet = new Set(ids);
  for (const task of tasks) {
    const tid = String(task.id || "");
    for (const dep of task.depends_on || []) {
      if (!idSet.has(String(dep))) {
        die(`task ${tid} depends on unknown task ${dep}`);
      }
    }
  }

  const order = topoSortTaskIds(tasks);
  return {
    title,
    overview,
    tasks,
    mergeNotes,
    order,
  };
}

async function writeTaskMd(runDir, goal, overview, tasks) {
  const tasksDir = path.join(runDir, "tasks");
  await fsp.mkdir(tasksDir, { recursive: true });
  await writeText(
    path.join(tasksDir, "GOAL.md"),
    `# Goal\n\n${goal}\n\n# Plan overview\n\n${overview}\n`,
  );

  for (const task of tasks) {
    const tid = String(task.id);
    const title = String(task.title || tid);
    const prompt = String(task.prompt || "");
    const deps = Array.isArray(task.depends_on) ? task.depends_on : [];

    const lines = [`# ${tid}: ${title}`, "", "## Prompt", "", prompt];
    if (deps.length > 0) {
      lines.push("", "## Depends on", "", ...deps.map((dep) => `- ${dep}`));
    }

    await writeText(path.join(tasksDir, `${tid}.md`), `${lines.join("\n")}\n`);
  }
}

async function runTask({
  repo,
  baseRef,
  runId,
  goal,
  overview,
  task,
  cfg,
  workerI,
}) {
  const tid = String(task.id);
  const title = String(task.title || tid);

  const branch = branchName(runId, tid);
  const wt = worktreeDir(repo, runId, tid);
  await worktreeAdd(repo, baseRef, branch, wt);

  const runDir = path.join(repo, ".auto-codex", "runs", runId);
  const out = path.join(runDir, "results", `${tid}.json`);
  const log = path.join(runDir, "logs", `${tid}.log`);
  const schema = path.join(repo, ".auto-codex", "schemas", "task.schema.json");

  const codexCfg = cfg && typeof cfg.codex === "object" && cfg.codex ? cfg.codex : {};

  let model = String(codexCfg.model || "");
  if (!model) {
    model = DEFAULT_MODEL;
  }

  const sandbox = String(codexCfg.sandbox || "workspace-write");
  const fullAuto = Boolean(codexCfg.full_auto ?? true);
  const webSearch = String(codexCfg.web_search || "cached");
  const networkAccess = Boolean(codexCfg.network_access || false);
  const reasoningEffort = normalizeReasoningEffort(codexCfg.reasoning_effort || DEFAULT_REASONING_EFFORT);
  const apiKey = pickApiKey(cfg, workerI);

  const deps = Array.isArray(task.depends_on) ? task.depends_on.map((dep) => String(dep)) : [];
  if (deps.length > 0) {
    await mergeDepsIntoWorktree(wt, {
      repo,
      runId,
      taskId: tid,
      deps,
      model,
      webSearch,
      reasoningEffort,
      apiKey,
    });
  }

  const prompt = [
    "$auto-codex-task",
    `Run ID: ${runId}`,
    `Base: ${baseRef}`,
    `Task ID: ${tid}`,
    `Task title: ${title}`,
    "",
    "Overall goal:",
    goal,
    "",
    "Plan overview:",
    overview,
    "",
    "Task prompt:",
    String(task.prompt || ""),
    "",
  ].join("\n");

  const rc = await codexExec({
    cwd: wt,
    prompt,
    outPath: out,
    logPath: log,
    schemaPath: schema,
    fullAuto,
    sandbox,
    model,
    webSearch,
    networkAccess,
    reasoningEffort,
    apiKey,
  });

  const commit = await commitIfNeeded(wt, `${tid}: ${title}`);

  return {
    id: tid,
    title,
    branch,
    worktree: wt,
    returncode: rc,
    commit,
    codex_output: out,
    codex_log: log,
  };
}

async function scheduleTasks({
  repo,
  baseRef,
  runId,
  goal,
  overview,
  tasks,
  cfg,
  workers,
}) {
  const pending = new Map(tasks.map((task) => [String(task.id), task]));
  const done = new Set();
  const results = {};
  const running = new Map();

  let workerI = 0;
  let stopLaunching = false;

  const depsOk = (task) => {
    const deps = Array.isArray(task.depends_on) ? task.depends_on.map((dep) => String(dep)) : [];
    return deps.every((dep) => done.has(dep));
  };

  while (pending.size > 0 || running.size > 0) {
    if (!stopLaunching) {
      const ready = Array.from(pending.values())
        .filter((task) => depsOk(task))
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));

      while (ready.length > 0 && running.size < workers) {
        const task = ready.shift();
        const tid = String(task.id);
        pending.delete(tid);

        const wi = workerI;
        workerI += 1;

        const promise = runTask({
          repo,
          baseRef,
          runId,
          goal,
          overview,
          task,
          cfg,
          workerI: wi,
        }).then((res) => ({ tid, res })).catch((err) => ({ tid, err }));

        running.set(tid, promise);
      }
    }

    if (running.size === 0) {
      die("task dependency deadlock (nothing ready to run)");
    }

    const finished = await Promise.race(Array.from(running.values()));
    running.delete(finished.tid);

    if (finished.err) {
      throw finished.err;
    }

    const result = finished.res;
    results[finished.tid] = result;
    done.add(finished.tid);

    if (result.returncode !== 0) {
      stopLaunching = true;
      pending.clear();
    }
  }

  return results;
}

async function writeSummary(runDir, title, overview, results) {
  const lines = [
    "# Auto-Codex run",
    "",
    `**Title:** ${title}`,
    "",
    "## Overview",
    "",
    overview,
    "",
    "## Tasks",
    "",
  ];

  for (const tid of Object.keys(results).sort()) {
    const result = results[tid];
    const status = result.returncode === 0 ? "OK" : `FAIL(${result.returncode})`;
    lines.push(`- **${tid}** ${result.title || ""} - ${status} - \`${result.branch}\` - \`${result.commit || "no commit"}\``);
    lines.push(`  - log: \`${result.codex_log}\``);
    lines.push(`  - result: \`${result.codex_output}\``);
  }

  await writeText(path.join(runDir, "SUMMARY.md"), `${lines.join("\n")}\n`);
}

async function mergeBranches({ repo, baseBranch, runId, ordered, cfg }) {
  await ensureClean(repo);
  await sh(["git", "checkout", baseBranch], { cwd: repo });

  const runDir = path.join(repo, ".auto-codex", "runs", runId);
  const mergeDir = path.join(runDir, "merge");
  await fsp.mkdir(mergeDir, { recursive: true });

  const codexCfg = cfg && typeof cfg.codex === "object" && cfg.codex ? cfg.codex : {};

  let model = String(codexCfg.model || "");
  if (!model) {
    model = DEFAULT_MODEL;
  }
  const webSearch = String(codexCfg.web_search || "cached");
  const reasoningEffort = normalizeReasoningEffort(codexCfg.reasoning_effort || DEFAULT_REASONING_EFFORT);

  const schema = path.join(repo, ".auto-codex", "schemas", "merge.schema.json");

  for (const result of ordered) {
    if (!result.commit) {
      continue;
    }

    const branch = result.branch;

    const mergeResult = await sh(["git", "merge", "--no-ff", "--no-commit", branch], {
      cwd: repo,
      check: false,
      capture: true,
    });

    if (mergeResult.code === 0) {
      await sh(["git", "commit", "--no-verify", "-m", `Merge ${branch}`], { cwd: repo, check: false });
      continue;
    }

    const cf = await sh(["git", "diff", "--name-only", "--diff-filter=U"], {
      cwd: repo,
      check: false,
      capture: true,
    });
    const conflicted = cf.stdout.split("\n").map((line) => line.trim()).filter(Boolean);

    if (conflicted.length === 0) {
      await sh(["git", "merge", "--abort"], { cwd: repo, check: false });
      const output = `${mergeResult.stdout || ""}${mergeResult.stderr || ""}`.trim();
      die(`failed to merge ${branch}:\n${output}`);
    }

    const contextPath = path.join(mergeDir, "MERGE_CONTEXT.md");
    const lines = [
      `# Merge context (run ${runId})`,
      "",
      `Merging: ${branch}`,
      "",
      "## Conflicted files",
      ...conflicted.map((entry) => `- ${entry}`),
      "",
      "## Task summaries",
    ];

    for (const orderedResult of ordered) {
      const outputPath = String(orderedResult.codex_output || "");
      if (!outputPath || !(await fileExists(outputPath))) {
        continue;
      }

      lines.push("", `### ${orderedResult.id}: ${orderedResult.title}`);
      try {
        const obj = await readJson(outputPath);
        lines.push(String(obj.summary || ""));
        if (obj.notes) {
          lines.push("", "Notes:", String(obj.notes));
        }
      } catch {
        continue;
      }
    }

    await writeText(contextPath, `${lines.join("\n")}\n`);

    const outPath = path.join(mergeDir, `merge-${result.id}.json`);
    const logPath = path.join(mergeDir, `merge-${result.id}.log`);

    const prompt = [
      "$auto-codex-merge",
      `Run ID: ${runId}`,
      `Base branch: ${baseBranch}`,
      `Merging: ${branch}`,
      "",
      "Conflicts:",
      ...conflicted.map((entry) => `- ${entry}`),
      "",
      `Intent + summaries: ${contextPath}`,
      "",
      "Resolve conflicts by editing files only. Do NOT run git add/commit.",
      "",
    ].join("\n");

    const rc = await codexExec({
      cwd: repo,
      prompt,
      outPath,
      logPath,
      schemaPath: schema,
      fullAuto: true,
      sandbox: "workspace-write",
      model,
      webSearch,
      networkAccess: false,
      reasoningEffort,
      apiKey: pickApiKey(cfg, 0),
    });

    if (rc !== 0) {
      die(`merge agent failed (rc=${rc}). See ${logPath}`);
    }

    const stillMarked = [];
    for (const fileRel of conflicted) {
      const fullPath = path.join(repo, fileRel);
      if (await fileExists(fullPath)) {
        if (await hasConflictMarkers(fullPath)) {
          stillMarked.push(fileRel);
        }
      }
    }

    if (stillMarked.length > 0) {
      die(`merge conflict markers remain:\n${stillMarked.join("\n")}\nSee ${logPath}`);
    }

    await sh(["git", "add", "-A"], { cwd: repo });

    const cf2 = await sh(["git", "diff", "--name-only", "--diff-filter=U"], {
      cwd: repo,
      check: false,
      capture: true,
    });
    const remaining = cf2.stdout.split("\n").map((line) => line.trim()).filter(Boolean);

    if (remaining.length > 0) {
      die(`merge conflicts remain (unmerged paths):\n${remaining.join("\n")}\nSee ${logPath}`);
    }

    await sh(["git", "commit", "--no-verify", "-m", `Merge ${branch}`], { cwd: repo, check: false });
  }

  const testCmd = String(cfgGet(cfg, ["commands", "test"], "") || "").trim();
  if (testCmd) {
    console.error(`auto-codex: running tests: ${testCmd}`);
    const result = await sh([testCmd], { cwd: repo, check: false, shell: true });
    if (result.code !== 0) {
      console.error("auto-codex: tests failed after merge");
    }
  }
}

function clampAgents(value, fallback = 4) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  const finalValue = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(1, Math.min(finalValue, 16));
}

async function cmdInit() {
  which("git");
  which("codex");

  const repo = await gitRoot(process.cwd());
  await ensureScaffold(repo);

  const cfg = await loadConfig(repo);
  const codexCfg = cfg && typeof cfg.codex === "object" && cfg.codex ? cfg.codex : {};

  let model = String(codexCfg.model || "");
  if (!model) {
    model = DEFAULT_MODEL;
  }

  const webSearch = String(codexCfg.web_search || "cached");
  const reasoningEffort = normalizeReasoningEffort(codexCfg.reasoning_effort || DEFAULT_REASONING_EFFORT);

  const runDir = path.join(repo, ".auto-codex", "runs", "init");
  await fsp.mkdir(runDir, { recursive: true });

  const rc = await codexExec({
    cwd: repo,
    prompt: [
      "$auto-codex-init",
      "Initialize this repository for auto-codex.",
      "Create/update .auto-codex/config.json and AGENTS.md in repo root.",
      "Keep it minimal and idempotent.",
    ].join(" "),
    outPath: path.join(runDir, "init-output.txt"),
    logPath: path.join(runDir, "init.log"),
    schemaPath: null,
    fullAuto: true,
    sandbox: "workspace-write",
    model,
    webSearch,
    networkAccess: false,
    reasoningEffort,
    apiKey: pickApiKey(cfg, 0),
  });

  if (rc !== 0) {
    die(`init failed (rc=${rc}). See ${path.join(runDir, "init.log")}`);
  }

  console.log(`Initialized. Log: ${path.join(runDir, "init.log")}`);
}

async function cmdPlan(args) {
  which("git");
  which("codex");

  const repo = await gitRoot(process.cwd());
  await ensureScaffold(repo);

  const cfg = await loadConfig(repo);
  const agents = clampAgents(args.agents ?? cfgGet(cfg, ["agents"], 4), 4);

  const runId = nowId();
  const runDir = path.join(repo, ".auto-codex", "runs", runId);
  await fsp.mkdir(runDir, { recursive: true });

  const schema = path.join(repo, ".auto-codex", "schemas", "plan.schema.json");

  const codexCfg = cfg && typeof cfg.codex === "object" && cfg.codex ? cfg.codex : {};
  let model = String(codexCfg.model || "");
  if (!model) {
    model = DEFAULT_MODEL;
  }
  const webSearch = String(codexCfg.web_search || "cached");
  const reasoningEffort = normalizeReasoningEffort(codexCfg.reasoning_effort || DEFAULT_REASONING_EFFORT);

  const rc = await codexExec({
    cwd: repo,
    prompt: `$auto-codex-plan\nMax parallel agents: ${agents}\nUser goal:\n${args.goal}\n`,
    outPath: path.join(runDir, "plan.json"),
    logPath: path.join(runDir, "plan.log"),
    schemaPath: schema,
    fullAuto: false,
    sandbox: "read-only",
    model,
    webSearch,
    networkAccess: false,
    reasoningEffort,
    apiKey: pickApiKey(cfg, 0),
  });

  if (rc !== 0) {
    die(`plan failed (rc=${rc}). See ${path.join(runDir, "plan.log")}`);
  }

  const parsed = await parsePlan(path.join(runDir, "plan.json"));
  await writeTaskMd(runDir, args.goal, parsed.overview, parsed.tasks);

  console.log(`Plan: ${path.join(runDir, "plan.json")}`);
  console.log(`Run dir: ${runDir}`);
  if (parsed.mergeNotes) {
    console.log(`\nMerge notes:\n${parsed.mergeNotes}`);
  }
}

async function cmdRun(args) {
  which("git");
  which("codex");

  const repo = await gitRoot(process.cwd());
  await ensureScaffold(repo);
  await ensureClean(repo);

  const cfg = await loadConfig(repo);
  const agents = clampAgents(args.agents ?? cfgGet(cfg, ["agents"], 4), 4);

  const base = args.base || await gitBranch(repo);

  const runId = nowId();
  const runDir = path.join(repo, ".auto-codex", "runs", runId);
  await fsp.mkdir(runDir, { recursive: true });

  const schema = path.join(repo, ".auto-codex", "schemas", "plan.schema.json");

  const codexCfg = cfg && typeof cfg.codex === "object" && cfg.codex ? cfg.codex : {};
  let model = String(codexCfg.model || "");
  if (!model) {
    model = DEFAULT_MODEL;
  }
  const webSearch = String(codexCfg.web_search || "cached");
  const reasoningEffort = normalizeReasoningEffort(codexCfg.reasoning_effort || DEFAULT_REASONING_EFFORT);

  const rc = await codexExec({
    cwd: repo,
    prompt: `$auto-codex-plan\nMax parallel agents: ${agents}\nUser goal:\n${args.goal}\n`,
    outPath: path.join(runDir, "plan.json"),
    logPath: path.join(runDir, "plan.log"),
    schemaPath: schema,
    fullAuto: false,
    sandbox: "read-only",
    model,
    webSearch,
    networkAccess: false,
    reasoningEffort,
    apiKey: pickApiKey(cfg, 0),
  });

  if (rc !== 0) {
    die(`plan failed (rc=${rc}). See ${path.join(runDir, "plan.log")}`);
  }

  const parsed = await parsePlan(path.join(runDir, "plan.json"));
  await writeTaskMd(runDir, args.goal, parsed.overview, parsed.tasks);

  const results = await scheduleTasks({
    repo,
    baseRef: base,
    runId,
    goal: args.goal,
    overview: parsed.overview,
    tasks: parsed.tasks,
    cfg,
    workers: agents,
  });

  await writeSummary(runDir, parsed.title, parsed.overview, results);

  const failed = Object.values(results).filter((result) => result.returncode !== 0);
  if (failed.length > 0) {
    console.error(`auto-codex: some tasks failed; skipping merge. See ${path.join(runDir, "SUMMARY.md")}`);
    return;
  }

  if (args.noMerge) {
    console.log(`Done (no-merge). Summary: ${path.join(runDir, "SUMMARY.md")}`);
    return;
  }

  const ordered = parsed.order.filter((tid) => results[tid]).map((tid) => results[tid]);
  await mergeBranches({ repo, baseBranch: base, runId, ordered, cfg });

  console.log(`Done. Summary: ${path.join(runDir, "SUMMARY.md")}`);
  if (parsed.mergeNotes) {
    console.log(`\nMerge notes:\n${parsed.mergeNotes}`);
  }
}

async function cmdClean(args) {
  const repo = await gitRoot(process.cwd());
  const runId = args.run_id;
  const root = path.join(repo, ".auto-codex", "worktrees", runId);
  if (!(await fileExists(root))) {
    die(`no such worktree run: ${root}`);
  }

  const entries = await fsp.readdir(root, { withFileTypes: true });
  const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();

  for (const tid of dirs) {
    const dirPath = path.join(root, tid);
    const branch = branchName(runId, tid);
    console.error(`auto-codex: removing ${dirPath} and ${branch}`);
    await worktreeRemove(repo, dirPath);
    await branchDelete(repo, branch);
  }

  await fsp.rm(root, { recursive: true, force: true });
}

function packageJsonPath() {
  return path.resolve(scriptDir(), "..", "package.json");
}

function localVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath(), "utf8"));
    return String(pkg.version || "0.0.0");
  } catch {
    return "unknown";
  }
}

async function npmLatestVersion(packageName) {
  which("npm");
  let cp;
  try {
    cp = await sh(["npm", "view", packageName, "version"], {
      capture: true,
      check: false,
      timeoutMs: 8000,
    });
  } catch {
    return null;
  }

  if (!cp || cp.code !== 0) {
    return null;
  }
  const value = cp.stdout.trim();
  return value || null;
}

async function cmdVersion(args) {
  const local = localVersion();
  console.log(`auto-codex ${local}`);

  if (!args.check) {
    return;
  }

  const latest = await npmLatestVersion("auto-codex");
  if (!latest) {
    console.log("Latest on npm: unavailable");
    return;
  }

  console.log(`Latest on npm: ${latest}`);
  if (latest !== local) {
    console.log("Update available.");
  } else {
    console.log("You are on the latest version.");
  }
}

async function cmdUpdate(args) {
  const local = localVersion();
  const latest = await npmLatestVersion("auto-codex");

  if (!latest) {
    if (args.check) {
      console.log(`Current: ${local}`);
      console.log("Latest:  unavailable");
      console.log("Could not reach npm registry.");
      return;
    }
    die("could not fetch latest version from npm");
  }

  console.log(`Current: ${local}`);
  console.log(`Latest:  ${latest}`);

  if (local === latest) {
    console.log("Already up to date.");
    return;
  }

  if (args.check) {
    console.log("Run: npm install -g auto-codex@latest");
    return;
  }

  const install = await sh(["npm", "install", "-g", `auto-codex@${latest}`], {
    check: false,
  });

  if (install.code !== 0) {
    die("update failed (npm install -g auto-codex@latest)");
  }

  console.log(`Updated to ${latest}`);
}

function printHelp(subcommand) {
  const common = [
    "usage: auto-codex <command> [options]",
    "",
    "commands:",
    "  init                 init repo via Codex skill auto-codex-init",
    "  plan <goal>          create a parallel plan (JSON) via auto-codex-plan",
    "  run <goal>           plan + parallel worktrees + merge",
    "  clean <run_id>       remove worktrees + branches for a run id",
    "  version [--check]    print local version and optionally check npm latest",
    "  update [--check]     check for updates or update via npm -g",
    "",
    "global options:",
    "  -h, --help           show help",
  ];

  const planHelp = [
    "usage: auto-codex plan <goal> [-j <agents>]",
  ];

  const runHelp = [
    "usage: auto-codex run <goal> [-j <agents>] [--base <branch>] [--no-merge]",
  ];

  const cleanHelp = [
    "usage: auto-codex clean <run_id>",
  ];

  const versionHelp = [
    "usage: auto-codex version [--check]",
  ];

  const updateHelp = [
    "usage: auto-codex update [--check]",
  ];

  const index = {
    plan: planHelp,
    run: runHelp,
    clean: cleanHelp,
    version: versionHelp,
    update: updateHelp,
    init: ["usage: auto-codex init"],
  };

  if (subcommand && index[subcommand]) {
    console.log(index[subcommand].join("\n"));
    return;
  }

  console.log(common.join("\n"));
}

function parseNumericOption(flag, value) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) {
    die(`${flag} expects an integer, got: ${JSON.stringify(value)}`);
  }
  return parsed;
}

function parseGoalArgs(subcommand, argv) {
  let goalTokens = [];
  let agents;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === "-h" || token === "--help") {
      return { cmd: "help", subcommand };
    }

    if (token === "-j" || token === "--agents") {
      const next = argv[i + 1];
      if (next === undefined) {
        die(`${subcommand}: missing value for ${token}`);
      }
      agents = parseNumericOption(token, next);
      i += 1;
      continue;
    }

    if (token.startsWith("-")) {
      die(`${subcommand}: unknown option ${token}`);
    }

    goalTokens.push(token);
  }

  if (goalTokens.length === 0) {
    die(`${subcommand}: missing goal`);
  }

  return {
    cmd: subcommand,
    goal: goalTokens.join(" "),
    agents,
  };
}

function parseRunArgs(argv) {
  let goalTokens = [];
  let agents;
  let base;
  let noMerge = false;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === "-h" || token === "--help") {
      return { cmd: "help", subcommand: "run" };
    }

    if (token === "-j" || token === "--agents") {
      const next = argv[i + 1];
      if (next === undefined) {
        die(`run: missing value for ${token}`);
      }
      agents = parseNumericOption(token, next);
      i += 1;
      continue;
    }

    if (token === "--base") {
      const next = argv[i + 1];
      if (next === undefined) {
        die("run: missing value for --base");
      }
      base = next;
      i += 1;
      continue;
    }

    if (token === "--no-merge") {
      noMerge = true;
      continue;
    }

    if (token.startsWith("-")) {
      die(`run: unknown option ${token}`);
    }

    goalTokens.push(token);
  }

  if (goalTokens.length === 0) {
    die("run: missing goal");
  }

  return {
    cmd: "run",
    goal: goalTokens.join(" "),
    agents,
    base,
    noMerge,
  };
}

function parseArgs(argv) {
  if (!argv || argv.length === 0) {
    return { cmd: "help" };
  }

  const [cmd, ...rest] = argv;

  if (cmd === "-h" || cmd === "--help") {
    return { cmd: "help" };
  }

  if (cmd === "init") {
    if (rest.includes("-h") || rest.includes("--help")) {
      return { cmd: "help", subcommand: "init" };
    }
    if (rest.length > 0) {
      die("init takes no arguments");
    }
    return { cmd: "init" };
  }

  if (cmd === "plan") {
    return parseGoalArgs("plan", rest);
  }

  if (cmd === "run") {
    return parseRunArgs(rest);
  }

  if (cmd === "clean") {
    if (rest.includes("-h") || rest.includes("--help")) {
      return { cmd: "help", subcommand: "clean" };
    }
    if (rest.length !== 1) {
      die("clean requires exactly one argument: run_id");
    }
    return { cmd: "clean", run_id: rest[0] };
  }

  if (cmd === "version") {
    if (rest.includes("-h") || rest.includes("--help")) {
      return { cmd: "help", subcommand: "version" };
    }
    if (rest.length > 1) {
      die("version accepts at most one option: --check");
    }
    if (rest.length === 1 && rest[0] !== "--check") {
      die(`version: unknown option ${rest[0]}`);
    }
    return { cmd: "version", check: rest[0] === "--check" };
  }

  if (cmd === "update") {
    if (rest.includes("-h") || rest.includes("--help")) {
      return { cmd: "help", subcommand: "update" };
    }
    if (rest.length > 1) {
      die("update accepts at most one option: --check");
    }
    if (rest.length === 1 && rest[0] !== "--check") {
      die(`update: unknown option ${rest[0]}`);
    }
    return { cmd: "update", check: rest[0] === "--check" };
  }

  die(`unknown command: ${cmd}`);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);

  if (args.cmd === "help") {
    printHelp(args.subcommand);
    return;
  }

  if (args.cmd === "init") {
    await cmdInit();
    return;
  }

  if (args.cmd === "plan") {
    await cmdPlan(args);
    return;
  }

  if (args.cmd === "run") {
    await cmdRun(args);
    return;
  }

  if (args.cmd === "clean") {
    await cmdClean(args);
    return;
  }

  if (args.cmd === "version") {
    await cmdVersion(args);
    return;
  }

  if (args.cmd === "update") {
    await cmdUpdate(args);
    return;
  }

  die(`unhandled command: ${args.cmd}`);
}

if (require.main === module) {
  main().catch((err) => {
    if (err && err.result && typeof err.result.code === "number") {
      const details = [err.message];
      if (err.result.stdout && err.result.stdout.trim()) {
        details.push(err.result.stdout.trim());
      }
      if (err.result.stderr && err.result.stderr.trim()) {
        details.push(err.result.stderr.trim());
      }
      die(details.join("\n"));
    }

    die(err && err.message ? err.message : String(err));
  });
}

module.exports = {
  main,
};
