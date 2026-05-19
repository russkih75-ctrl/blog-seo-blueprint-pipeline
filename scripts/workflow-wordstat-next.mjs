#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { ROOT, resolveWordstatLastOutPath } from "./wordstat-queue-core.mjs";

loadEnv({ path: path.join(ROOT, ".env") });

const ART = path.join(ROOT, "artifacts");
const LAST_OUT_PATH = resolveWordstatLastOutPath();
const RUN_LOG_PATH = path.join(ART, "workflow-wordstat-next.json");

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: opts.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    shell: process.platform === "win32",
    env: process.env,
    encoding: "utf-8",
  });
  if (res.status !== 0) {
    const err = new Error(`${cmd} ${args.join(" ")} failed with ${res.status}`);
    err.result = res;
    throw err;
  }
  return res;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf-8"));
}

mkdirSync(ART, { recursive: true });

const startedAt = new Date().toISOString();
run(npmCmd, ["run", "wp:sync-content-index"]);

const reusePending =
  String(process.env.WORDSTAT_REUSE_PENDING ?? "").toLowerCase() === "true";
const existingLast = existsSync(LAST_OUT_PATH) ? readJson(LAST_OUT_PATH) : null;
if (!reusePending || existingLast?.mode !== "topic" || !String(existingLast?.phrase ?? "").trim()) {
  run(npmCmd, ["run", "wp:wordstat-queue-next"]);
}
if (!existsSync(LAST_OUT_PATH)) {
  throw new Error(`${path.basename(LAST_OUT_PATH)} was not written`);
}

const next = readJson(LAST_OUT_PATH);
if (next.mode !== "topic" || !String(next.phrase ?? "").trim()) {
  writeFileSync(
    RUN_LOG_PATH,
    JSON.stringify(
      {
        ok: false,
        startedAt,
        finishedAt: new Date().toISOString(),
        reason: "no_publishable_wordstat_topic",
        next,
      },
      null,
      2,
    ),
    "utf-8",
  );
  process.stdout.write(JSON.stringify({ ok: false, reason: "no_publishable_wordstat_topic", next }, null, 2));
  process.exit(2);
}

const phrase = String(next.phrase).trim();
writeFileSync(
  RUN_LOG_PATH,
  JSON.stringify(
    {
      ok: null,
      startedAt,
      phrase,
      seedId: next.seedId ?? null,
      clusterId: next.clusterId ?? null,
      shows: next.shows ?? null,
    },
    null,
    2,
  ),
  "utf-8",
);

run(npmCmd, ["run", "workflow:cloud", "--", phrase]);

writeFileSync(
  RUN_LOG_PATH,
  JSON.stringify(
    {
      ok: true,
      startedAt,
      finishedAt: new Date().toISOString(),
      phrase,
      seedId: next.seedId ?? null,
      clusterId: next.clusterId ?? null,
      shows: next.shows ?? null,
      lastQueuePath: path.relative(ROOT, LAST_OUT_PATH),
    },
    null,
    2,
  ),
  "utf-8",
);

process.stdout.write(
  JSON.stringify(
    {
      ok: true,
      phrase,
      seedId: next.seedId ?? null,
      clusterId: next.clusterId ?? null,
      runLog: path.relative(ROOT, RUN_LOG_PATH),
    },
    null,
    2,
  ),
);
