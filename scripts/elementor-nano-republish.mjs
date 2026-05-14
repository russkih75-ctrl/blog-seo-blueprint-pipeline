/**
 * Полный цикл для Elementor-статьи: MCP nano → обложка + баннер → загрузка featured → update поста.
 *
 * Требует: MCP_KV_HTTP_URL, pipeline-state.json с articleHtml / seoTitle / wordpressPostId.
 *
 * npm run elementor:nano-republish
 */
import { config } from "dotenv";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
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

const reqTimeoutMs = Number(process.env.MCP_REQUEST_TIMEOUT_MS ?? "900000");

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

function nanoToolName() {
  const t =
    process.env.MCP_KV_NANO_TOOL?.trim() ||
    process.env.NANO_TOOL?.trim() ||
    "nano_banana_pro";
  if (t === "nano_banana_2" || t === "nano_banana_pro") return t;
  return /lite|2$/i.test(t) ? "nano_banana_2" : "nano_banana_pro";
}

function toolPayloadText(result) {
  return (
    result.content
      ?.filter((c) => c.type === "text")
      .map((c) => c.text.trim())
      .filter(Boolean)
      .join("\n") ?? ""
  );
}

/** Как в run-workflow-cloud.ts — достать URL картинки из ответа MCP/Kie */
function extractPublicImageUrl(answer) {
  const marker =
    /\b(?:PRIMARY_COVER_IMAGE_URL|MID_BANNER_IMAGE_URL|NANO_PUBLIC_IMAGE_URL|WP_MEDIA_PUBLIC_URL|IMAGE_URL)=(https?:\/\/\S+)/i;
  const linesRev = answer.split(/\n/).reverse();
  for (const ln of linesRev) {
    const mt = ln.trim().match(marker);
    if (mt) return mt[1].replace(/["'")\]]+$/, "").trim();
  }
  const all = [
    ...answer.matchAll(
      /https?:\/\/[^\s"'<>\][]+\.(png|jpg|jpeg|webp)(\?[^\s"'<>\][]*)?/gi,
    ),
  ].map((m) => m[0]);
  return all[all.length - 1]?.replace(/[,;.]$/, "").trim();
}

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
    fullText.match(/\bID:\s*(\d+)/iu) ||
    fullText.match(/"id"\s*:\s*(\d+)/) ||
    fullText.match(/media[_ ]?id\s*[:=]\s*(\d+)/iu);
  if (m) return Number(m[1]);
  return undefined;
}

function parseWpUploadPublicUrl(fullText) {
  const urlMatch = fullText.match(/\bURL:\s*(https?:\/\/\S+)/iu);
  return urlMatch
    ? urlMatch[1].replace(/["'")\];]+$/u, "").trim()
    : undefined;
}

/** Загрузка в медиатеку WP по публичному URL (nano tempfile и т.п.). */
async function uploadRemoteImageToWordPress(client, remoteUrl, fields) {
  const common = {
    title: fields.title,
    alt_text: fields.alt_text,
    caption: fields.caption,
    description: fields.description,
    post_id: fields.post_id,
  };
  let text = "";
  try {
    const up = await client.callTool(
      {
        name: "wordpress_upload_media",
        arguments: { file_url: remoteUrl, ...common },
      },
      undefined,
      { timeout: reqTimeoutMs },
    );
    text = toolPayloadText(up);
  } catch (e1) {
    console.error(
      "[elementor-nano] wordpress_upload_media:",
      e1 instanceof Error ? e1.message : e1,
    );
    const up2 = await client.callTool(
      {
        name: "wordpress_upload_image_from_url",
        arguments: { url: remoteUrl, ...common },
      },
      undefined,
      { timeout: reqTimeoutMs },
    );
    text = toolPayloadText(up2);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  const id = parseMediaId(text, parsed);
  const publicUrl = parseWpUploadPublicUrl(text);
  return { id, publicUrl, rawSnippet: text.slice(0, 2000) };
}

function nanoRefs() {
  const raw =
    process.env.NANO_IMAGE_INPUT_URLS?.trim() ||
    process.env.NANO_REFERENCE_IMAGE_URLS?.trim();
  if (!raw) return [];
  return raw
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter((x) => /^https?:\/\//i.test(x));
}

async function callNano(client, label, prompt, aspectRatio, outputFormat) {
  const tool = nanoToolName();
  const args = {
    prompt,
    aspect_ratio: aspectRatio,
    resolution: process.env.NANO_RESOLUTION?.trim().toUpperCase() || "2K",
    output_format: outputFormat,
  };
  const refs = nanoRefs();
  if (refs.length)
    args.image_input = refs.slice(0, tool === "nano_banana_2" ? 14 : 8);

  console.error(`[elementor-nano] ▶ ${tool} (${label}) aspect=${aspectRatio} …`);
  const res = await client.callTool(
    { name: tool, arguments: args },
    undefined,
    { timeout: reqTimeoutMs },
  );
  const text = toolPayloadText(res);
  const url = extractPublicImageUrl(text);
  if (!url)
    throw new Error(
      `[elementor-nano] Нет URL изображения в ответе ${label}. Ответ (начало): ${text.slice(0, 800)}`,
    );
  return { url, rawSnippet: text.slice(0, 4000) };
}

async function main() {
  const urlStr = envUrl();
  if (!urlStr) throw new Error("MCP_KV_HTTP_URL");

  const statePath = path.join(ART, "pipeline-state.json");
  if (!existsSync(statePath))
    throw new Error("artifacts/pipeline-state.json отсутствует");

  const state = JSON.parse(readFileSync(statePath, "utf-8"));
  const title =
    state.seoTitle?.trim() ||
    "Elementor для WordPress: конструктор страниц и баннер";
  const htmlIn = state.articleHtml?.trim();
  if (!htmlIn) throw new Error("В pipeline-state нет articleHtml");

  const envPid = process.env.WP_UPDATE_POST_ID?.trim();
  const fromEnv =
    envPid && /^\d+$/.test(envPid) ? Number(envPid) : Number.NaN;
  const postIdRaw =
    typeof state.wordpressPostId === "number" && state.wordpressPostId > 0
      ? state.wordpressPostId
      : Number.isFinite(fromEnv) && fromEnv > 0
        ? fromEnv
        : null;
  if (!postIdRaw || postIdRaw <= 0)
    throw new Error(
      "Нужен wordpressPostId в pipeline-state или WP_UPDATE_POST_ID в .env",
    );

  const transport = new StreamableHTTPClientTransport(new URL(urlStr), {
    requestInit: { headers: bearerHeaders() },
  });
  const client = new Client({
    name: "elementor-nano-republish",
    version: "1.0.0",
  });
  await client.connect(transport, { timeout: reqTimeoutMs });

  const outFmt =
    nanoToolName() === "nano_banana_2"
      ? process.env.NANO_OUTPUT_FORMAT?.trim()?.toLowerCase() === "png"
        ? "png"
        : "jpg"
      : process.env.NANO_OUTPUT_FORMAT?.trim()?.toLowerCase() === "jpg"
        ? "jpg"
        : "png";

  const coverPrompt =
    process.env.NANO_COVER_PROMPT?.trim() ||
    [
      "Профессиональная обложка статьи для блога про WordPress и Elementor.",
      "Стиль: чистый UI/UX, современный редактор страниц, сетка блоков, иконка конструктора.",
      "Текст на русском на обложке (короткий заголовок): «Elementor и WordPress».",
      "Без лиц реальных людей, без логотипов Telegram и без водяных знаков сторонних школ.",
      "Формат презентационный, как превью IT-статьи 2026.",
      `Контекст заголовка статьи: ${title.slice(0, 200)}`,
    ].join(" ");

  const bannerPrompt =
    process.env.NANO_BANNER_PROMPT?.trim() ||
    [
      "Широкий горизонтальный баннер для середины статьи про Elementor для WordPress.",
      "Соотношение широкое; композиция: монитор с интерфейсом редактора, блоки виджетов, аккуратная типографика.",
      "Нейтральный корпоративный стиль, без персон, без рекламных URL на изображении.",
      `Тема: ${title.slice(0, 180)}`,
    ].join(" ");

  const cover = await callNano(client, "cover", coverPrompt, "16:9", outFmt);
  const banner = await callNano(client, "banner", bannerPrompt, "21:9", outFmt);

  state.coverNanoPublicUrl = cover.url;
  state.bannerNanoPublicUrl = banner.url;
  state.midArticleBannerSrcUrl = banner.url;

  let htmlOut = htmlIn;
  if (htmlOut.includes("MID_IMG_URL_PLACEHOLDER")) {
    htmlOut = htmlOut.replaceAll("MID_IMG_URL_PLACEHOLDER", banner.url);
  } else {
    htmlOut = htmlOut.replace(
      /(<figure\b[^>]*>[\s\S]*?<img\b[^>]*\bsrc=")([^"]+)(")/i,
      (_, a, __src, c) => `${a}${banner.url}${c}`,
    );
  }

  state.nanoCoverRaw = cover.rawSnippet;
  state.nanoBannerRaw = banner.rawSnippet;

  let featuredMedia;
  const coverUp = await uploadRemoteImageToWordPress(client, cover.url, {
    title: `${title.slice(0, 100)} — обложка`,
    alt_text: title.slice(0, 180),
    caption: (state.metaDescription ?? "").slice(0, 300),
    post_id: postIdRaw,
  });
  featuredMedia = coverUp.id;
  state.wordpressFeaturedUploadRaw = coverUp.rawSnippet;
  if (coverUp.publicUrl) state.coverWordpressPublicUrl = coverUp.publicUrl;

  if (!featuredMedia)
    console.error(
      "[elementor-nano] Не удалось получить ID обложки после загрузки:",
      coverUp.rawSnippet.slice(0, 600),
    );

  let bannerUp = { id: undefined, publicUrl: undefined, rawSnippet: "" };
  try {
    bannerUp = await uploadRemoteImageToWordPress(client, banner.url, {
      title: `${title.slice(0, 90)} — баннер`,
      alt_text: "Иллюстрация: визуальный редактор страниц WordPress",
      caption: "",
      post_id: postIdRaw,
    });
  } catch (e) {
    console.error(
      "[elementor-nano] загрузка баннера в медиатеку:",
      e instanceof Error ? e.message : e,
    );
  }
  state.wordpressBannerUploadRaw = bannerUp.rawSnippet;
  if (bannerUp.publicUrl) {
    state.bannerWordpressPublicUrl = bannerUp.publicUrl;
    htmlOut = htmlOut.replaceAll(banner.url, bannerUp.publicUrl);
    state.midArticleBannerSrcUrl = bannerUp.publicUrl;
  }

  const updateArgs = {
    post_id: postIdRaw,
    title,
    content: htmlOut,
    excerpt: (state.metaDescription ?? "").slice(0, 500),
    status: (process.env.WP_POST_STATUS || "publish").trim() || "publish",
    post_type: (process.env.WP_POST_TYPE || "posts").trim() || "posts",
    ...(typeof featuredMedia === "number"
      ? { featured_media: featuredMedia }
      : {}),
  };

  const updated = await client.callTool(
    {
      name: "wordpress_update_post",
      arguments: updateArgs,
    },
    undefined,
    { timeout: reqTimeoutMs },
  );

  const updText = toolPayloadText(updated);
  state.wordpressPublishRaw = updText.slice(0, 120_000);
  state.articleHtml = htmlOut;

  if (typeof featuredMedia === "number") {
    try {
      await client.callTool(
        {
          name: "wordpress_set_featured_image",
          arguments: {
            post_id: postIdRaw,
            featured_media: featuredMedia,
            post_type: updateArgs.post_type,
          },
        },
        undefined,
        { timeout: reqTimeoutMs },
      );
    } catch {
      /* update_post уже мог установить обложку */
    }
  }

  mkdirSync(ART, { recursive: true });
  writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");

  await client.close();

  console.log(
    JSON.stringify(
      {
        ok: true,
        postId: postIdRaw,
        coverUrl: cover.url,
        bannerUrl: banner.url,
        featuredMediaId: featuredMedia ?? null,
        wordpressPublishedUrl: state.wordpressPublishedUrl ?? null,
        nanoTool: nanoToolName(),
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
  process.exit(1);
});
