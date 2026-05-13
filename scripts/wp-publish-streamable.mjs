/**
 * Публикация artifacts/pipeline-state.json в WordPress через MCP Streamable HTTP
 * (совместимо с mcp-kv.ru — legacy SSE POST там зависает).
 */
import { config } from "dotenv";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ART = path.join(ROOT, "artifacts");

config({ path: path.join(ROOT, ".env") });
const mcpKvDotenvRel = process.env.MCP_KV_DOTENV_PATH?.trim();
if (mcpKvDotenvRel)
  config({ path: path.resolve(ROOT, mcpKvDotenvRel), override: true });

const DEFAULT_BANNER =
  "https://mayai.ru/wp-content/uploads/2025/04/2025-04-14_08-52-43.jpg";

const reqTimeoutMs = Number(process.env.MCP_REQUEST_TIMEOUT_MS ?? "600000");

function envUrl() {
  return (
    process.env.MCP_KV_HTTP_URL?.trim() ||
    process.env.MCP_KV_URL?.trim() ||
    ""
  ).replace(/\/$/, "");
}

function bearerHeaders() {
  const bearer =
    process.env.MCP_KV_HTTP_BEARER?.trim() ||
    process.env.MCP_KV_BEARER?.trim() ||
    process.env.MCP_KV_TOKEN?.trim();
  const headers = {};
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  return headers;
}

function extractPublishedUrl(text) {
  const trimmed = text.trim();
  const ruUrl = trimmed.match(/URL:\s*(https?:\/\/[^\s<'"`[\]]+)/iu);
  if (ruUrl)
    return ruUrl[1].replace(/[.,;)\]]+$/, "").trim();
  const labeled = trimmed.match(
    /(?:URL|Ссылка|Permalink|link|permalink)\s*(?:на\s*(?:пост|страницу|запись))?\s*[:=]\s*(https?:\/\/[^\s)'"`[<,\]]+)/iu,
  );
  if (labeled)
    return labeled[1].replace(/[.,;)\]]+$/, "").trim();
  const p = trimmed.match(/(https?:\/\/[^\s)'"`[<,\]]*\?p=\d+)/iu);
  if (p) return p[1].replace(/[.,;)]+$/, "").trim();
  const pretty = trimmed.match(
    /(https?:\/\/[^\s)'"`[<,\]]*\/(?:[\w-]+\/)*\d{4}\/\d{2}\/[\w-]+\/?)/iu,
  );
  if (pretty) return pretty[1].replace(/[.,;)]+$/, "").trim();
  return undefined;
}

function extractPostId(text) {
  const m =
    text.match(/(?:ID записи|post id|post_id|ID)\s*[:=]\s*(\d+)/iu) ||
    text.match(/\?p=(\d+)/);
  if (m) return Number(m[1]);
  const j = text.match(/"id"\s*:\s*(\d+)/);
  if (j) return Number(j[1]);
  return undefined;
}

/** Текстовые блоки инструмента → объект или строка */
function toolPayloadText(result) {
  const texts =
    result.content
      ?.filter((c) => c.type === "text")
      .map((c) => c.text.trim())
      .filter(Boolean) ?? [];
  return texts.join("\n").trim();
}

/** Достать id медиа из ответа upload tool */
function parseMediaId(fullText, parsedJson) {
  if (parsedJson && typeof parsedJson === "object") {
    const id =
      parsedJson.id ??
      parsedJson.media_id ??
      parsedJson.data?.id ??
      parsedJson.media?.id;
    if (typeof id === "number") return id;
    if (typeof id === "string" && /^\d+$/.test(id)) return Number(id);
  }
  const m =
    fullText.match(/"id"\s*:\s*(\d+)/) ||
    fullText.match(/media[_ ]?id\s*[:=]\s*(\d+)/iu);
  if (m) return Number(m[1]);
  return undefined;
}

async function resolvePermalink(client, postId, title, postType) {
  const res = await client.callTool(
    {
      name: "wordpress_get_posts",
      arguments: {
        search: title.slice(0, 120),
        per_page: 25,
        post_type: postType,
        status: "publish",
      },
    },
    undefined,
    { timeout: reqTimeoutMs },
  );
  const text = toolPayloadText(res);
  const blocks = text.split(/\n\n+/);
  for (const block of blocks) {
    if (!block.includes(`ID: ${postId}`)) continue;
    const m = block.match(/URL:\s*(https?:\/\/[^\s<'"`[\]]+)/iu);
    if (m) return m[1].replace(/[.,;)]+$/, "").trim();
  }
  return undefined;
}

async function main() {
  const urlStr = envUrl();
  if (!urlStr) {
    console.error(JSON.stringify({ ok: false, error: "MCP_KV_HTTP_URL_missing" }));
    process.exit(1);
  }

  const statePath = path.join(ART, "pipeline-state.json");
  if (!existsSync(statePath)) {
    console.error(JSON.stringify({ ok: false, error: "pipeline_state_missing" }));
    process.exit(1);
  }

  const state = JSON.parse(readFileSync(statePath, "utf-8"));
  const title = state.seoTitle?.trim();
  const html = state.articleHtml?.trim();
  if (!title || !html) {
    console.error(JSON.stringify({ ok: false, error: "missing_title_or_html" }));
    process.exit(1);
  }

  const publishStatus =
    (process.env.WP_POST_STATUS || "publish").trim() || "publish";
  const postType = (process.env.WP_POST_TYPE || "posts").trim() || "posts";

  const featuredCandidate =
    process.env.FEATURED_IMAGE_URL?.trim() ||
    state.coverNanoPublicUrl ||
    DEFAULT_BANNER;

  const transport = new StreamableHTTPClientTransport(new URL(urlStr), {
    requestInit: { headers: bearerHeaders() },
  });
  const client = new Client({ name: "wp-publish-streamable", version: "1.0.0" });

  await client.connect(transport, { timeout: reqTimeoutMs });

  let featuredMedia;
  if (featuredCandidate?.startsWith("http")) {
    try {
      const up = await client.callTool(
        {
          name: "wordpress_upload_image_from_url",
          arguments: {
            url: featuredCandidate,
            title: title.slice(0, 120),
            alt_text: title.slice(0, 180),
            caption: (state.metaDescription ?? "").slice(0, 300),
          },
        },
        undefined,
        { timeout: reqTimeoutMs },
      );
      const upText = toolPayloadText(up);
      let parsed;
      try {
        parsed = JSON.parse(upText);
      } catch {
        parsed = undefined;
      }
      featuredMedia = parseMediaId(upText, parsed);
    } catch {
      featuredMedia = undefined;
    }
  }

  const createArgs = {
    title,
    content: html,
    excerpt: (state.metaDescription ?? "").slice(0, 500),
    status: publishStatus,
    post_type: postType,
    ...(typeof featuredMedia === "number" ? { featured_media: featuredMedia } : {}),
  };

  const created = await client.callTool(
    {
      name: "wordpress_create_post",
      arguments: createArgs,
    },
    undefined,
    { timeout: reqTimeoutMs },
  );

  const rawText = toolPayloadText(created);
  let parsedPost;
  try {
    parsedPost = JSON.parse(rawText);
  } catch {
    parsedPost = undefined;
  }

  const merged =
    rawText +
    "\n" +
    (parsedPost ? JSON.stringify(parsedPost, null, 2) : "");

  let wordpressPublishedUrl =
    extractPublishedUrl(merged) ??
    (typeof parsedPost?.link === "string" ? parsedPost.link : undefined);

  let wordpressPostIdGuess =
    extractPostId(merged) ??
    (typeof parsedPost?.id === "number" ? parsedPost.id : undefined);

  if (wordpressPostIdGuess && !wordpressPublishedUrl) {
    wordpressPublishedUrl = await resolvePermalink(
      client,
      wordpressPostIdGuess,
      title,
      postType,
    );
  }

  await client.close();

  state.wordpressPublishRaw = rawText.slice(0, 120_000);
  state.wordpressPublishedUrl = wordpressPublishedUrl;

  mkdirSync(ART, { recursive: true });
  writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");

  console.log(
    JSON.stringify(
      {
        ok: Boolean(wordpressPublishedUrl),
        wordpressPublishedUrl: wordpressPublishedUrl ?? null,
        wordpressPostIdGuess: wordpressPostIdGuess ?? null,
        featuredMediaId: featuredMedia ?? null,
        statePath: path.relative(ROOT, statePath),
      },
      null,
      2,
    ),
  );

  if (!wordpressPublishedUrl) process.exitCode = 2;
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
  process.exit(1);
});
