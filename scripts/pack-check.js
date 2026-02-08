#!/usr/bin/env node
"use strict";

const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const cacheDir = path.join(os.tmpdir(), "auto-codex-npm-cache");
const cp = spawnSync("npm", ["pack", "--dry-run"], {
  stdio: "inherit",
  env: {
    ...process.env,
    npm_config_cache: cacheDir,
  },
});

process.exit(cp.status ?? 1);
