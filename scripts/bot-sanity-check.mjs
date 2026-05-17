#!/usr/bin/env node
/**
 * Проверки без секретов: очередь Wordstat --peek, маркеры сборки бота, триггеры текста.
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const queueScript = path.join(ROOT, "scripts", "wp-wordstat-queue-next.mjs");

function normTrigger(s) {
  return String(s ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

const rpeek = spawnSync(process.execPath, [queueScript, "--peek"], {
  cwd: ROOT,
  encoding: "utf-8",
  env: process.env,
  timeout: 120_000,
});

if (rpeek.status !== 0) {
  console.error(`FAIL: wp-wordstat-queue-next --peek exited ${rpeek.status}`);
  process.exit(1);
}

let jpeek;
try {
  jpeek = JSON.parse(String(rpeek.stdout ?? "").trim());
} catch {
  console.error("FAIL: peek stdout is not valid JSON");
  process.exit(1);
}

if (jpeek.peek !== true) {
  console.error("FAIL: JSON must include peek:true");
  process.exit(1);
}

const distBot = path.join(ROOT, "dist", "telegram-bot.js");
let distSrc;
try {
  distSrc = readFileSync(distBot, "utf-8");
} catch {
  console.error("FAIL: dist/telegram-bot.js missing — run npm run build");
  process.exit(1);
}

for (const needle of [
  "publish_article_confirm",
  "mode_ask",
  "CURSOR_CLOUD_AUTOMATION_UI_URL",
  "buildRestrictedModePrefix",
]) {
  if (!distSrc.includes(needle)) {
    console.error(`FAIL: dist telegram-bot missing: ${needle}`);
    process.exit(1);
  }
}

if (normTrigger("  Опубликуй статью ") !== "опубликуй статью") {
  console.error("FAIL: publish intent normalization");
  process.exit(1);
}

if (normTrigger("остановить автоматизацию") !== "остановить автоматизацию") {
  console.error("FAIL: stop automation normalization");
  process.exit(1);
}

console.error(
  "OK: peek queue, dist markers, publish/stop trigger normalization",
);
process.exit(0);
