/**
 * Telegram → локальный Cursor Agent (@cursor/sdk), один agentId на chat_id.
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { config as loadEnv } from "dotenv";
import { Bot, InlineKeyboard, Keyboard, type Api, type Context } from "grammy";
import {
  Agent,
  type McpServerConfig,
  type SDKAgent,
  type SDKMessage,
} from "@cursor/sdk";
import {
  clampIntervalMs,
  formatIntervalRu,
  matchNaturalSchedule,
  parseScheduleEveryArg,
  readSchedulesFile,
  SCHEDULE_MAX_MS,
  SCHEDULE_MIN_MS,
  stripMatchedSchedule,
  type ChatScheduleRecord,
  type SchedulesFile,
  writeSchedulesFile,
} from "./telegram-schedule.js";

const ROOT = path.resolve(import.meta.dirname, "..");
loadEnv({ path: path.join(ROOT, ".env") });

const mcpKvDotenvRel = process.env.MCP_KV_DOTENV_PATH?.trim();
if (mcpKvDotenvRel) {
  loadEnv({ path: path.resolve(ROOT, mcpKvDotenvRel), override: true });
}

const mcpKvUrlFile = process.env.MCP_KV_HTTP_URL_FILE?.trim();
if (mcpKvUrlFile) {
  const uf = path.resolve(ROOT, mcpKvUrlFile);
  if (existsSync(uf)) {
    const line = readFileSync(uf, "utf-8").trim().split(/\r?\n/)[0]?.trim();
    if (line) process.env.MCP_KV_HTTP_URL = line;
  }
}
const mcpKvBearerFile = process.env.MCP_KV_HTTP_BEARER_FILE?.trim();
if (mcpKvBearerFile) {
  const bf = path.resolve(ROOT, mcpKvBearerFile);
  if (existsSync(bf)) {
    const line = readFileSync(bf, "utf-8").trim().split(/\r?\n/)[0]?.trim();
    if (line) process.env.MCP_KV_HTTP_BEARER = line;
  }
}

/** Заголовки mcp-kv из локального Cursor ~/.cursor/mcp.json (если URL оттуда подставлен). */
let gTelegramCursorMcpKvHeaders: Record<string, string> | undefined;

function telegramCursorMcpJsonPath(): string {
  const custom = process.env.CURSOR_MCP_JSON_PATH?.trim();
  if (custom)
    return path.isAbsolute(custom) ? custom : path.resolve(ROOT, custom);
  return path.join(homedir(), ".cursor", "mcp.json");
}

function hydrateTelegramMcpKvFromCursorMcpJson(): void {
  const hasUrl =
    process.env.MCP_KV_HTTP_URL?.trim() || process.env.MCP_KV_URL?.trim();
  if (hasUrl) return;
  const jsonPath = telegramCursorMcpJsonPath();
  if (!existsSync(jsonPath)) return;
  try {
    const raw = JSON.parse(readFileSync(jsonPath, "utf-8")) as {
      mcpServers?: Record<
        string,
        { url?: string; headers?: Record<string, string> }
      >;
    };
    const s =
      raw.mcpServers?.["mcp-kv"] ??
      raw.mcpServers?.mcp_kv ??
      raw.mcpServers?.mcpkv;
    const u = s?.url?.trim();
    if (!u || !s) return;
    process.env.MCP_KV_HTTP_URL = u;
    if (s.headers && Object.keys(s.headers).length > 0)
      gTelegramCursorMcpKvHeaders = { ...s.headers };
    const masked = u.replace(/(user-)[A-Za-z0-9_-]+/i, "$1***");
    console.error(
      `[telegram-bot] mcp-kv endpoint из ${jsonPath} → ${masked} (${/\/sse\//i.test(u) ? "sse" : "http"})`,
    );
  } catch {
    /* noop */
  }
}

hydrateTelegramMcpKvFromCursorMcpJson();

function resolveWorkspaceRoot(): string {
  const w = process.env.WORKSPACE_ROOT?.trim();
  if (w) return path.resolve(w);
  if (existsSync("/workspace")) return path.resolve("/workspace");
  return path.resolve(process.cwd());
}

const WORKSPACE_ROOT = resolveWorkspaceRoot();

const SESSIONS_PATH = path.join(WORKSPACE_ROOT, ".telegram-agent-sessions.json");
const SCHEDULES_PATH = path.join(WORKSPACE_ROOT, ".telegram-schedules.json");

/** Маркер в lastTaskText: подставить актуальное ТЗ из очереди Wordstat. */
const WORDSTAT_QUEUE_SENTINEL = "__WP_WORDSTAT_QUEUE_V1__";

const TELEGRAM_HTML_MAX = 4096;

const DEFAULT_BOT_TIMEZONE = "Europe/Moscow";
const DEFAULT_CURSOR_MODEL = "composer-2";

/** Время старта процесса (uptime в /status). */
let botProcessStartedAt = Date.now();

/** Пульс фазы «работа» — редактирование одного сообщения раз в 45–60 с. */
const WORKING_PULSE_MS = 52_000;

interface SessionRecord {
  agentId: string;
  personaHash?: string;
}

type SessionsFile = Record<string, SessionRecord>;

const busyChats = new Set<string>();

class Mutex {
  private mutex: Promise<void> = Promise.resolve();
  runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.mutex;
    let unlock!: () => void;
    this.mutex = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    return prev.then(() => fn()).finally(() => {
      unlock();
    });
  }
}

const sessionMutex = new Mutex();
const scheduleMutex = new Mutex();

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Подписи reply-клавиатуры (отправляются текстом; обрабатываются до агента). */
const REPLY_KB = {
  MENU: "Меню",
  STATUS: "Статус бота",
  WHOAMI: "Мой chat_id",
  SESSIONS: "Сессия агента",
  QUEUE_STATUS: "Очередь Wordstat",
  QUEUE_NEXT: "Следующая тема",
  SCHEDULE_LIST: "Расписание",
  AUTOMATIONS: "Автоматизации",
} as const;

function isReplyKeyboardShortcut(text: string): boolean {
  const t = text.trim();
  return (Object.values(REPLY_KB) as string[]).includes(t);
}

function chunkForTelegram(htmlBody: string, max = TELEGRAM_HTML_MAX - 32): string[] {
  if (htmlBody.length <= max) return [htmlBody];
  const out: string[] = [];
  let i = 0;
  while (i < htmlBody.length) {
    let end = Math.min(i + max, htmlBody.length);
    if (end < htmlBody.length) {
      const slice = htmlBody.slice(i, end);
      const nl = slice.lastIndexOf("\n");
      if (nl > max * 0.55) end = i + nl + 1;
    }
    out.push(htmlBody.slice(i, end));
    i = end;
  }
  return out;
}

function renderProgressBar(pct: number): string {
  const n = Math.max(0, Math.min(100, Math.round(pct)));
  const segs = 10;
  const filled = Math.round((n / 100) * segs);
  const bar = "\u2588".repeat(filled) + "\u2591".repeat(segs - filled);
  return `[${bar}] ${n}%`;
}

/** Одно служебное сообщение на задачу: правки и удаление по завершении. */
class TaskStatusCard {
  private messageId: number | undefined;
  private workingPct = 48;

  constructor(
    private readonly api: Api,
    private readonly chatId: number,
  ) {}

  private formatHtml(headline: string, pct: number): string {
    const barLine = escapeHtml(renderProgressBar(pct));
    return `<b>${escapeHtml(headline)}</b>\n\n<code>${barLine}</code>`;
  }

  async open(headline: string, pct: number): Promise<void> {
    try {
      const msg = await this.api.sendMessage(this.chatId, this.formatHtml(headline, pct), {
        parse_mode: "HTML",
      });
      this.messageId = msg.message_id;
    } catch {
      this.messageId = undefined;
    }
  }

  async update(headline: string, pct: number): Promise<void> {
    if (this.messageId === undefined) return;
    try {
      await this.api.editMessageText(this.chatId, this.messageId, this.formatHtml(headline, pct), {
        parse_mode: "HTML",
      });
    } catch {
      /* мягко игнорируем лимиты Telegram / совпадение текста */
    }
  }

  /** Плавное увеличение прогресса в фазе «работа». */
  async pulseWorking(headline: string): Promise<void> {
    this.workingPct = Math.min(80, this.workingPct + 7);
    await this.update(headline, this.workingPct);
  }

  resetWorkingFloor(): void {
    this.workingPct = 48;
  }

  async showError(detailHtml: string): Promise<void> {
    const body = `<b>Ошибка выполнения.</b>\n\n${detailHtml}`;
    if (this.messageId === undefined) {
      try {
        await this.api.sendMessage(this.chatId, body, { parse_mode: "HTML" });
      } catch {
        /* noop */
      }
      return;
    }
    try {
      await this.api.editMessageText(this.chatId, this.messageId, body, {
        parse_mode: "HTML",
      });
    } catch {
      try {
        await this.api.sendMessage(this.chatId, body, { parse_mode: "HTML" });
      } catch {
        /* noop */
      }
    }
  }

  async remove(): Promise<void> {
    if (this.messageId === undefined) return;
    const mid = this.messageId;
    this.messageId = undefined;
    try {
      await this.api.deleteMessage(this.chatId, mid);
    } catch {
      /* noop */
    }
  }
}

function readSessions(): SessionsFile {
  try {
    if (!existsSync(SESSIONS_PATH)) return {};
    const raw = readFileSync(SESSIONS_PATH, "utf-8");
    const j = JSON.parse(raw) as SessionsFile;
    return j && typeof j === "object" ? j : {};
  } catch {
    return {};
  }
}

function writeSessions(data: SessionsFile): void {
  mkdirSync(path.dirname(SESSIONS_PATH), { recursive: true });
  const tmp = `${SESSIONS_PATH}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  renameSync(tmp, SESSIONS_PATH);
}

async function readSchedules(): Promise<SchedulesFile> {
  return scheduleMutex.runExclusive(async () => readSchedulesFile(SCHEDULES_PATH));
}

async function writeSchedules(data: SchedulesFile): Promise<void> {
  await scheduleMutex.runExclusive(async () => {
    writeSchedulesFile(SCHEDULES_PATH, data);
  });
}

function shortSha256(text: string): string {
  return createHash("sha256").update(text, "utf-8").digest("hex").slice(0, 16);
}

function loadPersonaRaw(): string {
  const inline = process.env.TELEGRAM_AGENT_PERSONALITY?.trim() ?? "";
  const fileRel = process.env.TELEGRAM_AGENT_PERSONALITY_FILE?.trim();
  let fromFile = "";
  if (fileRel) {
    const abs = path.isAbsolute(fileRel)
      ? fileRel
      : path.join(WORKSPACE_ROOT, fileRel);
    if (existsSync(abs)) fromFile = readFileSync(abs, "utf-8");
  }
  if (inline && fromFile) return `${inline}\n\n---\n\n${fromFile}`;
  return inline || fromFile;
}

function resolveContext7Entry(): string {
  const require = createRequire(import.meta.url);
  const pkgJson = require.resolve("@upstash/context7-mcp/package.json");
  return path.join(path.dirname(pkgJson), "dist", "index.js");
}

function buildOptionalMcpServers():
  | Record<string, McpServerConfig>
  | undefined {
  const servers: Record<string, McpServerConfig> = {};

  const key = process.env.CONTEXT7_API_KEY?.trim();
  if (key) {
    const script = resolveContext7Entry();
    servers.context7 = {
      type: "stdio",
      command: process.execPath,
      args: [script],
      cwd: WORKSPACE_ROOT,
      env: { CONTEXT7_API_KEY: key },
    };
  }

  const kvUrlRaw =
    process.env.MCP_KV_HTTP_URL?.trim() ||
    process.env.MCP_KV_URL?.trim() ||
    "";
  const trimmedKv = kvUrlRaw.replace(/\/$/, "");
  if (trimmedKv) {
    const envType = process.env.MCP_KV_HTTP_TYPE?.trim().toLowerCase();
    /** mcp-kv.ru: Streamable HTTP на том же URL; legacy SSE-транспорт SDK зависает на initialize/tools list. */
    const forceLegacySse =
      process.env.MCP_KV_LEGACY_SSE_TRANSPORT?.trim().toLowerCase() === "true";
    const transport: "http" | "sse" =
      /mcp-kv\.ru/i.test(trimmedKv) && !forceLegacySse
        ? "http"
        : envType === "sse"
          ? "sse"
          : envType === "http"
            ? "http"
            : /\/sse\//i.test(trimmedKv)
              ? "sse"
              : "http";
    const kvBearer =
      process.env.MCP_KV_HTTP_BEARER?.trim() ||
      process.env.MCP_KV_BEARER?.trim() ||
      process.env.MCP_KV_TOKEN?.trim();
    const headers: Record<string, string> = {
      ...(gTelegramCursorMcpKvHeaders ?? {}),
    };
    if (kvBearer) headers.Authorization = `Bearer ${kvBearer}`;
    servers.mcp_kv = {
      type: transport,
      url: trimmedKv,
      ...(Object.keys(headers).length ? { headers } : {}),
    };
  }

  return Object.keys(servers).length ? servers : undefined;
}

type AccessTier = "owner" | "bootstrap_open" | "outsider";

function maskChatId(chatId: number | undefined): string {
  if (chatId == null) return "неизвестно";
  const s = String(chatId);
  if (s.length <= 4) return "****";
  return `${"*".repeat(Math.max(0, s.length - 4))}${s.slice(-4)}`;
}

/** null = TELEGRAM_ALLOWED_CHAT_IDS не задан (bootstrap). */
function parseAllowlistIds(): Set<string> | null {
  const raw = process.env.TELEGRAM_ALLOWED_CHAT_IDS?.trim();
  if (!raw) return null;
  const ids = raw
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map(String);
  if (ids.length === 0) return null;
  return new Set(ids);
}

function accessTier(chatId: number | undefined): AccessTier {
  if (chatId == null) return "outsider";
  const ids = parseAllowlistIds();
  if (!ids) return "bootstrap_open";
  return ids.has(String(chatId)) ? "owner" : "outsider";
}

function tierLabelRu(tier: AccessTier): string {
  switch (tier) {
    case "owner":
      return "владелец";
    case "bootstrap_open":
      return "начальная настройка (нет TELEGRAM_ALLOWED_CHAT_IDS)";
    case "outsider":
      return "доступ запрещён (чат не в списке)";
    default:
      return tier;
  }
}

function allowModeLabelRu(allow: Set<string> | null): string {
  if (!allow) return "начальная настройка — список чатов не задан";
  return `ограничено списком (${allow.size} chat_id)`;
}

function whoamiReplyHtml(chatId: number | undefined): string {
  const id = chatId ?? "?";
  return (
    `<b>Ваш идентификатор чата</b>\n` +
    `<code>chat_id</code>: <code>${id}</code>\n\n` +
    `Вставьте это значение в переменную <code>TELEGRAM_ALLOWED_CHAT_IDS</code>:\n` +
    `• в <b>Cursor UI</b> → <b>Secrets</b> / <b>Environment</b> для репозитория или автоматизации,\n` +
    `• или в локальном файле <code>.env</code>.\n\n` +
    `Затем перезапустите процесс бота или задание Cursor Automations / Cloud.`
  );
}

const MSG_OUTSIDER =
  "Этот бот только для владельца: ваш чат не входит в список <code>TELEGRAM_ALLOWED_CHAT_IDS</code>.";

const MSG_BOOTSTRAP_DANGEROUS =
  "Пока не задан <code>TELEGRAM_ALLOWED_CHAT_IDS</code>, недоступны: запросы к агенту Cursor, расписания и действия, которые меняют очередь без режима предпросмотра.\n\n" +
  "<b>Что сделать</b>\n" +
  "1) Выполните /whoami или кнопку «Мой chat_id» — скопируйте число.\n" +
  "2) Вставьте его в <code>TELEGRAM_ALLOWED_CHAT_IDS</code> в <b>Cursor UI → Secrets / Environment</b> или в локальный <code>.env</code>.\n" +
  "3) Перезапустите бота или автоматизацию.\n\n" +
  "<code>TELEGRAM_BOT_TOKEN</code> нужен, чтобы бот вообще запускался и отвечал на <code>/whoami</code>. <code>CURSOR_API_KEY</code> — для сообщений агенту; задаётся там же или в <code>.env</code> локально.";

async function guardOutsider(ctx: Context): Promise<boolean> {
  if (accessTier(ctx.chat?.id) !== "outsider") return true;
  console.error(
    `[telegram-bot] access denied (outsider) chat_id=${maskChatId(ctx.chat?.id)}`,
  );
  await ctx.reply(MSG_OUTSIDER, { parse_mode: "HTML" });
  return false;
}

/** Агент, расписания, reset/new_agent, сессии и т.п. — только владелец (не bootstrap). /queue_next отдельно: peek через guardPeekQueue. */
async function guardDangerous(ctx: Context): Promise<boolean> {
  const tier = accessTier(ctx.chat?.id);
  if (tier === "outsider") {
    console.error(
      `[telegram-bot] dangerous denied (outsider) chat_id=${maskChatId(ctx.chat?.id)}`,
    );
    await ctx.reply(MSG_OUTSIDER, { parse_mode: "HTML" });
    return false;
  }
  if (tier === "bootstrap_open") {
    await ctx.reply(MSG_BOOTSTRAP_DANGEROUS, { parse_mode: "HTML" });
    return false;
  }
  return true;
}

/** Диагностика очереди в режиме peek — доступна до настройки allowlist (кроме посторонних chat_id). */
async function guardPeekQueue(ctx: Context): Promise<boolean> {
  return guardOutsider(ctx);
}

function buildAutonomyPrefix(): string {
  const autonomyRu = [
    "В начале работы составь краткий внутренний список подзадач (todo), обновляй его по ходу и веди задачу до конца без лишних уточнений.",
    "Если при выполнении что-то ломается — падают тесты или сборка, код недоделан или ошибочен, публикация/деплой/CI не проходит — сам диагностируй причину, правь код, конфигурацию и при необходимости документацию в рамках этого проекта (workspace), повторяй проверки (npm run build, тесты и другие релевантные команды из репозитория) и доводи всё до стабильно рабочего состояния.",
    "К человеку обращайся только при реальном блокере: нужны секреты или учётные данные, нет внешнего доступа или прав, требуется необратимое действие без явного подтверждения, исчерпаны платные лимиты или квоты, либо без этого продолжать небезопасно или невозможно.",
  ].join("\n");
  const utcIso = new Date().toISOString();
  let timeLine = `<time>${utcIso}</time> (UTC)`;
  const tz = process.env.BOT_TIMEZONE?.trim() || DEFAULT_BOT_TIMEZONE;
  try {
    const local = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      dateStyle: "medium",
      timeStyle: "long",
    }).format(new Date());
    timeLine += `\nLocal (${tz}): ${local}`;
  } catch {
    timeLine += `\n(некорректная часовая зона BOT_TIMEZONE — используется запасной вариант)`;
  }
  return `${autonomyRu}\n\n${timeLine}\n\n---\n\n`;
}

function appendScheduledPublishHint(): string {
  return [
    "## Запуск по расписанию (Telegram)",
    "Если задача про контент/публикацию: по умолчанию безопасный dry-run (`CONTENT_PUBLISH_MODE` / флаг `--publish` в content-factory). Реальную публикацию в прод включайте только при явной настройке окружения или прямой просьбе пользователя.",
    "",
  ].join("\n");
}

function appendMayaiStructureReferenceClarity(userMessage: string): string {
  if (!/mayai|майай|mayai\.ru/iu.test(userMessage)) return "";
  return [
    "## Уточнение: «референс mayai»",
    "- Ссылка на статью-образец — только **структура, стиль, ритм, блоки и ориентир длины**; **не** источник фактов и **не** источник картинок для тела статьи; текст не копировать.",
    "- **Обложка и баннер** — отдельный референс изображения **с лицом пользователя**; лицо и идентичность **не менять** (identity_lock=true); одежда, фон, композиция, промпты Nano — по blueprint RU SEO-GEO СТАТЬИ ДЛЯ БЛОГА 2026.",
    "",
  ].join("\n");
}

function appendWordpressArticlesHint(userMessage: string): string {
  const triggers =
    /вордпресс\s*стат|wordpress\s*articles|wordprais\.ru|wordprais|вордпрейс/u;
  if (!triggers.test(userMessage)) return "";
  return [
    "## Автоматизация «Вордпресс статьи» (целевой сайт wordprais.ru)",
    "- Полный пошаговый регламент без пропусков: **`prompts/wordpress-articles/MASTER_PROMPT.md`**; короткая шпаргалка (меньше токенов): **`prompts/wordpress-articles/MASTER_PROMPT_SHORT.md`**.",
    "- Разметка HTML (лид, врезки, таблица, баннер 21:9 в теле, FAQ, ресурсы): **`prompts/wordpress-articles/HTML_STRUCTURE_WORDPRAIS.md`**.",
    "- Конфиг цели и Allowlist ссылок: **`config/wordpress-articles.json`**; навык агента: **`wordpress-articles`**.",
    "- Изображения через MCP **mcp-kv.ru**: **`nano_banana_pro`** — обложка **16:9**, баннер **21:9**; затем **`wordpress_upload_media`** и постоянный URL на домене сайта (см. **`npm run wp:nano-images-republish`**, **`MCP_REQUEST_TIMEOUT_MS`**).",
    "",
  ].join("\n");
}

function appendContentFactoryHint(userMessage: string): string {
  const triggers =
    /ниш|ключ|стать|опублик|референс|seo|гео|geo|контент.?фабрик|indexnow|метла|wordpress|WP\b|блог/u;
  if (!triggers.test(userMessage)) return "";
  return [
    "## Content Factory (SEO / GEO / нейропоиск)",
    "Если это задача на статью, нишу, ключи, стиль референса, публикацию или антидубль — используй навык **director-content-factory** и стадии из `config/agent-orchestration.json`.",
    "Старт каркаса (по умолчанию dry-run): `npm run content:run -- --niche \"...\" --keywords \"...\"`. Публикация только с `--publish` или `CONTENT_PUBLISH_MODE=publish`. IndexNow: публичный verification key на домене — см. README (`INDEXNOW_KEY`, не API-token).",
    "Артефакты: `artifacts/content-runs/<runId>/` (`handoff.json`, `article.md`, `seo.json`, `duplicate-report.json`). WordPress: предпочти существующий `npm run workflow:cloud` / MCP из репозитория.",
    "Обязательные стадии: humanizer (`russian-humanizer-seo`), duplicate-guardian; supervisor QA до 3 итераций.",
    "",
  ].join("\n");
}

function extractAssistantTextFromStreamMessage(ev: SDKMessage): string {
  if (ev.type !== "assistant") return "";
  const parts: string[] = [];
  for (const block of ev.message.content) {
    if (block.type === "text" && block.text) parts.push(block.text);
  }
  return parts.join("");
}

function validateTelegramStartup(): void {
  const missing: string[] = [];
  if (!process.env.TELEGRAM_BOT_TOKEN?.trim())
    missing.push("TELEGRAM_BOT_TOKEN");
  if (missing.length === 0) return;
  console.error(
    `Не удалось запустить Telegram-бота: не заданы переменные окружения: ${missing.join(", ")}.`,
  );
  console.error(
    "В Cursor Cloud задайте их в Secrets / Environment для автоматизации; локально дополните файл .env в корне репозитория.",
  );
  process.exit(1);
}

function effectiveCursorModel(): string {
  return process.env.CURSOR_MODEL?.trim() || DEFAULT_CURSOR_MODEL;
}

async function getOrCreateAgent(
  chatId: string,
  apiKey: string,
  modelId: string,
  mcpServers: Record<string, McpServerConfig> | undefined,
  onAgentReady?: (kind: "resume" | "create") => void | Promise<void>,
): Promise<SDKAgent> {
  const base: Parameters<typeof Agent.create>[0] = {
    apiKey,
    model: { id: modelId },
    local: { cwd: WORKSPACE_ROOT },
    name: `telegram-chat-${chatId}`,
    ...(mcpServers ? { mcpServers } : {}),
  };

  const existing = await sessionMutex.runExclusive(
    async () => readSessions()[chatId]?.agentId,
  );
  if (existing) {
    try {
      const resumed = await Agent.resume(existing, base);
      await onAgentReady?.("resume");
      return resumed;
    } catch (e) {
      console.warn(
        `[telegram-bot] Agent.resume failed for chat ${chatId}, creating new:`,
        e,
      );
    }
  }

  const agent = await Agent.create(base);
  await onAgentReady?.("create");
  await sessionMutex.runExclusive(async () => {
    const s = readSessions();
    s[chatId] = { ...s[chatId], agentId: agent.agentId };
    writeSessions(s);
  });
  return agent;
}

function sanitizeErrorForUser(e: unknown): string {
  const rawName = e instanceof Error ? e.name : "Error";
  const name =
    rawName === "Error" ? "Ошибка" : escapeHtml(rawName);
  let msg = e instanceof Error ? e.message : String(e);
  msg = msg
    .replace(/crsr_[a-zA-Z0-9]+/gi, "[скрыто]")
    .replace(/\d{6,}:[A-Za-z0-9_-]{10,}/g, "[скрыто]");
  if (msg.length > 280) msg = `${msg.slice(0, 280)}…`;
  return `${name}: ${escapeHtml(msg)}`;
}

interface AgentTurnProgress {
  onAgentReady: (kind: "resume" | "create") => Promise<void>;
  onBeforeSend: () => Promise<void>;
  onPulseWorking: () => Promise<void>;
  onFirstStreamChunk: () => Promise<void>;
  onFinalizing: () => Promise<void>;
}

async function runAgentTurn(
  chatId: string,
  userPlainText: string,
  apiKey: string,
  modelId: string,
  mcpServers: Record<string, McpServerConfig> | undefined,
  progress: AgentTurnProgress,
  options?: { scheduled?: boolean },
): Promise<string> {
  const personaRaw = loadPersonaRaw();
  const currentPersonaHash = shortSha256(personaRaw);
  const hasPersonaBody = personaRaw.trim().length > 0;

  const rec = await sessionMutex.runExclusive(
    async () => readSessions()[chatId],
  );
  if (
    rec?.personaHash !== undefined &&
    rec.personaHash !== currentPersonaHash
  ) {
    console.warn(
      `[telegram-bot] Persona content changed (stored hash ${rec.personaHash} vs current ${currentPersonaHash}). User should run /reset for a clean agent if behavior is wrong.`,
    );
  }

  const injectPersona =
    hasPersonaBody && (rec?.personaHash ?? "") !== currentPersonaHash;
  const prefix = buildAutonomyPrefix();
  const personaBlock = injectPersona
    ? `# Persona (session sync)\n${personaRaw}\n\n---\n\n`
    : "";
  const schedHint = options?.scheduled ? appendScheduledPublishHint() : "";
  const payload = `${prefix}${schedHint}${appendContentFactoryHint(userPlainText)}${appendWordpressArticlesHint(userPlainText)}${appendMayaiStructureReferenceClarity(userPlainText)}${personaBlock}${userPlainText}`;

  const agent = await getOrCreateAgent(
    chatId,
    apiKey,
    modelId,
    mcpServers,
    async (kind) => {
      await progress.onAgentReady(kind);
    },
  );

  let streamed = "";
  let pulseGeneration = 0;
  try {
    await progress.onBeforeSend();

    const run = await agent.send(payload);

    let stopped = false;
    const pulseLoop = (async () => {
      const gen = ++pulseGeneration;
      while (!stopped) {
        await new Promise<void>((r) => setTimeout(r, WORKING_PULSE_MS));
        if (stopped || gen !== pulseGeneration) break;
        await progress.onPulseWorking();
      }
    })();

    let firstChunkNotified = false;
    try {
      for await (const ev of run.stream()) {
        const chunk = extractAssistantTextFromStreamMessage(ev);
        if (chunk && !firstChunkNotified) {
          firstChunkNotified = true;
          await progress.onFirstStreamChunk();
        }
        streamed += chunk;
      }
    } catch (streamErr) {
      stopped = true;
      await pulseLoop.catch(() => {});
      throw streamErr;
    }

    await progress.onFinalizing();

    let waited;
    try {
      waited = await run.wait();
    } finally {
      stopped = true;
      await pulseLoop.catch(() => {});
    }
    let textOut = streamed.trim();
    if (!textOut) textOut = (waited.result ?? "").trim();
    if (waited.status === "finished") {
      await sessionMutex.runExclusive(async () => {
        const s = readSessions();
        s[chatId] = {
          agentId: agent.agentId,
          personaHash: currentPersonaHash,
        };
        writeSessions(s);
      });
    } else if (waited.status === "error") {
      textOut = textOut || `Статус агента: ошибка\n${waited.result ?? ""}`;
    } else {
      textOut =
        textOut ||
        `Статус агента: ${waited.status}\n${waited.result ?? ""}`.trim();
    }
    return textOut;
  } finally {
    await agent[Symbol.asyncDispose]();
  }
}

async function replyHtmlChunksApi(api: Api, chatId: number, plain: string): Promise<void> {
  const body = escapeHtml(plain);
  const wrapped = `<pre>${body}</pre>`;
  for (const part of chunkForTelegram(wrapped)) {
    try {
      await api.sendMessage(chatId, part, { parse_mode: "HTML" });
    } catch {
      /* noop */
    }
  }
}

function startTypingLoopApi(api: Api, chatId: number): () => void {
  const id = setInterval(() => {
    void api.sendChatAction(chatId, "typing").catch(() => {});
  }, 4000);
  void api.sendChatAction(chatId, "typing").catch(() => {});
  return () => clearInterval(id);
}

const MSG_NO_CURSOR_API_KEY =
  "<b>Не задан</b> <code>CURSOR_API_KEY</code>. Добавьте ключ в Cursor → Secrets / Environment или в локальный <code>.env</code> и перезапустите бота. Диагностика (<code>/whoami</code>, очередь) работает только с токеном Telegram.";

async function executeAgentJob(params: {
  chatIdStr: string;
  chatIdNum: number;
  userPlainText: string;
  api: Api;
  apiKey: string;
  modelId: string;
  mcpServers: Record<string, McpServerConfig> | undefined;
  scheduled?: boolean;
}): Promise<void> {
  const {
    chatIdStr,
    chatIdNum,
    userPlainText,
    api,
    apiKey,
    modelId,
    mcpServers,
    scheduled,
  } = params;

  if (!apiKey.trim()) {
    if (scheduled) {
      console.error(
        "[telegram-bot] scheduled job skipped: CURSOR_API_KEY missing",
      );
      return;
    }
    try {
      await api.sendMessage(chatIdNum, MSG_NO_CURSOR_API_KEY, {
        parse_mode: "HTML",
      });
    } catch {
      /* noop */
    }
    return;
  }

  const card = new TaskStatusCard(api, chatIdNum);
  const stopTyping = startTypingLoopApi(api, chatIdNum);

  try {
    if (scheduled) {
      await card.open("Плановый запуск: принял в работу.", 5);
    } else {
      await card.open("Принял в работу. Запускаю сценарий…", 5);
    }

    const answer = await runAgentTurn(
      chatIdStr,
      userPlainText,
      apiKey,
      modelId,
      mcpServers,
      {
        onAgentReady: async (kind) => {
          card.resetWorkingFloor();
          if (kind === "resume") {
            await card.update("Продолжаю вашу прошлую сессию.", 15);
          } else {
            await card.update("Создаю новую сессию ассистента.", 15);
          }
        },
        onBeforeSend: async () => {
          await card.update("Передал запрос ассистенту.", 30);
        },
        onPulseWorking: async () => {
          await card.pulseWorking("Ассистент обрабатывает задачу…");
        },
        onFirstStreamChunk: async () => {
          await card.update("Получаю ответ…", 85);
        },
        onFinalizing: async () => {
          await card.update("Завершаю…", 95);
        },
      },
      { scheduled },
    );

    await card.update("Готово.", 100);
    await card.remove();
    await replyHtmlChunksApi(api, chatIdNum, answer);
  } catch (e) {
    await card.showError(sanitizeErrorForUser(e));
  } finally {
    stopTyping();
  }
}

function ownerReplyKeyboard(): Keyboard {
  return new Keyboard()
    .text(REPLY_KB.MENU)
    .text(REPLY_KB.STATUS)
    .row()
    .text(REPLY_KB.WHOAMI)
    .text(REPLY_KB.SESSIONS)
    .row()
    .text(REPLY_KB.QUEUE_STATUS)
    .text(REPLY_KB.QUEUE_NEXT)
    .row()
    .text(REPLY_KB.SCHEDULE_LIST)
    .text(REPLY_KB.AUTOMATIONS)
    .row()
    .resized()
    .persistent();
}

function menuRootInline(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Агенты в Cursor", "tgmenu:agents")
    .text("Автоматизации", "tgmenu:auto")
    .row()
    .text("Очередь Wordstat", "tgmenu:queue")
    .text("Расписания", "tgmenu:sched")
    .row()
    .text("Статус бота", "tgmenu:status")
    .text("Мой chat_id", "tgmenu:whoami");
}

function readWordstatQueueDiagnostics(): string {
  const configPath = path.join(
    WORKSPACE_ROOT,
    "config",
    "wordprais-wordstat-automation.json",
  );
  if (!existsSync(configPath))
    return "Конфиг не найден: config/wordprais-wordstat-automation.json";
  try {
    const conf = JSON.parse(readFileSync(configPath, "utf-8")) as {
      keywordQueue?: unknown[];
      seeds?: { queries?: unknown[] }[];
    };
    let q = 0;
    if (Array.isArray(conf.keywordQueue)) q = conf.keywordQueue.length;
    else if (Array.isArray(conf.seeds)) {
      for (const s of conf.seeds)
        q += Array.isArray(s?.queries) ? s.queries.length : 0;
    }
    let reserved = 0;
    let processed = 0;
    const statePath = path.join(
      WORKSPACE_ROOT,
      "artifacts",
      "simple-keyword-queue.json",
    );
    if (existsSync(statePath)) {
      const st = JSON.parse(readFileSync(statePath, "utf-8")) as {
        reservedPhrasesNorm?: unknown[];
        processedPhrasesNorm?: unknown[];
      };
      reserved = Array.isArray(st.reservedPhrasesNorm)
        ? st.reservedPhrasesNorm.length
        : 0;
      processed = Array.isArray(st.processedPhrasesNorm)
        ? st.processedPhrasesNorm.length
        : 0;
    }
    let lastMode = "—";
    const lastPath = path.join(
      WORKSPACE_ROOT,
      "artifacts",
      "wordstat-queue-last.json",
    );
    if (existsSync(lastPath)) {
      const last = JSON.parse(readFileSync(lastPath, "utf-8")) as {
        mode?: string;
      };
      lastMode = last.mode ?? "—";
    }
    return (
      `<b>Очередь Wordstat</b> (только просмотр)\n` +
      `• ключей в конфиге (оценка): ${q}\n` +
      `• зарезервировано в состоянии: ${reserved}\n` +
      `• обработано (processed): ${processed}\n` +
      `• последний режим в артефакте: <code>${escapeHtml(lastMode)}</code>`
    );
  } catch {
    return "Не удалось прочитать файлы очереди.";
  }
}

function runWordstatQueuePeek(): string {
  const script = path.join(
    WORKSPACE_ROOT,
    "scripts",
    "wp-wordstat-queue-next.mjs",
  );
  try {
    const r = spawnSync(process.execPath, [script, "--peek"], {
      cwd: WORKSPACE_ROOT,
      encoding: "utf-8",
      env: process.env,
      timeout: 120_000,
    });
    if (r.status !== 0) {
      return (
        `Скрипт очереди завершился с кодом ${r.status}. Проверьте локально: npm run wp:wordstat-queue-next`
      );
    }
    const raw = (r.stdout ?? "").trim();
    const j = JSON.parse(raw) as {
      mode?: string;
      phrase?: string;
      keywordId?: string;
      reason?: string;
      peek?: boolean;
      taskRu?: string;
    };
    const taskPreview =
      j.taskRu?.trim().slice(0, 600) ?? "";
    const lines = [
      `<b>Предпросмотр следующей темы</b> (очередь не меняется)`,
      `• режим: <code>${escapeHtml(j.mode ?? "?")}</code>`,
      `• запись состояния отключена: <code>${j.peek === true ? "да" : "нет"}</code>`,
    ];
    if (j.keywordId)
      lines.push(`• идентификатор ключа: <code>${escapeHtml(j.keywordId)}</code>`);
    if (j.phrase)
      lines.push(`• фраза: ${escapeHtml(j.phrase.slice(0, 240))}`);
    if (j.reason)
      lines.push(`• причина: <code>${escapeHtml(j.reason)}</code>`);
    if (taskPreview)
      lines.push(
        "",
        "<b>Текст задания</b> (усечено):",
        `<pre>${escapeHtml(taskPreview)}${taskPreview.length >= 600 ? "…" : ""}</pre>`,
      );
    return lines.join("\n");
  } catch {
    return "Не удалось выполнить предпросмотр очереди.";
  }
}

function listAutomationTemplatesHtml(): string {
  const dir = path.join(ROOT, ".cursor", "automations");
  if (!existsSync(dir)) return "Папка .cursor/automations не найдена.";
  const names = readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  if (!names.length) return "Файлов .md нет.";
  const lines = names.map((n) => `• <code>${escapeHtml(n)}</code>`);
  return (
    `<b>Шаблоны автоматизаций Cursor</b>\n` +
    `Откройте <a href="https://cursor.com/automations">раздел Automations</a> и перенесите текст из файлов:\n` +
    `${lines.join("\n")}\n\n` +
    `Оглавление: <code>.cursor/automations/README.md</code>`
  );
}

async function buildStatusHtml(ctx: Context): Promise<string> {
  const tier = accessTier(ctx.chat?.id);
  const sessions = readSessions();
  const sessionKeys = Object.keys(sessions);
  const sched = await readSchedules();
  const schedKeys = Object.keys(sched);
  const uptimeSec = Math.floor((Date.now() - botProcessStartedAt) / 1000);
  const allow = parseAllowlistIds();
  const allowMode = allowModeLabelRu(allow);
  const cid = ctx.chat?.id != null ? String(ctx.chat.id) : "";
  const mine = cid ? sessions[cid] : undefined;
  const mineAgent = mine?.agentId
    ? `${mine.agentId.slice(0, 6)}…${mine.agentId.slice(-4)}`
    : "нет";
  const persona = mine?.personaHash
    ? `${mine.personaHash.slice(0, 8)}…`
    : "—";
  return [
    "<b>Статус бота</b>",
    `• каталог workspace (<code>WORKSPACE_ROOT</code>): <code>${escapeHtml(WORKSPACE_ROOT)}</code>`,
    `• модель (<code>CURSOR_MODEL</code>): <code>${escapeHtml(effectiveCursorModel())}</code>`,
    `• доступ: <code>${escapeHtml(allowMode)}</code>; ваш уровень: <code>${escapeHtml(tierLabelRu(tier))}</code>`,
    `• записей сессий в файле: ${sessionKeys.length}; расписаний: ${schedKeys.length}`,
    `• ваш агент (маска <code>agentId</code>): <code>${escapeHtml(mineAgent)}</code>; хеш персоны: <code>${escapeHtml(persona)}</code>`,
    `• время с запуска процесса: ${uptimeSec} с`,
  ].join("\n");
}

function resolveWordstatQueueTask(): string {
  const script = path.join(WORKSPACE_ROOT, "scripts", "wp-wordstat-queue-next.mjs");
  try {
    const r = spawnSync(process.execPath, [script], {
      cwd: WORKSPACE_ROOT,
      encoding: "utf-8",
      env: process.env,
      timeout: 120_000,
    });
    if (r.status !== 0) {
      console.error("[telegram-bot] wordstat queue exit", r.status, r.stderr?.slice(0, 500));
      return (
        `Не удалось получить тему из очереди Wordstat (скрипт завершился с кодом ${r.status}). Выполните в каталоге проекта: npm run wp:wordstat-queue-next и передайте поле taskRu ассистенту.\n\n` +
        `Нужна автоматизация «Вордпресс статьи» для wordprais.ru по MASTER_PROMPT.`
      );
    }
    const raw = (r.stdout ?? "").trim();
    const j = JSON.parse(raw) as { taskRu?: string };
    if (!j.taskRu?.trim()) throw new Error("empty taskRu");
    return j.taskRu.trim();
  } catch (e) {
    console.error("[telegram-bot] resolveWordstatQueueTask", e);
    return (
      `Ошибка очереди Wordstat. Запустите: npm run wp:wordstat-queue-next и передайте значение taskRu ассистенту.\n\n` +
      `Дальше — полный цикл «Вордпресс статьи» (nano-изображения, публикация WordPress).`
    );
  }
}

function scheduleSummaryLine(s: ChatScheduleRecord): string {
  if (!s.enabled) return "Расписание выключено.";
  const when = new Date(s.nextRunAt).toLocaleString("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
  });
  const queueHint = s.wordstatQueue
    ? "Режим очереди Wordstat («Вордпресс статьи»): перед каждым запуском тема берётся из config/wordprais-wordstat-automation.json."
    : "";
  const tmpl = s.lastTaskText?.trim()
    ? s.wordstatQueue && s.lastTaskText.trim() === WORDSTAT_QUEUE_SENTINEL
      ? "Шаблон: автоматическая очередь ключей Wordstat."
      : "Шаблон задачи сохранён."
    : "Шаблон задачи ещё не задан — отправьте текст с ключами или нишей.";
  const q = queueHint ? `\n${queueHint}` : "";
  return `Интервал: каждые ${formatIntervalRu(s.intervalMs)}. Следующий запуск: ${when}. ${tmpl}${q}`;
}

async function main(): Promise<void> {
  botProcessStartedAt = Date.now();
  validateTelegramStartup();
  const token = process.env.TELEGRAM_BOT_TOKEN!.trim();
  const apiKey = process.env.CURSOR_API_KEY?.trim() ?? "";
  const modelId = effectiveCursorModel();
  const mcpServers = buildOptionalMcpServers();

  const bot = new Bot(token);

  bot.catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[telegram-bot]", msg);
  });

  const html = { parse_mode: "HTML" as const };

  bot.command("whoami", async (ctx) => {
    if (!(await guardOutsider(ctx))) return;
    await ctx.reply(whoamiReplyHtml(ctx.chat?.id), html);
  });

  bot.command("start", async (ctx) => {
    if (!(await guardOutsider(ctx))) return;
    const tier = accessTier(ctx.chat?.id);
    const tail =
      tier === "bootstrap_open"
        ? "\n\n⚠ Сейчас режим <b>начальной настройки</b>: задайте <code>TELEGRAM_ALLOWED_CHAT_IDS</code> (команда /whoami или кнопка «Мой chat_id»). До этого агент Cursor и расписания недоступны."
        : "";
    await ctx.reply(
      `<b>Добро пожаловать.</b> Обычное сообщение <i>без слэша</i> передаётся в локальный Cursor Agent (SDK).${tail}\n\n` +
        `Разделы: /menu · Справка: /help · Состояние: /status`,
      { ...html, reply_markup: ownerReplyKeyboard() },
    );
  });

  bot.command("menu", async (ctx) => {
    if (!(await guardOutsider(ctx))) return;
    await ctx.reply("Выберите раздел меню:", {
      ...html,
      reply_markup: menuRootInline(),
    });
  });

  bot.command("help", async (ctx) => {
    if (!(await guardOutsider(ctx))) return;
    await ctx.reply(
      `<b>Справка</b>\n` +
        `Сообщение <i>без</i> команды <code>/…</code> уходит агенту в каталог <code>WORKSPACE_ROOT</code> (доступно только после настройки <code>TELEGRAM_ALLOWED_CHAT_IDS</code>).\n\n` +
        `<b>Основные команды</b>\n` +
        `• /menu — меню с кнопками · /status — статус · /whoami — ваш chat_id\n` +
        `• /sessions или /agents — сведения о сессии · /new_agent · /reset\n` +
        `• /automations — шаблоны автоматизаций Cursor\n` +
        `• /queue_status — сводка очереди · /queue_next — предпросмотр темы без изменения файлов\n` +
        `• /schedule_list · /schedule · /schedule_every · /schedule_queue_every · /schedule_stop\n\n` +
        `<b>Безопасность</b>\n` +
        `Если <code>TELEGRAM_ALLOWED_CHAT_IDS</code> пуст, агент и расписания отключены для всех; доступны /whoami, меню и диагностика очереди.`,
      html,
    );
  });

  bot.command("status", async (ctx) => {
    if (!(await guardOutsider(ctx))) return;
    await ctx.reply(await buildStatusHtml(ctx), html);
  });

  bot.command("automations", async (ctx) => {
    if (!(await guardOutsider(ctx))) return;
    await ctx.reply(listAutomationTemplatesHtml(), html);
  });

  bot.command("queue_status", async (ctx) => {
    if (!(await guardPeekQueue(ctx))) return;
    await ctx.reply(readWordstatQueueDiagnostics(), html);
  });

  bot.command("queue_next", async (ctx) => {
    if (!(await guardPeekQueue(ctx))) return;
    await ctx.reply(runWordstatQueuePeek(), html);
  });

  bot.command(["sessions", "agents"], async (ctx) => {
    if (!(await guardDangerous(ctx))) return;
    const id = String(ctx.chat!.id);
    const rec = readSessions()[id];
    if (!rec?.agentId) {
      await ctx.reply(
        "Для этого чата нет сохранённой сессии агента. Отправьте задачу обычным текстом или выполните /new_agent.",
        html,
      );
      return;
    }
    const pid = rec.personaHash ? `${rec.personaHash.slice(0, 8)}…` : "—";
    const aid = `${rec.agentId.slice(0, 6)}…${rec.agentId.slice(-4)}`;
    await ctx.reply(
      `<b>Сессия агента</b>\n• идентификатор (маска): <code>${escapeHtml(aid)}</code>\n• хеш персоны: <code>${escapeHtml(pid)}</code>`,
      html,
    );
  });

  bot.command("new_agent", async (ctx) => {
    if (!(await guardDangerous(ctx))) return;
    const id = String(ctx.chat?.id ?? "");
    await sessionMutex.runExclusive(async () => {
      const s = readSessions();
      delete s[id];
      writeSessions(s);
    });
    await ctx.reply(
      "Сессия сброшена. Следующее текстовое сообщение создаст новый идентификатор агента в Cursor SDK.",
      html,
    );
  });

  bot.command("reset", async (ctx) => {
    if (!(await guardDangerous(ctx))) return;
    const id = String(ctx.chat?.id ?? "");
    await sessionMutex.runExclusive(async () => {
      const s = readSessions();
      delete s[id];
      writeSessions(s);
    });
    await ctx.reply(
      "Готово. Следующее сообщение начнёт новую беседу с ассистентом.",
      html,
    );
  });

  bot.command("schedule_list", async (ctx) => {
    if (!(await guardDangerous(ctx))) return;
    const id = String(ctx.chat!.id);
    const all = await readSchedules();
    const s = all[id];
    if (!s) {
      await ctx.reply(
        "<b>Расписание</b> не настроено.\nПримеры: /schedule_every 3h · /schedule_queue_every 3h",
        html,
      );
      return;
    }
    await ctx.reply(`<b>Расписание</b>\n${escapeHtml(scheduleSummaryLine(s))}`, html);
  });

  bot.command("schedule", async (ctx) => {
    if (!(await guardDangerous(ctx))) return;
    const id = String(ctx.chat!.id);
    const all = await readSchedules();
    const s = all[id];
    if (!s) {
      await ctx.reply(
        "Расписание пока не настроено.\n\nПримеры:\n• /schedule_every 3h\n• /schedule_queue_every 3h\n• или в сообщении с задачей: «…публикация раз в 3 часа»",
      );
      return;
    }
    await ctx.reply(scheduleSummaryLine(s));
  });

  bot.command(["schedule_off", "schedule_stop"], async (ctx) => {
    if (!(await guardDangerous(ctx))) return;
    const id = String(ctx.chat!.id);
    const all = await readSchedules();
    const s = all[id];
    if (!s) {
      await ctx.reply(
        "Расписание не было включено или ещё не создавалось.",
      );
      return;
    }
    s.enabled = false;
    all[id] = s;
    await writeSchedules(all);
    await ctx.reply(
      "Автозапуски отключены. Шаблон сохранён — снова включите через /schedule_every или /schedule_queue_every.",
    );
  });

  bot.command("schedule_queue_every", async (ctx) => {
    if (!(await guardDangerous(ctx))) return;
    const text = ctx.message?.text?.trim() ?? "";
    const parts = text.split(/\s+/).slice(1);
    const arg = parts.join(" ").trim();
    if (!arg) {
      await ctx.reply(
        "Укажите интервал: /schedule_queue_every 3h — каждые 3 часа новая тема из очереди Wordstat.",
      );
      return;
    }
    const msRaw = parseScheduleEveryArg(arg);
    if (msRaw === null) {
      await ctx.reply("Не разобрал интервал. Примеры: 30m, 3h, 1d.");
      return;
    }
    const intervalMs = clampIntervalMs(msRaw);
    const id = String(ctx.chat!.id);
    const all = await readSchedules();
    const prev = all[id];
    const now = Date.now();
    const nextRunAt = now + intervalMs;
    all[id] = {
      enabled: true,
      intervalMs,
      nextRunAt,
      lastRunAt: prev?.lastRunAt,
      lastTaskText: WORDSTAT_QUEUE_SENTINEL,
      wordstatQueue: true,
    };
    await writeSchedules(all);
    await ctx.reply(
      `Очередь Wordstat: каждые ${formatIntervalRu(intervalMs)}. Следующий запуск около ${new Date(nextRunAt).toLocaleString("ru-RU")}.`,
    );
  });

  bot.command("schedule_every", async (ctx) => {
    if (!(await guardDangerous(ctx))) return;
    const text = ctx.message?.text?.trim() ?? "";
    const parts = text.split(/\s+/).slice(1);
    const arg = parts.join(" ").trim();
    if (!arg) {
      await ctx.reply(
        "Укажите интервал: /schedule_every 3h или 30m или 1d (от 15 мин до 7 дней).",
      );
      return;
    }
    const msRaw = parseScheduleEveryArg(arg);
    if (msRaw === null) {
      await ctx.reply("Не разобрал интервал. Примеры: 30m, 90мин, 3h, 1d.");
      return;
    }
    const intervalMs = clampIntervalMs(msRaw);
    if (intervalMs !== msRaw) {
      await ctx.reply(
        `Интервал ограничен ${formatIntervalRu(SCHEDULE_MIN_MS)} … ${formatIntervalRu(SCHEDULE_MAX_MS)}. Применяю ${formatIntervalRu(intervalMs)}.`,
      );
    }
    const id = String(ctx.chat!.id);
    const all = await readSchedules();
    const prev = all[id];
    const now = Date.now();
    const nextRunAt = now + intervalMs;
    all[id] = {
      enabled: true,
      intervalMs,
      nextRunAt,
      lastRunAt: prev?.lastRunAt,
      lastTaskText: prev?.lastTaskText,
      wordstatQueue: false,
    };
    await writeSchedules(all);
    await ctx.reply(
      `Повтор каждые ${formatIntervalRu(intervalMs)}. Следующий запуск около ${new Date(nextRunAt).toLocaleString("ru-RU")}.\nЕсли шаблон не задан — отправьте задачу обычным текстом.`,
    );
  });

  bot
    .on("message:text")
    .filter((ctx) => isReplyKeyboardShortcut(ctx.message.text))
    .use(async (ctx) => {
      const t = ctx.message.text.trim();
      if (t === REPLY_KB.MENU) {
        if (!(await guardOutsider(ctx))) return;
        await ctx.reply("Выберите раздел меню:", {
          ...html,
          reply_markup: menuRootInline(),
        });
        return;
      }
      if (t === REPLY_KB.STATUS) {
        if (!(await guardOutsider(ctx))) return;
        await ctx.reply(await buildStatusHtml(ctx), html);
        return;
      }
      if (t === REPLY_KB.WHOAMI) {
        if (!(await guardOutsider(ctx))) return;
        await ctx.reply(whoamiReplyHtml(ctx.chat?.id), html);
        return;
      }
      if (t === REPLY_KB.SESSIONS) {
        if (!(await guardDangerous(ctx))) return;
        const id = String(ctx.chat!.id);
        const rec = readSessions()[id];
        if (!rec?.agentId) {
          await ctx.reply(
            "Для этого чата нет сохранённой сессии агента. Отправьте задачу обычным текстом или выполните /new_agent.",
            html,
          );
          return;
        }
        const pid = rec.personaHash ? `${rec.personaHash.slice(0, 8)}…` : "—";
        const aid = `${rec.agentId.slice(0, 6)}…${rec.agentId.slice(-4)}`;
        await ctx.reply(
          `<b>Сессия агента</b>\n• идентификатор (маска): <code>${escapeHtml(aid)}</code>\n• хеш персоны: <code>${escapeHtml(pid)}</code>`,
          html,
        );
        return;
      }
      if (t === REPLY_KB.QUEUE_STATUS) {
        if (!(await guardPeekQueue(ctx))) return;
        await ctx.reply(readWordstatQueueDiagnostics(), html);
        return;
      }
      if (t === REPLY_KB.QUEUE_NEXT) {
        if (!(await guardPeekQueue(ctx))) return;
        await ctx.reply(runWordstatQueuePeek(), html);
        return;
      }
      if (t === REPLY_KB.SCHEDULE_LIST) {
        if (!(await guardDangerous(ctx))) return;
        const id = String(ctx.chat!.id);
        const all = await readSchedules();
        const s = all[id];
        if (!s) {
          await ctx.reply(
            "<b>Расписание</b> не настроено.\nПримеры: /schedule_every 3h · /schedule_queue_every 3h",
            html,
          );
          return;
        }
        await ctx.reply(
          `<b>Расписание</b>\n${escapeHtml(scheduleSummaryLine(s))}`,
          html,
        );
        return;
      }
      if (t === REPLY_KB.AUTOMATIONS) {
        if (!(await guardOutsider(ctx))) return;
        await ctx.reply(listAutomationTemplatesHtml(), html);
      }
    });

  bot.callbackQuery(/^tgmenu:(\w+)$/, async (ctx) => {
    if (!(await guardOutsider(ctx))) return;
    await ctx.answerCallbackQuery();
    const section = ctx.match![1];
    let body = "";
    switch (section) {
      case "agents":
        body =
          "<b>Агенты Cursor</b>\n• /sessions — маска идентификатора сессии\n• /new_agent или /reset — новая сессия\n• Обычный текст (не команда) → агент (только для владельца после настройки списка чатов).\n";
        break;
      case "auto":
        body = listAutomationTemplatesHtml();
        break;
      case "queue":
        body =
          "<b>Очередь Wordstat</b>\n• /queue_status — сводка без изменений\n• /queue_next — предпросмотр (--peek), файлы очереди не меняются\n";
        break;
      case "sched":
        body =
          "<b>Расписания</b>\n• /schedule_list · /schedule\n• /schedule_every · /schedule_queue_every\n• /schedule_stop\n";
        break;
      case "status":
        body = await buildStatusHtml(ctx);
        break;
      case "whoami": {
        body = whoamiReplyHtml(ctx.chat?.id);
        break;
      }
      default:
        body = "Раздел не найден.";
    }
    try {
      await ctx.editMessageText(body, {
        parse_mode: "HTML",
        reply_markup: menuRootInline(),
      });
    } catch {
      await ctx.reply(body, {
        parse_mode: "HTML",
      });
    }
  });

  bot
    .on("message:text")
    .filter(
      (ctx) =>
        !ctx.message.text.trimStart().startsWith("/") &&
        !isReplyKeyboardShortcut(ctx.message.text),
    )
    .use(async (ctx) => {
      if (!(await guardDangerous(ctx))) return;
      const chatIdNum = ctx.chat?.id;
      const chatIdStr = String(chatIdNum);
      const fullText = ctx.message.text;

      const natural = matchNaturalSchedule(fullText);
      let taskText = fullText.trim();
      let scheduleMs: number | undefined;

      if (natural) {
        scheduleMs = natural.intervalMs;
        taskText = stripMatchedSchedule(fullText, natural.matchedRaw);
      }

      if (scheduleMs !== undefined) {
        const all = await readSchedules();
        const prev = all[chatIdStr];
        if (taskText.length < 8) {
          const template = prev?.lastTaskText?.trim();
          if (template) {
            all[chatIdStr] = {
              enabled: true,
              intervalMs: scheduleMs,
              nextRunAt: Date.now() + scheduleMs,
              lastRunAt: prev?.lastRunAt,
              lastTaskText: template,
              wordstatQueue:
                prev?.wordstatQueue === true &&
                template === WORDSTAT_QUEUE_SENTINEL,
            };
            await writeSchedules(all);
            await ctx.reply(
              `Расписание: каждые ${formatIntervalRu(scheduleMs)}. Буду использовать сохранённый шаблон задачи.`,
            );
            return;
          }
          await ctx.reply(
            "Нужен текст задачи в этом же сообщении (ключи, ниша) или сначала отправьте полноценную задачу как шаблон.",
          );
          return;
        }
        all[chatIdStr] = {
          enabled: true,
          intervalMs: scheduleMs,
          nextRunAt: Date.now() + scheduleMs,
          lastRunAt: prev?.lastRunAt,
          lastTaskText: taskText,
          wordstatQueue: false,
        };
        await writeSchedules(all);
      }

      if (busyChats.has(chatIdStr)) {
        await ctx.reply(
          "Задача уже выполняется. Дождитесь результата или отправьте /reset.",
        );
        return;
      }

      if (taskText.length < 3) {
        await ctx.reply("Сообщение слишком короткое — опишите задачу подробнее.");
        return;
      }

      busyChats.add(chatIdStr);
      try {
        await executeAgentJob({
          chatIdStr,
          chatIdNum: chatIdNum!,
          userPlainText: taskText,
          api: ctx.api,
          apiKey,
          modelId,
          mcpServers,
        });
      } finally {
        busyChats.delete(chatIdStr);
      }
    });

  setInterval(() => {
    void (async () => {
      const all = await readSchedules();
      const now = Date.now();
      let changed = false;
      for (const [chatIdStr, sch] of Object.entries(all)) {
        if (!sch.enabled || sch.nextRunAt > now) continue;
        if (!sch.lastTaskText?.trim()) {
          sch.nextRunAt = now + sch.intervalMs;
          all[chatIdStr] = sch;
          changed = true;
          continue;
        }
        if (busyChats.has(chatIdStr)) {
          sch.nextRunAt = now + Math.min(120_000, sch.intervalMs);
          all[chatIdStr] = sch;
          changed = true;
          continue;
        }
        busyChats.add(chatIdStr);
        try {
          const chatIdNum = Number(chatIdStr);
          if (!Number.isFinite(chatIdNum)) {
            sch.nextRunAt = now + sch.intervalMs;
            all[chatIdStr] = sch;
            changed = true;
            busyChats.delete(chatIdStr);
            continue;
          }
          const tier = accessTier(chatIdNum);
          if (tier === "bootstrap_open") {
            sch.nextRunAt = now + sch.intervalMs;
            all[chatIdStr] = sch;
            changed = true;
            busyChats.delete(chatIdStr);
            continue;
          }
          if (tier === "outsider") {
            sch.enabled = false;
            all[chatIdStr] = sch;
            changed = true;
            busyChats.delete(chatIdStr);
            console.error(
              `[telegram-bot] schedule disabled outsider chat_id=${maskChatId(chatIdNum)}`,
            );
            continue;
          }
          let userPlainText = sch.lastTaskText!.trim();
          if (sch.wordstatQueue === true && userPlainText === WORDSTAT_QUEUE_SENTINEL) {
            userPlainText = resolveWordstatQueueTask();
          }
          await executeAgentJob({
            chatIdStr,
            chatIdNum,
            userPlainText,
            api: bot.api,
            apiKey,
            modelId,
            mcpServers,
            scheduled: true,
          });
          sch.lastRunAt = now;
          sch.nextRunAt = now + sch.intervalMs;
          all[chatIdStr] = sch;
          changed = true;
        } catch (e) {
          console.error("[telegram-bot] scheduled job error", e instanceof Error ? e.message : e);
          sch.nextRunAt = now + sch.intervalMs;
          all[chatIdStr] = sch;
          changed = true;
        } finally {
          busyChats.delete(chatIdStr);
        }
      }
      if (changed) await writeSchedules(all);
    })();
  }, 60_000);

  try {
    await bot.api.setMyCommands([
      { command: "start", description: "Приветствие и клавиатура" },
      { command: "menu", description: "Меню разделов (inline)" },
      { command: "help", description: "Справка по командам" },
      { command: "status", description: "Состояние бота и доступа" },
      { command: "whoami", description: "Ваш chat_id для whitelist" },
      { command: "sessions", description: "Сведения о сессии агента" },
      { command: "new_agent", description: "Новая сессия Cursor SDK" },
      { command: "reset", description: "Сбросить сессию в этом чате" },
      { command: "automations", description: "Шаблоны Cursor Automations" },
      { command: "queue_status", description: "Диагностика очереди Wordstat" },
      {
        command: "queue_next",
        description: "Предпросмотр темы без записи в очередь",
      },
      { command: "schedule_list", description: "Подробно о расписании" },
      { command: "schedule", description: "Кратко о расписании" },
      {
        command: "schedule_every",
        description: "Интервал и сохранённый шаблон задачи",
      },
      {
        command: "schedule_queue_every",
        description: "Интервал и тема из очереди Wordstat",
      },
      { command: "schedule_stop", description: "Выключить автозапуски" },
    ]);
  } catch {
    /* игнорируем если API недоступен до старта */
  }

  console.error(
    `[telegram-bot] WORKSPACE_ROOT=${WORKSPACE_ROOT} sessions=${SESSIONS_PATH}`,
  );
  await bot.start();
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(msg);
  process.exit(1);
});
