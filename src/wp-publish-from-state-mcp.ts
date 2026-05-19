/**
 * Публикация готового HTML из artifacts/pipeline-state.json через MCP wordpress_* (mcp-kv SSE/HTTP).
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { Agent, CursorAgentError } from "@cursor/sdk";
import { DEFAULT_BANNER_IN_ARTICLE } from "./assets.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const ART = path.join(ROOT, "artifacts");

function pipelineStatePathForPublish(): string {
  const custom = process.env.PIPELINE_STATE_PATH?.trim();
  if (custom)
    return path.isAbsolute(custom)
      ? custom
      : path.join(ROOT, custom.replace(/^\/+/, ""));
  const site = (process.env.WORDSTAT_SITE_KEY ?? "wordprais")
    .trim()
    .toLowerCase();
  if (site === "bytmaster34")
    return path.join(ART, "pipeline-state.bytmaster34.json");
  return path.join(ART, "pipeline-state.json");
}

loadEnv({ path: path.join(ROOT, ".env") });
const mcpKvDotenvRel = process.env.MCP_KV_DOTENV_PATH?.trim();
if (mcpKvDotenvRel)
  loadEnv({ path: path.resolve(ROOT, mcpKvDotenvRel), override: true });

interface PipelineState {
  topic?: string;
  seoTitle?: string;
  metaDescription?: string;
  articleHtml?: string;
  imagePack?: Record<string, unknown>;
  coverNanoPublicUrl?: string;
  wordpressPublishRaw?: string;
  wordpressPublishedUrl?: string;
}

type SdkAgentOptions = NonNullable<Parameters<typeof Agent.prompt>[1]>;

function envMcpKv(): string | undefined {
  return (
    process.env.MCP_KV_HTTP_URL?.trim() ||
    process.env.MCP_KV_URL?.trim() ||
    undefined
  );
}

function ensureEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Нужна переменная окружения ${name}`);
  return v;
}

function attachMcpServers(opts: SdkAgentOptions): void {
  const servers: NonNullable<SdkAgentOptions["mcpServers"]> =
    opts.mcpServers ?? {};
  const kvUrlRaw = envMcpKv()?.replace(/\/$/, "") ?? "";
  const kvBearer =
    process.env.MCP_KV_HTTP_BEARER?.trim() ||
    process.env.MCP_KV_BEARER?.trim() ||
    process.env.MCP_KV_TOKEN?.trim();
  if (!kvUrlRaw) return;
  const envType = process.env.MCP_KV_HTTP_TYPE?.trim().toLowerCase();
  const forceLegacySse =
    process.env.MCP_KV_LEGACY_SSE_TRANSPORT?.trim().toLowerCase() === "true";
  const transport: "http" | "sse" =
    /mcp-kv\.ru/i.test(kvUrlRaw) && !forceLegacySse
      ? "http"
      : envType === "sse"
        ? "sse"
        : envType === "http"
          ? "http"
          : /\/sse\//i.test(kvUrlRaw)
            ? "sse"
            : "http";
  const headers: Record<string, string> = {};
  if (kvBearer) headers.Authorization = `Bearer ${kvBearer}`;
  servers["mcp_kv"] = {
    type: transport,
    url: kvUrlRaw,
    ...(Object.keys(headers).length ? { headers } : {}),
  };
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

function extractWordPressPublishedUrl(answer: string): string | undefined {
  const trimmed = answer.trim();
  const labeled = trimmed.match(
    /(?:URL|Ссылка|Permalink|link|permalink)\s*(?:на\s*(?:пост|страницу|запись))?\s*[:=]\s*(https?:\/\/[^\s)'"`<\[,\]]+)/iu,
  );
  if (labeled) return labeled[1].replace(/[.,;)\]]+$/, "").trim();
  const p = trimmed.match(/(https?:\/\/[^\s)'"`<\[,\]]*\?p=\d+)/iu);
  if (p) return p[1].replace(/[.,;)]+$/, "").trim();
  const pretty = trimmed.match(
    /(https?:\/\/[^\s)'"`<\[,\]]*\/(?:[\w-]+\/)*\d{4}\/\d{2}\/[\w-]+\/)/iu,
  );
  if (pretty) return pretty[1].replace(/[.,;)]+$/, "").trim();
  return undefined;
}

function extractPostId(answer: string): number | undefined {
  const m =
    answer.match(/(?:ID записи|post id|post_id|ID)\s*[:=]\s*(\d+)/iu) ||
    answer.match(/\?p=(\d+)/);
  if (m) return Number(m[1]);
  return undefined;
}

async function main(): Promise<void> {
  if (!envMcpKv())
    throw new Error("Задайте MCP_KV_HTTP_URL (или MCP_KV_URL) для MCP.");

  const statePath = pipelineStatePathForPublish();
  if (!existsSync(statePath))
    throw new Error(`Нет ${path.relative(ROOT, statePath)}`);

  const state = JSON.parse(readFileSync(statePath, "utf-8")) as PipelineState;
  if (!state.seoTitle?.trim() || !state.articleHtml?.trim()) {
    throw new Error(
      "В pipeline-state.json нет seoTitle или articleHtml — нечего публиковать.",
    );
  }

  const publishStatus =
    (process.env.WP_POST_STATUS || "publish").trim() || "publish";
  const postType = (process.env.WP_POST_TYPE || "posts").trim() || "posts";

  const featuredCandidate =
    process.env.FEATURED_IMAGE_URL?.trim() ||
    state.coverNanoPublicUrl ||
    DEFAULT_BANNER_IN_ARTICLE;

  const imagePack =
    state.imagePack ??
    ({
      filename: "cover_auto",
      title: state.seoTitle.trim(),
      alt: state.seoTitle.trim(),
      caption: state.seoTitle.trim(),
      info: state.metaDescription ?? "",
    } as Record<string, unknown>);

  const wpFinalPrompt = `# Только публикация в WordPress (без переписывания статьи)

TITLE:
${state.seoTitle}

EXCERPT / meta-description:
${state.metaDescription ?? ""}

HTML_POST:
${state.articleHtml}

## Обложечное изображение поста (featured)
Публичный URL до загрузки: ${featuredCandidate}
При необходимости сначала **wordpress_upload_image_from_url** / **wordpress_upload_media**, затем ID в **featured_media** при создании записи.

## Метапакета изображения (модуль Make 44)
${JSON.stringify(imagePack, null, 2)}

STATUS=${publishStatus} TYPE=${postType}

Если HTML очень большой — используй blob: **wordpress_content_blob_append** → **wordpress_create_post_from_blob**.

Итого в ответ обязательно: **ID записи** и **публичный URL** страницы, либо честный текст ошибки инструмента.

Используй только инструменты **wordpress_*** через MCP.`;

  const apiKey = ensureEnv("CURSOR_API_KEY");
  const modelId = ensureEnv("CURSOR_MODEL");

  const opts: SdkAgentOptions = {
    apiKey,
    model: { id: modelId },
    local: { cwd: ROOT },
  };
  attachMcpServers(opts);

  console.error("[wp-publish-mcp] ▶ Agent.prompt WordPress MCP");

  let raw = "";
  try {
    const result = await Agent.prompt(wpFinalPrompt, opts);
    raw = (result.result ?? "").trimEnd();
    if (result.status === "error") {
      console.error("[wp-publish-mcp] статус error от Agent.prompt");
      process.exitCode = 2;
    }
  } catch (e) {
    if (e instanceof CursorAgentError) {
      console.error(`[wp-publish-mcp] CursorAgentError: ${e.message}`);
      process.exit(1);
    }
    throw e;
  }

  state.wordpressPublishRaw = raw;
  state.wordpressPublishedUrl = extractWordPressPublishedUrl(raw);

  mkdirSync(ART, { recursive: true });
  writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");

  const postId = extractPostId(raw);

  console.log(
    JSON.stringify(
      {
        ok: Boolean(state.wordpressPublishedUrl),
        wordpressPublishedUrl: state.wordpressPublishedUrl ?? null,
        wordpressPostIdGuess: postId ?? null,
        statePath: path.relative(ROOT, statePath),
      },
      null,
      2,
    ),
  );

  if (!state.wordpressPublishedUrl)
    console.error(
      "[wp-publish-mcp] URL не распознан по ответу — см. wordpressPublishRaw в pipeline-state.json",
    );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
