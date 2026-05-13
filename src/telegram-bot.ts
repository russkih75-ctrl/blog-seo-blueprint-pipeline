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
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { Bot, type Api, type Context } from "grammy";
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

const WORKSPACE_ROOT = path.resolve(
  process.env.WORKSPACE_ROOT?.trim() || ROOT,
);

const SESSIONS_PATH = path.join(WORKSPACE_ROOT, ".telegram-agent-sessions.json");
const SCHEDULES_PATH = path.join(WORKSPACE_ROOT, ".telegram-schedules.json");

const TELEGRAM_HTML_MAX = 4096;

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
    const body = `<b>Сбой выполнения.</b>\n\n${detailHtml}`;
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

function parseAllowedChats(): Set<string> | null {
  const raw = process.env.TELEGRAM_ALLOWED_CHAT_IDS?.trim();
  if (!raw) return null;
  const ids = raw
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  return new Set(ids.map(String));
}

function buildAutonomyPrefix(): string {
  const autonomyRu = [
    "В начале работы составь краткий внутренний список подзадач (todo), обновляй его по ходу и веди задачу до конца без лишних уточнений.",
    "Если при выполнении что-то ломается — падают тесты или сборка, код недоделан или ошибочен, публикация/деплой/CI не проходит — сам диагностируй причину, правь код, конфигурацию и при необходимости документацию в рамках этого проекта (workspace), повторяй проверки (npm run build, тесты и другие релевантные команды из репозитория) и доводи всё до стабильно рабочего состояния.",
    "К человеку обращайся только при реальном блокере: нужны секреты или учётные данные, нет внешнего доступа или прав, требуется необратимое действие без явного подтверждения, исчерпаны платные лимиты или квоты, либо без этого продолжать небезопасно или невозможно.",
  ].join("\n");
  const utcIso = new Date().toISOString();
  let timeLine = `<time>${utcIso}</time> (UTC)`;
  const tz = process.env.BOT_TIMEZONE?.trim();
  if (tz) {
    try {
      const local = new Intl.DateTimeFormat("en-GB", {
        timeZone: tz,
        dateStyle: "medium",
        timeStyle: "long",
      }).format(new Date());
      timeLine += `\nLocal (${tz}): ${local}`;
    } catch {
      timeLine += `\n(BOT_TIMEZONE invalid: ${tz})`;
    }
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

function ensureEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
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
  const name = escapeHtml(e instanceof Error ? e.name : "Error");
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
  const payload = `${prefix}${schedHint}${appendContentFactoryHint(userPlainText)}${appendMayaiStructureReferenceClarity(userPlainText)}${personaBlock}${userPlainText}`;

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
      textOut = textOut || `Agent status: error\n${waited.result ?? ""}`;
    } else {
      textOut =
        textOut ||
        `Agent status: ${waited.status}\n${waited.result ?? ""}`.trim();
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

const allowed = parseAllowedChats();

function isAllowedChat(chatId: number | undefined): boolean {
  if (chatId == null) return false;
  if (!allowed) return true;
  return allowed.has(String(chatId));
}

function scheduleSummaryLine(s: ChatScheduleRecord): string {
  if (!s.enabled) return "Расписание выключено.";
  const when = new Date(s.nextRunAt).toLocaleString("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
  });
  const tmpl = s.lastTaskText?.trim()
    ? "Шаблон задачи сохранён."
    : "Шаблон задачи ещё не задан — отправьте текст с ключами или нишей.";
  return `Интервал: каждые ${formatIntervalRu(s.intervalMs)}. Следующий запуск: ${when}. ${tmpl}`;
}

async function main(): Promise<void> {
  const token = ensureEnv("TELEGRAM_BOT_TOKEN");
  const apiKey = ensureEnv("CURSOR_API_KEY");
  const modelId = ensureEnv("CURSOR_MODEL");
  const mcpServers = buildOptionalMcpServers();

  const bot = new Bot(token);

  bot.catch((err) => {
    console.error("[telegram-bot]", err);
  });

  bot.command("start", async (ctx) => {
    if (!isAllowedChat(ctx.chat?.id)) {
      await ctx.reply("Здесь бот недоступен.");
      return;
    }
    await ctx.reply(
      "Я помогу с задачами в вашем проекте через ассистента Cursor. Просто опишите, что нужно: ключи, нишу, ссылки на референсы. Команды: /help, /reset, /schedule.",
    );
  });

  bot.command("help", async (ctx) => {
    if (!isAllowedChat(ctx.chat?.id)) {
      await ctx.reply("Здесь бот недоступен.");
      return;
    }
    const help =
      "Я работаю как спокойный помощник: вы пишете задачу обычным языком, я передаю её ассистенту в вашей рабочей папке.\n\n" +
      "Что можно спросить\n" +
      "• Тема или ниша статьи, ключевые слова, что важно осветить.\n" +
      "• Референс по структуре текста (например стиль сайта) и отдельно фото для обложки — если нужно.\n" +
      "• Публикация в блог — по умолчанию безопасный пробный режим; выход в прод только когда на сервере настроены переменные для публикации (см. README проекта).\n\n" +
      "Расписание\n" +
      "• /schedule — что включено и когда следующий запуск.\n" +
      "• /schedule_every 3h или 30m или 1d — повторять задачу с таким шагом.\n" +
      "• Можно в одном сообщении совместить задачу и фразу вроде «публикация раз в 3 часа».\n" +
      "• /schedule_off — отключить автозапуски в этом чате.\n\n" +
      "Сессия\n" +
      "/reset — начать с чистого листа с ассистентом в этом чате.\n\n" +
      "Настройки на сервере (делает тот, кто запускает бота)\n" +
      "Ключи Cursor и Telegram, модель, при необходимости сервисы из README — всё задаётся в конфиге окружения, не в переписке.\n\n" +
      "Пока идёт работа, видно одно короткое статус-сообщение с полоской прогресса; когда ответ готов, оно автоматически убирается.";
    await ctx.reply(help);
  });

  bot.command("reset", async (ctx) => {
    if (!isAllowedChat(ctx.chat?.id)) {
      await ctx.reply("Здесь бот недоступен.");
      return;
    }
    const id = String(ctx.chat?.id ?? "");
    await sessionMutex.runExclusive(async () => {
      const s = readSessions();
      delete s[id];
      writeSessions(s);
    });
    await ctx.reply("Готово. Следующее сообщение начнёт новую сессию с ассистентом.");
  });

  bot.command("schedule", async (ctx) => {
    if (!isAllowedChat(ctx.chat?.id)) {
      await ctx.reply("Здесь бот недоступен.");
      return;
    }
    const id = String(ctx.chat!.id);
    const all = await readSchedules();
    const s = all[id];
    if (!s) {
      await ctx.reply(
        "Расписание пока не настроено.\n\nПримеры:\n• /schedule_every 3h\n• или в сообщении с задачей: «…публикация раз в 3 часа»",
      );
      return;
    }
    await ctx.reply(scheduleSummaryLine(s));
  });

  bot.command("schedule_off", async (ctx) => {
    if (!isAllowedChat(ctx.chat?.id)) {
      await ctx.reply("Здесь бот недоступен.");
      return;
    }
    const id = String(ctx.chat!.id);
    const all = await readSchedules();
    const s = all[id];
    if (!s) {
      await ctx.reply("Расписание и так было выключено или не создавалось.");
      return;
    }
    s.enabled = false;
    all[id] = s;
    await writeSchedules(all);
    await ctx.reply("Автозапуски в этом чате выключены. Шаблон задачи сохранён — можно снова включить через /schedule_every.");
  });

  bot.command("schedule_every", async (ctx) => {
    if (!isAllowedChat(ctx.chat?.id)) {
      await ctx.reply("Здесь бот недоступен.");
      return;
    }
    const text = ctx.message?.text?.trim() ?? "";
    const parts = text.split(/\s+/).slice(1);
    const arg = parts.join(" ").trim();
    if (!arg) {
      await ctx.reply(
        "Укажите интервал, например: /schedule_every 3h или /schedule_every 30m или /schedule_every 1d.\nМинимум 15 минут, максимум 7 дней.",
      );
      return;
    }
    const msRaw = parseScheduleEveryArg(arg);
    if (msRaw === null) {
      await ctx.reply(
        "Не разобрал интервал. Примеры: 30m, 90мин, 3h, 1d. Допустимо от 15 минут до 7 дней.",
      );
      return;
    }
    const intervalMs = clampIntervalMs(msRaw);
    if (intervalMs !== msRaw) {
      await ctx.reply(
        `Интервал ограничен диапазоном ${formatIntervalRu(SCHEDULE_MIN_MS)} … ${formatIntervalRu(SCHEDULE_MAX_MS)}. Применяю ${formatIntervalRu(intervalMs)}.`,
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
    };
    await writeSchedules(all);
    await ctx.reply(
      `Запомнила: повтор каждые ${formatIntervalRu(intervalMs)}. Следующий запуск около ${new Date(nextRunAt).toLocaleString("ru-RU")}.\nЕсли шаблон задачи ещё не отправляли — напишите сообщение с ключами или нишей (можно вместе с расписанием в одном тексте).`,
    );
  });

  bot
    .on("message:text")
    .filter((ctx) => !ctx.message.text.startsWith("/"))
    .use(async (ctx) => {
      const chatIdNum = ctx.chat?.id;
      if (!isAllowedChat(chatIdNum)) {
        await ctx.reply("Этот чат не в белом списке доступа.");
        return;
      }
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
            };
            await writeSchedules(all);
            await ctx.reply(
              `Расписание: каждые ${formatIntervalRu(scheduleMs)}. Буду использовать сохранённый шаблон задачи.`,
            );
            return;
          }
          await ctx.reply(
            "Нужен текст задачи в этом же сообщении (ключи, ниша) или сначала отправьте одну полноценную задачу, чтобы я запомнила шаблон.",
          );
          return;
        }
        all[chatIdStr] = {
          enabled: true,
          intervalMs: scheduleMs,
          nextRunAt: Date.now() + scheduleMs,
          lastRunAt: prev?.lastRunAt,
          lastTaskText: taskText,
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
        await ctx.reply("Сообщение слишком короткое — опишите задачу чуть подробнее.");
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
          if (allowed && !allowed.has(chatIdStr)) {
            sch.enabled = false;
            all[chatIdStr] = sch;
            changed = true;
            busyChats.delete(chatIdStr);
            continue;
          }
          await executeAgentJob({
            chatIdStr,
            chatIdNum,
            userPlainText: sch.lastTaskText!.trim(),
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
          console.error("[telegram-bot] scheduled job error", e);
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

  console.error(
    `[telegram-bot] WORKSPACE_ROOT=${WORKSPACE_ROOT} sessions=${SESSIONS_PATH}`,
  );
  await bot.start();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
