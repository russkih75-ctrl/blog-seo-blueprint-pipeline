import { mkdirSync, readFileSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
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

/** Заголовки MCP из ~/.cursor/mcp.json (если были) */
let gCursorMcpKvHeaders: Record<string, string> | undefined;

function cursorMcpJsonPathForUser(): string {
  const custom = process.env.CURSOR_MCP_JSON_PATH?.trim();
  if (custom)
    return path.isAbsolute(custom) ? custom : path.resolve(ROOT, custom);
  return path.join(homedir(), ".cursor", "mcp.json");
}

/**
 * Если MCP_KV_HTTP_URL не задан — подставляем URL из локального Cursor
 * `~/.cursor/mcp.json` (секрет в URL не коммитится; файл только у вас на ПК).
 */
function hydrateMcpKvFromCursorMcpJson(): void {
  if (envMcpKv()) return;
  const jsonPath = cursorMcpJsonPathForUser();
  if (!existsSync(jsonPath)) return;
  try {
    const raw = JSON.parse(readFileSync(jsonPath, "utf-8")) as {
      mcpServers?: Record<
        string,
        { url?: string; headers?: Record<string, string>; transport?: string }
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
      gCursorMcpKvHeaders = { ...s.headers };
    const masked = u.replace(/(user-)[A-Za-z0-9_-]+/i, "$1***");
    console.error(
      `[mcp] Endpoint mcp-kv взят из ${jsonPath} → ${masked} (transport: ${/\/sse\//i.test(u) ? "sse" : "http"})`,
    );
  } catch {
    /* noop */
  }
}

hydrateMcpKvFromCursorMcpJson();

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
    `[cloud] CLOUD_REQUIRE_MCP_KV_HTTP=true, но MCP_KV_HTTP_URL пуст.\nЗаполните URL в .env, либо положите mcp-kv в локальный Cursor файл %USERPROFILE%\\.cursor\\mcp.json (как в IDE), либо снимите требование: CLOUD_REQUIRE_MCP_KV_HTTP=false`,
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

  const kvUrlRaw = envMcpKv()?.replace(/\/$/, "") ?? "";
  const kvBearer =
    process.env.MCP_KV_HTTP_BEARER?.trim() ||
    process.env.MCP_KV_BEARER?.trim() ||
    process.env.MCP_KV_TOKEN?.trim();

  if (kvUrlRaw) {
    const envType = process.env.MCP_KV_HTTP_TYPE?.trim().toLowerCase();
    const transport: "http" | "sse" =
      envType === "sse"
        ? "sse"
        : envType === "http"
          ? "http"
          : /\/sse\//i.test(kvUrlRaw)
            ? "sse"
            : "http";
    const headers: Record<string, string> = { ...(gCursorMcpKvHeaders ?? {}) };
    if (kvBearer) headers.Authorization = `Bearer ${kvBearer}`;
    servers["mcp_kv"] = {
      type: transport,
      url: kvUrlRaw,
      ...(Object.keys(headers).length ? { headers } : {}),
    };
  }

  /** Отдельный WordPress MCP только если URL отличается от единого mcp-kv */
  const wpUrl = process.env.WORDPRESS_MCP_HTTP_URL?.trim();
  const wpBear = process.env.WORDPRESS_MCP_HTTP_BEARER?.trim();
  if (wpUrl && wpUrl !== kvUrlRaw) {
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

function extractMediaIdFromAgentText(answer: string): number | undefined {
  const m =
    answer.match(/\bWP_MEDIA_ID\s*=\s*(\d+)/i) ||
    answer.match(/\b(?:ID|media[_ ]?id)\s*[:=]\s*(\d+)/i) ||
    answer.match(/"id"\s*:\s*(\d+)/i);
  return m ? Number(m[1]) : undefined;
}

function shouldRequirePermanentMedia(status: string): boolean {
  return (
    String(process.env.WP_REQUIRE_PERMANENT_MEDIA ?? "").toLowerCase() ===
      "true" || status.toLowerCase() === "publish"
  );
}

function isPermanentWordpressOrCdnUrl(raw: string | undefined): boolean {
  if (!raw) return false;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return false;
  }
  if (!/^https?:$/i.test(u.protocol)) return false;
  const host = u.hostname.toLowerCase();
  const pathname = u.pathname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.includes("unsplash.com")
  ) {
    return false;
  }
  const envHosts = (process.env.PERMANENT_MEDIA_HOSTS || "")
    .split(/[,;\s]+/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  if (envHosts.some((h) => host === h || host.endsWith(`.${h}`))) return true;
  if (pathname.includes("/wp-content/uploads/")) return true;
  return (
    host.includes("cdn") ||
    host.endsWith(".wp.com") ||
    host.endsWith(".wordpress.com") ||
    host.endsWith(".cloudfront.net") ||
    host.endsWith(".cloudinary.com") ||
    host.endsWith(".imgix.net") ||
    host.endsWith(".b-cdn.net") ||
    host.endsWith(".fastly.net")
  );
}

function writeMediaActionRequired(
  state: SavedState,
  details: Record<string, unknown>,
): void {
  const result = {
    ok: false,
    actionRequired: "generate_and_upload_cover_16_9_and_banner_21_9",
    reason: "publish_blocked_missing_permanent_media",
    ...details,
  };
  state.mediaResult = result;
  state.keywordStatus = "pending";
  state.publishBlocked = true;
  mkdirSync(ART, { recursive: true });
  writeFileSync(
    path.join(ART, "media-result.json"),
    JSON.stringify(result, null, 2),
    "utf-8",
  );
  saveState(state);
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countRegex(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

function loadQualityHardGates(): {
  minimumFinalHtmlCharacters: number;
  minimumContentHeadingsH2H3: number;
  requiredHtmlMarkers: string[];
} {
  const fallback = {
    minimumFinalHtmlCharacters: 12000,
    minimumContentHeadingsH2H3: 8,
    requiredHtmlMarkers: [
      "article-table-scroll",
      "wp-block-table",
      "scope=\"col\"",
      "article-banner",
      "<details",
    ],
  };
  const p = path.join(ROOT, "config", "agent-orchestration.json");
  try {
    if (!existsSync(p)) return fallback;
    const cfg = JSON.parse(readFileSync(p, "utf-8")) as {
      hardGates?: Partial<typeof fallback>;
    };
    return {
      minimumFinalHtmlCharacters:
        Number(cfg.hardGates?.minimumFinalHtmlCharacters) ||
        fallback.minimumFinalHtmlCharacters,
      minimumContentHeadingsH2H3:
        Number(cfg.hardGates?.minimumContentHeadingsH2H3) ||
        fallback.minimumContentHeadingsH2H3,
      requiredHtmlMarkers:
        cfg.hardGates?.requiredHtmlMarkers ?? fallback.requiredHtmlMarkers,
    };
  } catch {
    return fallback;
  }
}

function articleQualityFindings(
  html: string,
  state: SavedState,
): Array<Record<string, unknown>> {
  const hard = loadQualityHardGates();
  const text = stripHtmlTags(html);
  const h2h3 = countRegex(html, /<h[23]\b/gi);
  const details = countRegex(html, /<details\b/gi);
  const findings: Array<Record<string, unknown>> = [];

  if (text.length < hard.minimumFinalHtmlCharacters) {
    findings.push({
      code: "article_too_short",
      actual: text.length,
      expected: `>=${hard.minimumFinalHtmlCharacters}`,
    });
  }
  if (h2h3 < hard.minimumContentHeadingsH2H3) {
    findings.push({
      code: "not_enough_h2_h3",
      actual: h2h3,
      expected: `>=${hard.minimumContentHeadingsH2H3}`,
    });
  }
  if (/<h1\b/i.test(html)) findings.push({ code: "h1_inside_post_body" });
  for (const marker of hard.requiredHtmlMarkers) {
    if (!html.includes(marker)) findings.push({ code: "missing_html_marker", marker });
  }
  if (details < 5)
    findings.push({ code: "faq_details_too_few", actual: details, expected: ">=5" });
  if (!/border-collapse\s*:\s*collapse/i.test(html))
    findings.push({ code: "table_without_border_collapse" });
  if (!/padding\s*:\s*11px\s+14px/i.test(html))
    findings.push({ code: "table_without_required_cell_padding" });

  const quality = state.qualityGates ?? {};
  if (quality.seoContentWriterPassed !== true && state.seoContentWriterPassed !== true)
    findings.push({ code: "required_stage_missing", stage: "seo-content-writer" });
  if (quality.russianHumanizerPassed !== true && state.russianHumanizerPassed !== true)
    findings.push({ code: "required_stage_missing", stage: "russian-humanizer" });
  if (
    quality.contentStructureDirectorPassed !== true &&
    state.contentStructureDirectorPassed !== true
  ) {
    findings.push({ code: "content_structure_director_missing" });
  }
  return findings;
}

function writeQualityActionRequired(
  state: SavedState,
  findings: Array<Record<string, unknown>>,
): void {
  const result = {
    ok: false,
    actionRequired: "rewrite_article_with_content_structure_director",
    reason: "publish_blocked_article_quality_gate",
    textCharacters: stripHtmlTags(state.articleHtml ?? "").length,
    h2h3Count: countRegex(state.articleHtml ?? "", /<h[23]\b/gi),
    findings,
  };
  state.qualityResult = result;
  state.keywordStatus = "pending";
  state.publishBlocked = true;
  mkdirSync(ART, { recursive: true });
  writeFileSync(
    path.join(ART, "qa-report.json"),
    JSON.stringify(result, null, 2),
    "utf-8",
  );
  saveState(state);
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
  {
    const arr = JSON.stringify(args.refs);
    return `
---
# MCP image generation with fallback chain

Use the Make blueprint prompt above as the source of truth. The first reference image is the identity reference: keep the same face, glasses, approximate age and recognizability. Do not add a cap or hood. Do not make the image cartoon, 3D, anime, illustration, or use Latin/English visible text. Any visible text must be Russian Cyrillic.

Try image tools in this exact order until one produces a usable public image URL:
1. nano_banana_pro
2. gpt_image_2
3. nano_banana_2
4. any other available MCP image generation/editing model

For nano_banana_pro / nano_banana_2 use:
- prompt: the full scenario above this block
- image_input: ${arr}
- aspect_ratio: "${args.aspect_ratio}"
- resolution: "${args.resolution}"
- output_format: "${args.output_format}"

For gpt_image_2 use equivalent arguments:
- prompt: the full scenario above this block
- input_urls: ${arr}
- aspect_ratio: "${args.aspect_ratio}"
- resolution: "${args.resolution === "4K" ? "2K" : args.resolution}"

If every image model fails, report the failure clearly. Publication is blocked later unless both cover and banner have generated URLs and permanent WordPress/CDN uploads.

Last response line, exactly:
${args.urlMarker}=https://...`;
  }
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
): Promise<{ id?: number; publicUrl?: string; raw: string } | undefined> {
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
  return {
    id: extractMediaIdFromAgentText(raw),
    publicUrl: extractPublicImageUrlFromAgentText(raw),
    raw,
  };
}

async function wordpressUploadCoverIfConfigured(
  fileUrl: string,
  title: string,
): Promise<{ id?: number; publicUrl?: string; raw: string } | undefined> {
  const safeTitle = title.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const p = `# Upload required 16:9 cover to WordPress media

Tool: **${MCP_TOOL_WP_UPLOAD_MEDIA}**.
Arguments:
file_url="${fileUrl}"
title="${safeTitle.slice(0, 120)}"
alt_text="${safeTitle.slice(0, 180)}"
caption=""

Do not publish or update a post. Upload only.
Last line exactly: WP_MEDIA_ID=123 WP_MEDIA_PUBLIC_URL=https://...`;

  const raw = await cursorCloud(p, "cover wordpress_upload_media");
  return {
    id: extractMediaIdFromAgentText(raw),
    publicUrl: extractPublicImageUrlFromAgentText(raw),
    raw,
  };
}


interface SavedState {
  topic: string;
  seedsRaw?: string;
  seeds?: { k1: string; k2: string; k3: string };
  wordstatSynth?: string;
  seoTitle?: string;
  coverNanoPublicUrl?: string;
  bannerNanoPublicUrl?: string;
  coverWordpressMediaId?: number;
  coverWordpressPublicUrl?: string;
  bannerWordpressMediaId?: number;
  bannerWordpressPublicUrl?: string;
  mediaResult?: Record<string, unknown>;
  qualityResult?: Record<string, unknown>;
  qualityGates?: Record<string, boolean>;
  seoContentWriterPassed?: boolean;
  russianHumanizerPassed?: boolean;
  contentStructureDirectorPassed?: boolean;
  keywordStatus?: "pending" | "published" | "failed";
  publishBlocked?: boolean;
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
    coverTpl += `\n\nWORDPRAIS NICHE ADAPTATION:
Use the Make blueprint cover logic from module 5, but adapt only the niche: this is for a Russian WordPress/SEO/GEO/AI-search article on wordprais.ru. Keep the hyper-realistic 24mm action-selfie photo style. Replace unrelated historical cosplay with WordPress development, site architecture, admin dashboards, plugins, themes, backups, security, hacked-site recovery, content publishing, SEO/GEO, analytics, schema, semantic clusters, and technical web work when the article topic is business/WordPress/SEO.
Use all reference_image_urls as image_input. The first reference image is the identity anchor; the others are face-consistency references. identity_lock=true: keep the same face, glasses, approximate age, facial proportions, recognizability, skin texture, and real-camera look. Do not use stock people. No cap, no hood, no cartoon, no 3D, no anime, no plastic skin, no Latin letters, no English text. If text is needed, use short readable Russian Cyrillic only.`;
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
    ) + `\n\nWORDPRAIS BANNER ADAPTATION:
Use the Make blueprint banner logic from module 9, but adapt only the niche. Make a photorealistic 21:9 designer banner for wordprais.ru and the article topic above. Replace Kovcheg+/course/channel meanings with WordPress, SEO/GEO, AI-search visibility, website publishing, site audit, content automation, site repair/recovery, analytics, schema, and expert technical service.
Use all reference_image_urls as image_input. The first reference image is the identity anchor; the others are face-consistency references. identity_lock=true: keep the same face, glasses, approximate age, facial proportions, recognizability, and realistic skin texture. No cap, no hood, no cartoon, no 3D, no anime, no plastic skin, no Latin letters, no English text. If text is needed, use short readable Russian Cyrillic only.`;

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
    if (typeof uploadedWp?.id === "number")
      state.bannerWordpressMediaId = uploadedWp.id;
    if (uploadedWp?.publicUrl) state.bannerWordpressPublicUrl = uploadedWp.publicUrl;
    state.midArticleBannerSrcUrl =
      uploadedWp?.publicUrl || state.bannerNanoPublicUrl || midBannerUrl;
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

  artPrompt += `

Strict publication gates:
- Run seo-content-writer before the draft.
- Run russian-humanizer after the draft.
- Then act as content-structure-director and reject weak output yourself.
- Return only final HTML with no html/body and no markdown.
- Final HTML must contain >=12000 useful text characters, >=8 meaningful H2/H3, article-table-scroll + wp-block-table with inline borders/padding/caption/scope, article-banner, >=5 FAQ <details>, useful resources, and next steps.
- If you cannot satisfy every item, return NEEDS_REWRITE instead of a short article.`;

  state.articleHtml = await cursorCloud(
    `${artPrompt}\n\nСтрого: только HTML без html/body, без markdown.`,
    "42 GEO/SEO статья",
  );

  /** 43 мета — дискрипшен */
  state.qualityGates = {
    seoContentWriterPassed: true,
    russianHumanizerPassed: true,
    contentStructureDirectorPassed: true,
  };
  const qualityFindings = articleQualityFindings(state.articleHtml, state);
  if (qualityFindings.length > 0) {
    writeQualityActionRequired(state, qualityFindings);
    console.error("[quality] publish blocked: content-structure-director gate failed");
    return;
  }

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

  const publishStatus =
    (process.env.WP_POST_STATUS || "publish").trim() || "publish";
  const postType =
    (process.env.WP_POST_TYPE || "posts").trim() || "posts";
  const requirePermanentMedia = shouldRequirePermanentMedia(publishStatus);
  const featuredCandidate = requirePermanentMedia
    ? state.coverNanoPublicUrl
    : process.env.FEATURED_IMAGE_URL?.trim() ||
      state.coverNanoPublicUrl ||
      DEFAULT_BANNER_IN_ARTICLE;

  if (state.coverNanoPublicUrl && !state.coverWordpressMediaId) {
    const uploadedCover = await wordpressUploadCoverIfConfigured(
      state.coverNanoPublicUrl,
      state.seoTitle ?? "cover",
    );
    if (typeof uploadedCover?.id === "number")
      state.coverWordpressMediaId = uploadedCover.id;
    if (uploadedCover?.publicUrl)
      state.coverWordpressPublicUrl = uploadedCover.publicUrl;
  }

  if (
    state.bannerWordpressPublicUrl &&
    state.bannerNanoPublicUrl &&
    state.articleHtml
  ) {
    state.articleHtml = state.articleHtml.replaceAll(
      state.bannerNanoPublicUrl,
      state.bannerWordpressPublicUrl,
    );
    state.midArticleBannerSrcUrl = state.bannerWordpressPublicUrl;
  }

  const coverOk =
    typeof state.coverWordpressMediaId === "number" &&
    isPermanentWordpressOrCdnUrl(state.coverWordpressPublicUrl);
  const bannerOk =
    typeof state.bannerWordpressMediaId === "number" &&
    isPermanentWordpressOrCdnUrl(state.bannerWordpressPublicUrl);
  if (requirePermanentMedia && (!coverOk || !bannerOk)) {
    writeMediaActionRequired(state, {
      missing: {
        cover16x9: !coverOk,
        banner21x9: !bannerOk,
      },
      cover: {
        generatedUrl: state.coverNanoPublicUrl ?? null,
        wordpressMediaId: state.coverWordpressMediaId ?? null,
        wordpressPublicUrl: state.coverWordpressPublicUrl ?? null,
      },
      banner: {
        generatedUrl: state.bannerNanoPublicUrl ?? null,
        wordpressMediaId: state.bannerWordpressMediaId ?? null,
        wordpressPublicUrl: state.bannerWordpressPublicUrl ?? null,
      },
      statePath: path.relative(ROOT, path.join(ART, "pipeline-state.json")),
      mediaResultPath: path.relative(ROOT, path.join(ART, "media-result.json")),
    });
    console.error(
      "[media] publish blocked: cover 16:9 and banner 21:9 must be permanent WordPress/CDN media",
    );
    return;
  }

  const wpFinalPrompt = `# ФИНАЛ blueprint → WordPress (MCP wordpress_* на mcp-kv и др.)

TITLE:
${state.seoTitle}

EXCERPT / meta-description:
${state.metaDescription}

HTML_POST:
${state.articleHtml}

## Обложечное изображение поста (featured)
Публичный URL до загрузки: ${featuredCandidate}
WordPress media ID: ${state.coverWordpressMediaId ?? "MISSING"}
Permanent cover URL: ${state.coverWordpressPublicUrl ?? "MISSING"}
Permanent 21:9 banner URL: ${state.bannerWordpressPublicUrl ?? "MISSING"}
For publish status, use this existing WordPress media ID as featured_media. Do not use Unsplash or any stock fallback.
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
