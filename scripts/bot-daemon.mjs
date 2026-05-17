#!/usr/bin/env node
/**
 * Фоновый запуск/остановка Telegram-бота в workspace.
 * Не читает и не печатает секреты — только pid и пути к логу.
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ART = path.join(ROOT, "artifacts");
const PID_FILE = path.join(ART, "telegram-bot.pid");
const LOG_FILE = path.join(ART, "telegram-bot.log");
const BOT_JS = path.join(ROOT, "dist", "telegram-bot.js");

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid() {
  if (!existsSync(PID_FILE)) return null;
  const n = parseInt(readFileSync(PID_FILE, "utf8").trim(), 10);
  return Number.isFinite(n) ? n : null;
}

const sub = process.argv[2] ?? "help";

if (sub === "start") {
  if (!existsSync(BOT_JS)) {
    console.error("Нет dist/telegram-bot.js — выполните: npm run build");
    process.exit(1);
  }
  mkdirSync(ART, { recursive: true });
  const existing = readPid();
  if (existing !== null && pidAlive(existing)) {
    console.error(
      "Процесс уже запущен (см. artifacts/telegram-bot.pid). Остановка: npm run bot:stop",
    );
    process.exit(1);
  }
  if (existing !== null && !pidAlive(existing)) {
    try {
      unlinkSync(PID_FILE);
    } catch {
      /* noop */
    }
  }
  const logFd = openSync(LOG_FILE, "a");
  const child = spawn(process.execPath, [BOT_JS], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: process.env,
  });
  child.unref();
  writeFileSync(PID_FILE, `${child.pid}\n`, "utf8");
  console.error(
    `Запущен фоновый процесс (pid в artifacts/telegram-bot.pid). Лог: artifacts/telegram-bot.log`,
  );
  process.exit(0);
}

if (sub === "stop") {
  const pid = readPid();
  if (pid === null) {
    console.error("Файл pid не найден — бот не считается запущенным через bot:daemon.");
    process.exit(0);
  }
  if (!pidAlive(pid)) {
    try {
      unlinkSync(PID_FILE);
    } catch {
      /* noop */
    }
    console.error("Процесс не активен — удалён устаревший telegram-bot.pid.");
    process.exit(0);
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
  try {
    unlinkSync(PID_FILE);
  } catch {
    /* noop */
  }
  console.error("Отправлен SIGTERM процессу из telegram-bot.pid.");
  process.exit(0);
}

if (sub === "status") {
  const pid = readPid();
  if (pid === null) {
    console.error("Нет artifacts/telegram-bot.pid.");
    process.exit(0);
  }
  console.error(
    pidAlive(pid)
      ? `Активен pid=${pid}`
      : `Неактивен (устаревший pid=${pid} в файле)`,
  );
  process.exit(0);
}

console.error("Использование: node scripts/bot-daemon.mjs start|stop|status");
process.exit(1);
