#!/usr/bin/env node
/**
 * Диагностика окружения Telegram-бота: только имена переменных и set/empty/missing.
 * Секретные значения не печатаются.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
config({ path: path.join(ROOT, ".env") });
const extra = process.env.MCP_KV_DOTENV_PATH?.trim();
if (extra) config({ path: path.resolve(ROOT, extra), override: true });

const NAMES = [
  "TELEGRAM_BOT_TOKEN",
  "CURSOR_API_KEY",
  "CURSOR_MODEL",
  "WORKSPACE_ROOT",
  "TELEGRAM_ALLOWED_CHAT_IDS",
  "BOT_TIMEZONE",
  "CONTEXT7_API_KEY",
  "MCP_KV_HTTP_URL",
  "MCP_KV_HTTP_BEARER",
  "MCP_KV_DOTENV_PATH",
  "MCP_KV_HTTP_TYPE",
];

function status(name) {
  const raw = process.env[name];
  if (raw === undefined) return "missing";
  const t = String(raw).trim();
  if (!t) return "empty";
  return "set";
}

function workspaceRootResolved() {
  const w = process.env.WORKSPACE_ROOT?.trim();
  if (w) return path.resolve(w);
  if (existsSync("/workspace")) return "/workspace";
  return process.cwd();
}

function statusRu(name) {
  const s = status(name);
  if (s === "set") return "задано";
  return "пусто";
}

const allowRaw = process.env.TELEGRAM_ALLOWED_CHAT_IDS?.trim();
let allowMode = "начальная настройка (список не задан)";
if (allowRaw) {
  const n = allowRaw.split(/[,;\s]+/).filter(Boolean).length;
  allowMode = n ? `ограничено списком (${n} chat_id)` : "начальная настройка (список не задан)";
}

console.log("bot:env-check — без вывода секретов\n");
console.log(`Каталог workspace (как у бота): ${workspaceRootResolved()}`);
console.log(`Режим доступа: ${allowMode}\n`);

for (const name of NAMES) {
  console.log(`${name}: ${statusRu(name)}`);
}
