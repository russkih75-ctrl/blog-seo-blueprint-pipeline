import { mkdirSync, readFileSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { Agent, Cursor, CursorAgentError } from "@cursor/sdk";
import {
  DEFAULT_BANNER_IN_ARTICLE,
  DEFAULT_NANO_REFERENCE_IMAGE_URLS,
  MCP_TOOL_NANO_FALLBACK_LITE,
  MCP_TOOL_NANO_FALLBACK_PRIMARY,
  MCP_TOOL_WP_UPLOAD_MEDIA,
  MCP_TOOL_WORDSTAT_TOP,
  WORDSTAT_BRIDGE_SYSTEM,
} from "./assets.js";
import { findExtractedMarkdown } from "./workflow-paths.js";

const ROOT = path.resolve(import.meta.dirname, "..");
loadEnv({ path: path.join(ROOT, ".env") });
const mcpKvDotenvRel = process.env.MCP_KV_DOTENV_PATH?.trim();
if (mcpKvDotenvRel)
  loadEnv({ path: path.resolve(ROOT, mcpKvDotenvRel), override: true });

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

const EXTRACTED = path.join(ROOT, "prompts", "_extracted");
const ART = path.join(ROOT, "artifacts");

let loggedLocalRuntime = false;

function useLocalAgent(): boolean {
  return (
    String(process.env.WORKFLOW_RUNTIME ?? "").toLowerCase() === "local"
  );
}

type SdkAgentOptions = NonNullable<Parameters<typeof Agent.prompt>[1]>;

function ensureEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Нужна переменная окружения ${name}`);
  return v;
}

function envMcpKv(): string | undefined {
  return (
    process.env.MCP_KV_HTTP_URL?.trim() ||
    process.env.MCP_KV_URL?.trim() ||
    undefined
  );
}

/** Если false — считаем, что MCP есть только через явный HTTP URL в env */
function assumeDashboardMcp(): boolean {
  return (
    String(process.env.MCP_ASSUME_CURSOR_DASHBOARD ?? "true").toLowerCase() !==
    "false"
  );
}

/** Сопоставляет owner/repo между CLOUD_REPO_URL и ответами Cursor.repositories.list */
function normalizeGithubRepoKey(raw: string): string {
  const s = raw.trim().replace(/\.git$/i, "").replace(/\/+$/, "");
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(s))
    return `github.com/${s.toLowerCase()}`;
  const withScheme = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    if (/\.?github\.com$/i.test(u.hostname)) {
      const p = u.pathname.replace(/^\/+|\/+$/g, "").toLowerCase();
      return `github.com/${p}`;
    }
  } catch {
    /* noop */
  }
  const scp = /^git@github\.com:([^:]+)$/i.exec(s);
  if (scp)
    return `github.com/${scp[1].replace(/\.git$/i, "").toLowerCase()}`;
  return s.toLowerCase();
}

async function assertCloudRepositoryLinked(): Promise<void> {
  if (useLocalAgent()) return;
  if (
    String(process.env.CLOUD_SKIP_REPO_CHECK ?? "").toLowerCase() === "true"
  ) {
    console.warn(
      "[cloud] CLOUD_SKIP_REPO_CHECK=true — пропуск проверки GitHub ↔ Cursor.",
    );
    return;
  }
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  const repoRaw = process.env.CLOUD_REPO_URL?.trim();
  if (!apiKey || !repoRaw) return;
  let repos: Awaited<ReturnType<typeof Cursor.repositories.list>>;
  try {
    repos = await Cursor.repositories.list({ apiKey });
  } catch (e) {
    console.warn(
      "[cloud] Не удалось вызвать Cursor.repositories.list (сеть/API):",
      e,
    );
    return;
  }
  const want = normalizeGithubRepoKey(repoRaw);
  const ok = repos.some((r) => normalizeGithubRepoKey(r.url) === want);
  if (ok) {
    console.error(
      `[cloud] Репозиторий совпадает с подключённым к Cursor (${repos.length} записей в списке).`,
    );
    return;
  }
  const hint =
    repos.length === 0
      ? "Список репозиториев Cursor пуст — откройте https://cursor.com/dashboard → интеграция GitHub и добавьте этот репозиторий (или всю организацию)."
      : `Подключены другие репозитории: ${repos.map((x) => x.url).join(", ")}`;

  throw new Error(
    `[cloud] Репозиторий CLOUD_REPO_URL=${repoRaw} не найден среди проектов, связанных с этим Cursor API ключом.\n${hint}\nДиагностика: npm run check:cloud-setup`,
  );
}

function cloudRequiresInlineMcpKv(): boolean {
  if (useLocalAgent()) return false;
  return (
    String(process.env.CLOUD_REQUIRE_MCP_KV_HTTP ?? "").toLowerCase() === "true"
  );
}

function assertInlineMcpForCloud(): void {
  if (!cloudRequiresInlineMcpKv()) return;
  if (envMcpKv()) return;
  throw new Error(
    `[cloud] CLOUD_REQUIRE_MCP_KV_HTTP=true, но MCP_KV_HTTP_URL пуст.\nЗаполните HTTP endpoint mcp-kv из ЛК https://mcp-kv.ru/ (и Bearer при необходимости).\nПодсказка: скопируйте .env.mcp.example → .env.mcp.local и MCP_KV_DOTENV_PATH=.env.mcp.local\nЛибо снимите требование: CLOUD_REQUIRE_MCP_KV_HTTP=false`,
  );
}

function nanoToolName(): string {
  const t = (
    process.env.MCP_KV_NANO_TOOL?.trim() ||
    MCP_TOOL_NANO_FALLBACK_PRIMARY
  ).trim();
  if (t === "nano_banana_2" || t === "nano_banana_pro") return t;
  if (/(pro|premium)/i.test(t)) return MCP_TOOL_NANO_FALLBACK_PRIMARY;
  return t || MCP_TOOL_NANO_FALLBACK_PRIMARY;
}

/** Референсы для nano_*: env CSV или blueprint по умолчанию */
function referenceImageUrls(): string[] {
  const raw =
    process.env.NANO_REFERENCE_IMAGE_URLS?.trim() ||
    process.env.NANO_IMAGE_INPUT_URLS?.trim();
  if (raw) return raw.split(/[\s,;]+/).filter(Boolean);
  return [...DEFAULT_NANO_REFERENCE_IMAGE_URLS];
}

function wordstatNumPhrases(): number {
  const n = Number(process.env.WORDSTAT_NUM_PHRASES ?? "10");
  return Number.isFinite(n) ? Math.min(2000, Math.max(1, n)) : 10;
}

function wordstatRegionsJson(): string {
  const r =
    process.env.WORDSTAT_REGIONS?.trim() ||
    process.env.WORDSTAT_REGION_IDS?.trim() ||
    "225";
  const arr = r.split(/[,;\s]+/).filter(Boolean);
  return JSON.stringify(arr);
}

function wordstatDevicesJson(): string {
  const d =
    process.env.WORDSTAT_DEVICES_JSON?.trim() ||
    '["DEVICE_ALL"]';
  return d.startsWith("[") ? d : JSON.stringify([d.trim()]);
}

function attachMcpServers(opts: SdkAgentOptions): void {
  /** Дополнительные MCP только если вы задаёте URL сами.
   * Серверы из Cursor → Agents / команды уже доступны облачному агенту без этого блока.
   */
  /** @type SdkAgentOptions["mcpServers"] */
  const servers: NonNullable<SdkAgentOptions["mcpServers"]> =
    opts.mcpServers ?? {};

  const kvUrl = envMcpKv()?.replace(/\/$/, "") ?? "";

  const kvBearer =
    process.env.MCP_KV_HTTP_BEARER?.trim() ||
    process.env.MCP_KV_BEARER?.trim() ||
    process.env.MCP_KV_TOKEN?.trim();

  if (kvUrl) {
    const headers: Record<string, string> = {};
    if (kvBearer) headers.Authorization = `Bearer ${kvBearer}`;
    servers["mcp_kv"] = {
      type: "http",
      url: kvUrl,
      ...(Object.keys(headers).length ? { headers } : {}),
    };
  }

  /** Отдельный WordPress MCP только если URL отличается от единого mcp-kv */
  const wpUrl = process.env.WORDPRESS_MCP_HTTP_URL?.trim();
  const wpBear = process.env.WORDPRESS_MCP_HTTP_BEARER?.trim();
  if (wpUrl && wpUrl !== kvUrl) {
    const h: Record<string, string> = {};
    if (wpBear) h.Authorization = `Bearer ${wpBear}`;
    servers["wordpress_inline"] = {
      type: "http",
      url: wpUrl,
      ...(Object.keys(h).length ? { headers: h } : {}),
    };
  }

  if (Object.keys(servers).length > 0) opts.mcpServers = servers;
}

function loadMdByModule(moduleId: number): string {
  return readFileSync(findExtractedMarkdown(EXTRACTED, moduleId), "utf-8");
}

function extractBlock(
  md: string,
  heading: string,
  stopAt: string[],
): string {
  const idx = md.indexOf(heading);
  if (idx === -1) return "";
  let rest = md.slice(idx + heading.length);
  let min = rest.length;
  for (const sh of stopAt) {
    const p = rest.indexOf(sh);
    if (p !== -1) min = Math.min(min, p);
  }
  return rest.slice(0, min).trim();
}

/** Промпт Nano / Gemini: mapper.prompt или developer + user_text */
function stripBlueprintHeader(md: string): string {
  const u = extractBlock(md, "## mapper.user_text", [
    "## mapper.developer_text",
    "## Технич.",
  ]);
  const d = extractBlock(md, "## mapper.developer_text", [
    "## mapper.user_text",
    "## Технич.",
  ]);
  const p = extractBlock(md, "## mapper.prompt", ["## Технич."]);
  if (d || u) {
    return [d, u].filter(Boolean).join("\n\n---\n\n");
  }
  if (p) return p;
  return md;
}


async function cursorCloud(prompt: string, label: string): Promise<string> {
  const apiKey = ensureEnv("CURSOR_API_KEY");
  const modelId = process.env.CURSOR_MODEL?.trim();

  /** Локально модель нужна явно (@cursor/sdk). */
  if (useLocalAgent() && !modelId) {
    throw new Error(
      "Для WORKFLOW_RUNTIME=local задайте CURSOR_MODEL (например composer-2) в .env",
    );
  }

  /** @type SdkAgentOptions */
  const opts: SdkAgentOptions = { apiKey };

  if (useLocalAgent()) {
    opts.local = { cwd: ROOT };
    if (!loggedLocalRuntime) {
      loggedLocalRuntime = true;
      console.error(
        `[runtime] LOCAL — агент в каталоге ${ROOT} (не Cloud). Для MCP через SDK укажите MCP_KV_HTTP_URL или настройте Cursor локально.`,
      );
    }
  } else {
    const repoUrl = ensureEnv("CLOUD_REPO_URL");
    const ref = (process.env.CLOUD_REPO_REF || "main").trim();
    const autoPr =
      String(process.env.CLOUD_AUTO_CREATE_PR || "false").toLowerCase() === "true";
    const skipReviewer =
      String(process.env.CLOUD_SKIP_REVIEWER_REQUEST ?? "true").toLowerCase() !==
      "false";
    opts.cloud = {
      repos: [{ url: repoUrl, startingRef: ref }],
      autoCreatePR: autoPr,
      skipReviewerRequest: skipReviewer,
    };
  }

  if (modelId) opts.model = { id: modelId };

  attachMcpServers(opts);

  console.error(`[step] ▶ ${label}`);
  try {
    const result = await Agent.prompt(prompt, opts);
    if (result.status === "error") {
      console.error(`[step] ✖ ${label} статус=${result.status}`);
      process.exitCode = 2;
    }
    return (result.result ?? "").trimEnd();
  } catch (e) {
    if (e instanceof CursorAgentError) {
      console.error(
        `[step] CursorAgentError ${label}: ${e.message} retryable=${e.isRetryable}`,
      );
      process.exit(1);
    }
    throw e;
  }
}

export function extractSection(full: string, headingWithHash: string): string {
  const h = "### " + headingWithHash;
  const i = full.indexOf(h);
  if (i === -1) return "";
  const after = full.slice(i + h.length);
  const j = after.search(/\n### /);
  return (j === -1 ? after : after.slice(0, j)).trim();
}

/** Ищем публичный URL генерации Kie/nano или медиафайла в конце или по всему тексту */
export function extractPublicImageUrlFromAgentText(answer: string): string | undefined {
  const marker =
    /\b(?:PRIMARY_COVER_IMAGE_URL|MID_BANNER_IMAGE_URL|NANO_PUBLIC_IMAGE_URL|WP_MEDIA_PUBLIC_URL|IMAGE_URL)=(https?:\/\/\S+)/i;
  const linesRev = answer.split(/\n/).reverse();
  for (const ln of linesRev) {
    const mt = ln.trim().match(marker);
    if (mt) return mt[1].replace(/["'")\]]+$/, "").trim();
  }
  /** последний очевидный URL картинки */
  const all = [...answer.matchAll(/https?:\/\/[^\s"'<>\][]+\.(png|jpg|jpeg|webp)(\?[^\s"'<>\][]*)?/gi)].map((m) => m[0]);
  return all[all.length - 1]?.replace(/[,;.]$/, "").trim();
}

function parseSeeds(raw: string): { k1: string; k2: string; k3: string } {
  let s = raw.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/;
  const fm = fence.exec(s);
  if (fm) s = fm[1]?.trim() ?? s;
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end <= start)
    throw new Error(`Не нашёл JSON k1,k2,k3 в ответе модели`);
  const j = JSON.parse(s.slice(start, end + 1)) as
    | Record<string, string>
    | string[];
  if (Array.isArray(j))
    return { k1: String(j[0] ?? ""), k2: String(j[1] ?? ""), k3: String(j[2] ?? "") };
  if (!j.k1 || !j.k2 || !j.k3) throw new Error("JSON семян без k1/k2/k3");
  return { k1: j.k1, k2: j.k2, k3: j.k3 };
}

function parseImagePack(raw: string): {
  filename: string;
  title: string;
  alt: string;
  caption: string;
  info: string;
} {
  let s = raw.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/;
  const fm = fence.exec(s);
  if (fm) s = fm[1]?.trim() ?? s;
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  const j = JSON.parse(s.slice(start, end + 1)) as {
    result: {
      filename: string;
      title: string;
      alt: string;
      caption: string;
      info: string;
    };
  };
  if (!j.result) throw new Error("Нужен объект result в JSON медиапакета");
  return j.result;
}

function wordstatViaMcpInstructionBlock(seeds: {
  k1: string;
  k2: string;
  k3: string;
}): string {
  const num = wordstatNumPhrases();
  const regs = wordstatRegionsJson();
  const dev = wordstatDevicesJson();
  return `# Шаг blueprint id=3 (Яндекс.Вордстат через MCP **wordstat_get_top_requests**)

Инструмент должен быть доступен агенту из подключения Cursor (**cursor.com/agents** / команда) или через опциональный inline MCP URL — название инструмента: **${MCP_TOOL_WORDSTAT_TOP}** (одно ключевое слово за один вызов).

Сделай **три последовательных вызова** этого инструмента — по одному на каждую строку ниже:

1. phrase = "${seeds.k1.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"
2. phrase = "${seeds.k2.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"
3. phrase = "${seeds.k3.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"

В каждом вызове используй параметры JSON:
{
  "phrase": "<соответствующая фраза>",
  "numPhrases": ${num},
  "regions": ${regs},
  "devices": ${dev}
}

**Запрет:** не смешивай три фразы в один запрос Вордстата.

После результатов выпиши в ответ текстом блоки "### request1 топ", "### request2 топ", "### request3 топ" с фразами/частотами как вернул инструмент.

В самом конце одна строка:
summary_keywords: <до 4500 символов уникальных фраз через запятую по всем трём топам>.
`;
}

function nanoToolFooter(args: {
  tool: string;
  aspect_ratio: string;
  resolution: "1K" | "2K" | "4K";
  output_format: "png" | "jpg";
  refs: string[];
  urlMarker: "PRIMARY_COVER_IMAGE_URL" | "MID_BANNER_IMAGE_URL";
}): string {
  const arr = JSON.stringify(args.refs);
  const modelHint =
    args.tool === MCP_TOOL_NANO_FALLBACK_LITE
      ? `${MCP_TOOL_NANO_FALLBACK_LITE}: до 14 референсных изображений`
      : `${MCP_TOOL_NANO_FALLBACK_PRIMARY}: до 8 референсов (Nano Banana Pro)`;
  return `\n---\n# MCP mcp-kv / Kie.ai

Вызови **ровно один** вызов инструмента \`${args.tool}\` (${modelHint}).

Аргументы:
- prompt: весь сценарий **выше этого блока** целиком, без удаления строк.
- image_input: массив ${arr}
- aspect_ratio: "${args.aspect_ratio}"
- resolution: "${args.resolution}"
- output_format: "${args.output_format}"

Последней строкой ответа (без пробелов перед ключом) ровно:
${args.urlMarker}=https://... (публичный URL готового изображения)
`;
}

async function wordpressUploadBannerIfConfigured(
  fileUrl: string,
): Promise<string | undefined> {
  /** отключено явно через env */
  if (
    String(
      process.env.WP_UPLOAD_MID_ARTICLE_BANNER_TO_MEDIA ?? "true",
    ).toLowerCase() === "false"
  ) {
    return undefined;
  }

  const title =
    process.env.WP_BANNER_UPLOAD_TITLE?.trim() || "Автоматизация соцсетей";
  const alt = process.env.WP_BANNER_UPLOAD_ALT?.trim() || "контентзавод";
  const p = `# Загрузка баннера в медиатеку WordPress (blueprint модуль ~11)

Инструмент: **${MCP_TOOL_WP_UPLOAD_MEDIA}** (может быть на том же MCP, что kv.ru).
Аргументы минимально:
file_url="${fileUrl}"
title="${title.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"
alt_text="${alt.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"
caption=""

Последней строкой: WP_MEDIA_PUBLIC_URL=https://... (берётся из source_url/link ответа).`;

  const raw = await cursorCloud(p, "11 wordpress_upload_media banner");
  return extractPublicImageUrlFromAgentText(raw);
}


interface SavedState {
  topic: string;
  seedsRaw?: string;
  seeds?: { k1: string; k2: string; k3: string };
  wordstatSynth?: string;
  seoTitle?: string;
  coverNanoPublicUrl?: string;
  bannerNanoPublicUrl?: string;
  midArticleBannerSrcUrl?: string;
  research?: string;
  articleHtml?: string;
  metaDescription?: string;
  imagePack?: ReturnType<typeof parseImagePack>;
}

function saveState(o: SavedState): void {
  mkdirSync(ART, { recursive: true });
  writeFileSync(
    path.join(ART, "pipeline-state.json"),
    JSON.stringify(o, null, 2),
    "utf-8",
  );
}

async function main(): Promise<void> {
  const topicRaw =
    process.argv.slice(2).join(" ").trim() || process.env.BLUEPRINT_TOPIC_RAW?.trim();

  if (!topicRaw)
    throw new Error(
      "Укажите тему первым аргументом командной строки или BLUEPRINT_TOPIC_RAW в .env",
    );

  const nanoSkip =
    String(process.env.NANO_SKIP || "false").toLowerCase() === "true";

  mkdirSync(EXTRACTED, { recursive: true });

  try {
    const list = readdirSync(EXTRACTED).filter(String);
    if (!list.some((x) => x.includes("_39_")))
      throw new Error("Нет промптов после extract для id=39");
  } catch {
    throw new Error(
      "Нет промптов prompts/_extracted — запустите npm run extract -- \"полный-путь-к-blueprint.json\"",
    );
  }

  await assertCloudRepositoryLinked();
  assertInlineMcpForCloud();

  const useWordstatMcp =
    String(process.env.WORDSTAT_USE_MCP ?? "true").toLowerCase() !== "false";
  const useSurrogateOnly =
    String(process.env.WORDSTAT_FALLBACK_SURROGATE_ONLY ?? "").toLowerCase() === "true";

  const inlineKvUrl = !!envMcpKv();
  if (!useLocalAgent()) {
    if (inlineKvUrl) {
      console.error(
        "[mcp] HTTP mcp-kv: MCP_KV_HTTP_URL передаётся в Cloud через @cursor/sdk (inline mcp_servers).",
      );
    } else {
      console.warn(
        "[mcp] Cloud: MCP_KV_HTTP_URL пуст — из CLI инструменты mcp-kv часто недоступны. Возьмите endpoint/Bearer в ЛК https://mcp-kv.ru/ и см. .env.mcp.example, затем CLOUD_REQUIRE_MCP_KV_HTTP=true.",
      );
    }
  } else if (!inlineKvUrl && assumeDashboardMcp()) {
    console.error(
      "[mcp] Локальный режим без MCP_KV_HTTP_URL — у локального Agent через SDK часто нет MCP; см. MCP_KV_DOTENV_PATH или HTTP URL.",
    );
  }

  const state: SavedState = {
    topic: topicRaw,
  };

  /** 39 — три сид-фразы */
  let seedsPrompt = stripBlueprintHeader(loadMdByModule(39));
  seedsPrompt = seedsPrompt.replace(/\{\{1\.value\}\}/g, topicRaw);
  const seedsAns = await cursorCloud(seedsPrompt, "39 seeds k1,k2,k3 JSON");
  state.seedsRaw = seedsAns;
  state.seeds = parseSeeds(seedsAns);

  /** 3 — Wordstat через MCP (dashboard Cursor или inline URL) или текстовый суррогат */
  if (useWordstatMcp && !useSurrogateOnly) {
    state.wordstatSynth = await cursorCloud(
      wordstatViaMcpInstructionBlock(state.seeds),
      `${MCP_TOOL_WORDSTAT_TOP} x3 (РФ кластеры)`,
    );
  } else {
    const bridgeUser = `# ВХОД
Сид-фразы:
${JSON.stringify(state.seeds, null, 2)}
Тема-черновик: ${topicRaw}`;
    state.wordstatSynth = await cursorCloud(
      `${WORDSTAT_BRIDGE_SYSTEM}\n\n${bridgeUser}`,
      "Wordstat FALLBACK текстовый (WORDSTAT_USE_MCP=false или WORDSTAT_FALLBACK_SURROGATE_ONLY=true)",
    );
  }

  /** 40 — SEO-заголовок */
  let seoPrompt = stripBlueprintHeader(loadMdByModule(40));
  seoPrompt = seoPrompt.replace(/\{\{1\.value\}\}/g, topicRaw);

  seoPrompt = seoPrompt.replace(
    /\{\{3\.request1\.topRequests\[1\]\.phrase\}\}/g,
    `[первая_фраза_кластера]: ${state.seeds!.k1}`,
  );
  seoPrompt = seoPrompt.replace(
    /\{\{3\.request1\.topRequests\[2\]\.phrase\}\}/g,
    `[вторая_фраза_кластера]: ${state.seeds!.k2}`,
  );
  seoPrompt = seoPrompt.replace(
    /\{\{3\.request1\.topRequests\[3\]\.phrase\}\}/g,
    `[третья_фраза_кластера]: ${state.seeds!.k3}`,
  );

  const kwAppend = `\n\nПЛОТНЫЙ КЛЮСТЕР ФРАЗ из шага Вордстата:\n${state.wordstatSynth}\n`;
  seoPrompt += kwAppend;

  seoPrompt += `\n\nВерни СТРОГО один финальный заголовок одной строкой в конце ответа.`;

  const seoAns = await cursorCloud(seoPrompt, "40 SEO финальный заголовок");
  {
    let t = seoAns.replace(/^["„«]|["„»]$/g, "").trim();
    const lines = t.split("\n").map((l) => l.trim()).filter(Boolean);
    const pick =
      lines.find((l) => l.length >= 35 && l.length <= 110) ??
      lines[lines.length - 1] ??
      t;
    state.seoTitle = pick.slice(0, 115);
  }

  /** nano 5 обложки (до исследования, как blueprint) */
  const refs = referenceImageUrls();
  const resPick: "1K" | "2K" | "4K" =
    process.env.NANO_RESOLUTION?.trim().toUpperCase() === "2K"
      ? "2K"
      : process.env.NANO_RESOLUTION?.trim().toUpperCase() === "4K"
        ? "4K"
        : "1K";

  if (!nanoSkip) {
    let coverTpl = stripBlueprintHeader(loadMdByModule(5));
    coverTpl = coverTpl.replace(/\{\{40\.content\}\}/g, state.seoTitle!);
    const coverBody = `${coverTpl}\n\n${nanoToolFooter({
      tool: nanoToolName(),
      aspect_ratio: "16:9",
      resolution: resPick,
      output_format:
        nanoToolName() === MCP_TOOL_NANO_FALLBACK_LITE ? "jpg" : "png",
      refs,
      urlMarker: "PRIMARY_COVER_IMAGE_URL",
    })}`;

    const coverAns = await cursorCloud(coverBody, "5 MCP nano обложка 16:9");
    state.coverNanoPublicUrl = extractPublicImageUrlFromAgentText(coverAns);
    if (!state.coverNanoPublicUrl)
      console.warn("[warn] обложку nano MCP не удалось распарсить из ответа");
  }

  /** 41 — поиск информации после SEO+обложки */
  let rPrompt = stripBlueprintHeader(loadMdByModule(41));
  rPrompt = rPrompt.replace(/\{\{40\.content\}\}/g, state.seoTitle);
  rPrompt =
    rPrompt.replace(
      /Тема:\s*\{\{40\.content\}\}/g,
      `Тема: ${state.seoTitle}`,
    ) || rPrompt;
  state.research = await cursorCloud(rPrompt, "41 grounding research brief");

  /** 9 nano баннер «Ковчег+» перед телом поста как в blueprint */
  let midBannerUrl =
    process.env.MID_ARTICLE_BANNER_IMAGE_URL?.trim() ||
    DEFAULT_BANNER_IN_ARTICLE;

  if (!nanoSkip) {
    const banTpl = stripBlueprintHeader(loadMdByModule(9)).replace(
      /\{\{40\.content\}\}/g,
      state.seoTitle!,
    );

    const banFmt =
      (process.env.NANO_BANNER_FORMAT?.trim()?.toLowerCase() as "jpg" | "png") ??
      (nanoToolName() === MCP_TOOL_NANO_FALLBACK_LITE ? "jpg" : "png");

    const banBody = `${banTpl}\n\n${nanoToolFooter({
      tool: nanoToolName(),
      aspect_ratio: "21:9",
      resolution: resPick,
      output_format: banFmt,
      refs,
      urlMarker: "MID_BANNER_IMAGE_URL",
    })}`;

    const banAns = await cursorCloud(banBody, "9 MCP nano горизонтальный баннер");
    state.bannerNanoPublicUrl = extractPublicImageUrlFromAgentText(banAns);
    midBannerUrl = state.bannerNanoPublicUrl ?? midBannerUrl;

    const uploadedWp = state.bannerNanoPublicUrl
      ? await wordpressUploadBannerIfConfigured(state.bannerNanoPublicUrl)
      : undefined;
    state.midArticleBannerSrcUrl =
      uploadedWp || state.bannerNanoPublicUrl || midBannerUrl;
    midBannerUrl = state.midArticleBannerSrcUrl;
  }

  /** 42 — тело HTML */
  const constMdRaw = loadMdByModule(8);
  const footerLinksHtml = extractSection(constMdRaw, "ссылки  статьи");

  let artPrompt = stripBlueprintHeader(loadMdByModule(42));
  const replPairs: ReadonlyArray<[string, string]> = [
    ["{{40.content}}", state.seoTitle!],
    ["{{3.request1.phrases}} {{3.request2.phrases}} {{3.request3.phrases}}", state.wordstatSynth!],
    ["{{41.content}}", state.research!],
    ["{{11.source_url}}", midBannerUrl],
    ["{{8.`ссылки  статьи`}}", footerLinksHtml],
    ["{{8.ссылки  статьи}}", footerLinksHtml],
  ];
  artPrompt = replPairs.reduce(
    (acc, [from, to]) => acc.split(from).join(to),
    artPrompt,
  );

  state.articleHtml = await cursorCloud(
    `${artPrompt}\n\nСтрого: только HTML без html/body, без markdown.`,
    "42 GEO/SEO статья",
  );

  /** 43 мета — дискрипшен */
  let metaPrompt = stripBlueprintHeader(loadMdByModule(43));
  metaPrompt = metaPrompt.replace(/\{\{42\.content\}\}/g, state.articleHtml);
  state.metaDescription = await cursorCloud(
    metaPrompt,
    "43 meta description Яндекс 100–140",
  );

  /** 44 — JSON описания аплоада обложки поста как в blueprint */
  let imgJsonPrompt = stripBlueprintHeader(loadMdByModule(44));
  imgJsonPrompt = imgJsonPrompt.replace(/\{\{40\.content\}\}/g, state.seoTitle);
  const imgAns = await cursorCloud(
    `${imgJsonPrompt}\nОтвет только JSON.`,
    "44 JSON имени медиа",
  );
  try {
    state.imagePack = parseImagePack(imgAns);
  } catch {
    state.imagePack = {
      filename: "cover_auto",
      title: state.seoTitle,
      alt: state.seoTitle,
      caption: state.seoTitle,
      info: state.metaDescription,
    };
    console.warn("[warn] JSON модуля 44 не распарсен — заглушка метаданных.");
  }

  const featuredCandidate =
    process.env.FEATURED_IMAGE_URL?.trim() ||
    state.coverNanoPublicUrl ||
    DEFAULT_BANNER_IN_ARTICLE;

  const publishStatus =
    (process.env.WP_POST_STATUS || "publish").trim() || "publish";
  const postType =
    (process.env.WP_POST_TYPE || "posts").trim() || "posts";

  const wpFinalPrompt = `# ФИНАЛ blueprint → WordPress (MCP wordpress_* на mcp-kv и др.)

TITLE:
${state.seoTitle}

EXCERPT / meta-description:
${state.metaDescription}

HTML_POST:
${state.articleHtml}

## Обложечное изображение поста (featured)
Публичный URL до загрузки: ${featuredCandidate}
При необходимости сначала **wordpress_upload_image_from_url** / **wordpress_upload_media**, затем ID в **featured_media** при создании записи.

## Метапакета изображения модуль Make 44
${JSON.stringify(state.imagePack, null, 2)}

STATUS=${publishStatus} TYPE=${postType}

Подсказки по топам связки Make: темы make / нейросети / автоматизация.
Если документ огромный — blob (wordpress_content_blob_append → wordpress_create_post_from_blob).
Итого в ответ: ID записи и URL страницы, либо честная ошибка инструмента.

Используй инструменты **wordpress_*** через MCP (конфиг mcp_servers с именем mcp_kv или Cloud‑MCP Cursor). Если недоступны — сообщи явно в ответе.
`;

  await cursorCloud(wpFinalPrompt, "FINAL publish WordPress MCP");
  saveState(state);
  console.error(
    `\n[state] сохранено в ${path.join(ART, "pipeline-state.json")}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
