#!/usr/bin/env node
/**
 * Минимальная проверка без секретов: очередь Wordstat в режиме --peek не трогает state.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(ROOT, "scripts", "wp-wordstat-queue-next.mjs");

const r = spawnSync(process.execPath, [script, "--peek"], {
  cwd: ROOT,
  encoding: "utf-8",
  env: process.env,
  timeout: 120_000,
});

if (r.status !== 0) {
  console.error(`FAIL: wp-wordstat-queue-next --peek exited ${r.status}`);
  process.exit(1);
}

let j;
try {
  j = JSON.parse(String(r.stdout ?? "").trim());
} catch {
  console.error("FAIL: peek stdout is not valid JSON");
  process.exit(1);
}

if (j.peek !== true) {
  console.error("FAIL: JSON must include peek:true");
  process.exit(1);
}

console.error("OK: Wordstat queue peek (JSON valid, reservation skipped)");
process.exit(0);
