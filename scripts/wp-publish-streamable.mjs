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

/** Дефолтный баннер для скрипта публикации (нейтральный сток) */
const DEFAULT_BANNER =
  "";

const reqTimeoutMs = Number(process.env.MCP_REQUEST_TIMEOUT_MS ?? "600000");
const qualityConfigPath = path.join(ROOT, "config", "agent-orchestration.json");

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

function shouldRequirePermanentMedia(status) {
  return (
    String(process.env.WP_REQUIRE_PERMANENT_MEDIA ?? "").toLowerCase() ===
      "true" || status.toLowerCase() === "publish"
  );
}

function isPermanentWordpressOrCdnUrl(raw) {
  if (typeof raw !== "string" || !raw.trim()) return false;
  let u;
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

function writeMediaActionRequired(statePath, state, details) {
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
  writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
  return result;
}

/** Текстовые блоки инструмента → объект или строка */
function stripTags(html) {
  return String(html ?? "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countMatches(text, pattern) {
  return (String(text ?? "").match(pattern) ?? []).length;
}

function extractBlocks(html, tag) {
  const out = [];
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  let match;
  while ((match = re.exec(String(html ?? ""))) !== null) out.push(match[1] ?? "");
  return out;
}

function normalizeHeadingText(text) {
  return stripTags(text)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s:-]/gu, "")
    .trim();
}

function duplicateParagraphs(html) {
  const counts = new Map();
  for (const raw of extractBlocks(html, "p")) {
    const paragraph = stripTags(raw).toLowerCase().replace(/\s+/g, " ").trim();
    if (paragraph.length < 90) continue;
    counts.set(paragraph, (counts.get(paragraph) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([paragraph, count]) => ({ paragraph: paragraph.slice(0, 180), count }));
}

function thinSections(html, minChars) {
  const out = [];
  const re = /<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>([\s\S]*?)(?=<h[23]\b|$)/gi;
  let match;
  while ((match = re.exec(String(html ?? ""))) !== null) {
    const heading = normalizeHeadingText(match[1] ?? "");
    const chars = stripTags(match[2] ?? "").length;
    if (heading && chars < minChars) out.push({ heading, chars });
  }
  return out;
}

function imageIssues(html) {
  const issues = [];
  const re = /<img\b([^>]*?)>/gi;
  let match;
  let index = 0;
  while ((match = re.exec(String(html ?? ""))) !== null) {
    index += 1;
    const attrs = match[1] ?? "";
    const src = attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1]?.trim() ?? "";
    const alt = attrs.match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1]?.trim() ?? "";
    if (!/^https?:\/\//i.test(src)) issues.push({ index, code: "image_missing_http_src", severity: "blocker" });
    if (!alt || alt.length < 12) issues.push({ index, code: "image_missing_useful_alt", severity: "blocker" });
  }
  return issues;
}

function normalizedTokenSet(text) {
  return new Set(
    stripTags(text)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4),
  );
}

function keywordCoverageOk(state, html) {
  const source = [state.seeds?.k1, state.seeds?.k2, state.seeds?.k3, state.wordstatSynth]
    .filter(Boolean)
    .join(" ");
  const sourceTokens = [...normalizedTokenSet(source)].filter(
    (token) => !["wordpress", "wordprais"].includes(token),
  );
  if (sourceTokens.length === 0) return true;
  const titleAndHtml = normalizedTokenSet(`${state.seoTitle ?? ""} ${html}`);
  const covered = sourceTokens.filter((token) => titleAndHtml.has(token)).length;
  return covered >= Math.min(2, sourceTokens.length);
}

function metaOk(meta, min, max) {
  const text = stripTags(meta ?? "").replace(/\s+/g, " ").trim();
  return text.length >= min && text.length <= max && !/NEEDS_REWRITE|Lorem ipsum/i.test(text);
}

function loadQualityConfig() {
  try {
    if (!existsSync(qualityConfigPath)) return {};
    return JSON.parse(readFileSync(qualityConfigPath, "utf-8"));
  } catch {
    return {};
  }
}

function articleQualityFindings(html, state) {
  const cfg = loadQualityConfig();
  const hard = cfg.hardGates ?? {};
  const minChars = Number(hard.minimumFinalHtmlCharacters ?? 12000);
  const minHeadings = Number(hard.minimumContentHeadingsH2H3 ?? 8);
  const minH2 = Number(hard.minimumH2 ?? 7);
  const minH3 = Number(hard.minimumH3 ?? 3);
  const minParagraphs = Number(hard.minimumParagraphs ?? 24);
  const minInternalLinks = Number(hard.minimumInternalLinks ?? 4);
  const minArticleImages = Number(hard.minimumArticleImages ?? 1);
  const minJsonLdScripts = Number(hard.minimumJsonLdScripts ?? 1);
  const minUsefulSectionCharacters = Number(hard.minimumUsefulSectionCharacters ?? 180);
  const maxThinSections = Number(hard.maxThinSections ?? 1);
  const minFaqDetails = Number(hard.minimumFaqDetails ?? 5);
  const maxHumanizerSlopHits = Number(hard.maxHumanizerSlopHits ?? 3);
  const maxDuplicateHeadingOccurrences = Number(hard.maxDuplicateHeadingOccurrences ?? 1);
  const maxDuplicateParagraphOccurrences = Number(hard.maxDuplicateParagraphOccurrences ?? 1);
  const titleMinCharacters = Number(hard.titleMinCharacters ?? 45);
  const titleMaxCharacters = Number(hard.titleMaxCharacters ?? 120);
  const metaDescriptionMinCharacters = Number(hard.metaDescriptionMinCharacters ?? 90);
  const metaDescriptionMaxCharacters = Number(hard.metaDescriptionMaxCharacters ?? 170);
  const text = stripTags(html);
  const headings = countMatches(html, /<h[23]\b/gi);
  const h2 = countMatches(html, /<h2\b/gi);
  const h3 = countMatches(html, /<h3\b/gi);
  const paragraphs = countMatches(html, /<p\b/gi);
  const internalLinks = countMatches(html, /<a\b[^>]+href=["']https?:\/\/wordprais\.ru\//gi);
  const articleImages = countMatches(html, /<img\b/gi);
  const jsonLdScripts = countMatches(html, /<script\b[^>]+application\/ld\+json/gi);
  const details = countMatches(html, /<details\b/gi);
  const findings = [];

  if (text.length < minChars)
    findings.push({ code: "article_too_short", severity: "blocker", actual: text.length, expected: `>=${minChars}` });
  if (headings < minHeadings)
    findings.push({ code: "not_enough_h2_h3", severity: "blocker", actual: headings, expected: `>=${minHeadings}` });
  if (h2 < minH2)
    findings.push({ code: "not_enough_h2", severity: "blocker", actual: h2, expected: `>=${minH2}` });
  if (h3 < minH3)
    findings.push({ code: "not_enough_h3", severity: "blocker", actual: h3, expected: `>=${minH3}` });
  if (paragraphs < minParagraphs)
    findings.push({ code: "not_enough_paragraphs", severity: "blocker", actual: paragraphs, expected: `>=${minParagraphs}` });
  if (internalLinks < minInternalLinks)
    findings.push({ code: "not_enough_internal_links", severity: "blocker", actual: internalLinks, expected: `>=${minInternalLinks}` });
  if (articleImages < minArticleImages)
    findings.push({ code: "missing_article_images", severity: "blocker", actual: articleImages, expected: `>=${minArticleImages}` });
  if (jsonLdScripts < minJsonLdScripts)
    findings.push({ code: "missing_schema_json_ld", severity: "blocker", actual: jsonLdScripts, expected: `>=${minJsonLdScripts}` });
  if (/<h1\b/i.test(html))
    findings.push({ code: "h1_inside_post_body", severity: "blocker" });
  for (const marker of hard.requiredHtmlMarkers ?? []) {
    if (!String(html).includes(marker))
      findings.push({ code: "missing_html_marker", marker, severity: "blocker" });
  }
  const headingCounts = new Map();
  const headingRe = /<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/gi;
  let headingMatch;
  while ((headingMatch = headingRe.exec(String(html))) !== null) {
    const heading = stripTags(headingMatch[1] ?? "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[^\p{L}\p{N}\s:-]/gu, "")
      .trim();
    if (!heading) continue;
    headingCounts.set(heading, (headingCounts.get(heading) ?? 0) + 1);
  }
  for (const [heading, count] of headingCounts.entries()) {
    if (count > maxDuplicateHeadingOccurrences) {
      findings.push({
        code: "duplicate_h2_h3_heading",
        severity: "blocker",
        heading,
        actual: count,
        expected: `<=${maxDuplicateHeadingOccurrences}`,
      });
    }
  }
  for (const item of duplicateParagraphs(html)) {
    if (item.count > maxDuplicateParagraphOccurrences) {
      findings.push({
        code: "duplicate_paragraph",
        severity: "blocker",
        paragraph: item.paragraph,
        actual: item.count,
        expected: `<=${maxDuplicateParagraphOccurrences}`,
      });
    }
  }
  const thin = thinSections(html, minUsefulSectionCharacters);
  if (thin.length > maxThinSections) {
    findings.push({
      code: "too_many_thin_sections",
      severity: "blocker",
      actual: thin.length,
      expected: `<=${maxThinSections}`,
      examples: thin.slice(0, 5),
    });
  }
  for (const generic of hard.forbiddenGenericHeadings ?? []) {
    const needle = normalizeHeadingText(generic);
    const hasGeneric = extractBlocks(html, "h2")
      .concat(extractBlocks(html, "h3"))
      .map(normalizeHeadingText)
      .some((heading) => heading === needle || heading.includes(needle));
    if (hasGeneric) findings.push({ code: "generic_heading_forbidden", heading: generic, severity: "blocker" });
  }
  for (const issue of imageIssues(html)) findings.push(issue);
  const titleLength = stripTags(state.seoTitle ?? "").length;
  if (titleLength < titleMinCharacters || titleLength > titleMaxCharacters) {
    findings.push({
      code: "invalid_seo_title_length",
      severity: "blocker",
      actual: titleLength,
      expected: `${titleMinCharacters}-${titleMaxCharacters}`,
    });
  }
  if (!metaOk(state.metaDescription, metaDescriptionMinCharacters, metaDescriptionMaxCharacters)) {
    findings.push({
      code: "invalid_meta_description",
      severity: "blocker",
      actual: stripTags(state.metaDescription ?? "").length,
      expected: `${metaDescriptionMinCharacters}-${metaDescriptionMaxCharacters}`,
    });
  }
  if (!keywordCoverageOk(state, html))
    findings.push({ code: "primary_keyword_not_covered", severity: "blocker" });
  if (details < minFaqDetails)
    findings.push({ code: "faq_details_too_few", severity: "blocker", actual: details, expected: `>=${minFaqDetails}` });
  if (!/border-collapse\s*:\s*collapse/i.test(html))
    findings.push({ code: "table_without_border_collapse", severity: "blocker" });
  if (!/padding\s*:\s*11px\s+14px/i.test(html))
    findings.push({ code: "table_without_required_cell_padding", severity: "blocker" });
  for (const marker of hard.forbiddenHtmlMarkers ?? []) {
    if (String(html).toLowerCase().includes(String(marker).toLowerCase())) {
      findings.push({ code: "forbidden_html_marker", marker, severity: "blocker" });
    }
  }
  const slopHits = (hard.humanizerSlopMarkers ?? []).filter((marker) =>
    text.toLowerCase().includes(String(marker).toLowerCase()),
  );
  if (slopHits.length > maxHumanizerSlopHits) {
    findings.push({
      code: "humanizer_slop_markers_too_many",
      severity: "blocker",
      actual: slopHits.length,
      expected: `<=${maxHumanizerSlopHits}`,
      markers: slopHits,
    });
  }

  const quality = state.qualityGates ?? state.qa ?? {};
  for (const stage of cfg.requiredStages ?? []) {
    if (!stage.required) continue;
    const field = stage.artifactField;
    if (field && quality[field] !== true && state[field] !== true) {
      findings.push({ code: "required_stage_missing", stage: stage.id, field, severity: "blocker" });
    }
  }
  if (state.contentStructureDirectorPassed !== true && quality.contentStructureDirectorPassed !== true) {
    findings.push({ code: "content_structure_director_missing", severity: "blocker" });
  }

  return {
    ok: findings.length === 0,
    textCharacters: text.length,
    h2h3Count: headings,
    detailsCount: details,
    findings,
  };
}

function writeQualityActionRequired(statePath, state, quality) {
  const result = {
    ok: false,
    actionRequired: "rewrite_article_with_content_structure_director",
    reason: "publish_blocked_article_quality_gate",
    ...quality,
  };
  state.qualityResult = result;
  state.keywordStatus = "pending";
  state.publishBlocked = true;
  mkdirSync(ART, { recursive: true });
  writeFileSync(path.join(ART, "qa-report.json"), JSON.stringify(result, null, 2), "utf-8");
  writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
  return result;
}

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
    fullText.match(/\bID:\s*(\d+)/iu) ||
    fullText.match(/"id"\s*:\s*(\d+)/) ||
    fullText.match(/media[_ ]?id\s*[:=]\s*(\d+)/iu);
  if (m) return Number(m[1]);
  return undefined;
}

function parseMediaPublicUrl(fullText, parsedJson) {
  if (parsedJson && typeof parsedJson === "object") {
    const url =
      parsedJson.source_url ??
      parsedJson.url ??
      parsedJson.link ??
      parsedJson.guid?.rendered ??
      parsedJson.data?.source_url ??
      parsedJson.media?.source_url;
    if (typeof url === "string" && /^https?:\/\//i.test(url)) return url.trim();
  }
  const m =
    fullText.match(/\b(?:URL|source_url|link)\s*[:=]\s*(https?:\/\/[^\s"'<>\][]+)/iu) ||
    fullText.match(/"source_url"\s*:\s*"([^"]+)"/i) ||
    fullText.match(/"url"\s*:\s*"([^"]+)"/i);
  return m?.[1]?.replace(/["'")\];,]+$/u, "").trim();
}

/** Ответ wordpress_content_blob_append — извлечь blob_id */
function parseBlobIdFromAppend(text) {
  const m = String(text ?? "").match(/\bblob_id\s*:\s*(\S+)/iu);
  return m ? m[1].trim() : undefined;
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

async function uploadMediaFromUrl(client, url, fields) {
  const common = {
    title: fields.title.slice(0, 120),
    alt_text: fields.alt_text.slice(0, 180),
    caption: fields.caption.slice(0, 300),
  };
  try {
    const up = await client.callTool(
      {
        name: "wordpress_upload_media",
        arguments: { file_url: url, ...common },
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
    const id = parseMediaId(upText, parsed);
    const publicUrl = parseMediaPublicUrl(upText, parsed);
    if (typeof id === "number") return { id, publicUrl };
  } catch {
    /* fallback ниже */
  }
  try {
    const up2 = await client.callTool(
      {
        name: "wordpress_upload_image_from_url",
        arguments: { url, ...common },
      },
      undefined,
      { timeout: reqTimeoutMs },
    );
    const upText2 = toolPayloadText(up2);
    let parsed2;
    try {
      parsed2 = JSON.parse(upText2);
    } catch {
      parsed2 = undefined;
    }
    return {
      id: parseMediaId(upText2, parsed2),
      publicUrl: parseMediaPublicUrl(upText2, parsed2),
    };
  } catch {
    return undefined;
  }
}

async function uploadFeaturedFromUrl(client, url, title, excerpt) {
  return uploadMediaFromUrl(client, url, {
    title,
    alt_text: title,
    caption: excerpt,
  });
}

function existingMedia(state, prefix) {
  const id =
    state[`${prefix}WordpressMediaId`] ??
    state[`${prefix}WordPressMediaId`] ??
    state[`${prefix}MediaId`];
  const publicUrl =
    state[`${prefix}WordpressPublicUrl`] ??
    state[`${prefix}WordPressPublicUrl`];
  return {
    id:
      typeof id === "number"
        ? id
        : typeof id === "string" && /^\d+$/.test(id)
          ? Number(id)
          : undefined,
    publicUrl: typeof publicUrl === "string" ? publicUrl : undefined,
  };
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

  const quality = articleQualityFindings(html, state);
  if (!quality.ok) {
    const result = writeQualityActionRequired(statePath, state, quality);
    console.error(JSON.stringify(result, null, 2));
    process.exit(4);
  }

  const persistContentRunId = () => {
    const crid = process.env.CONTENT_RUN_ID?.trim();
    if (!crid) return;
    state.contentRunId = crid;
    mkdirSync(ART, { recursive: true });
    writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
  };

  const forcePublish = process.env.WP_PUBLISH_FORCE === "true";
  const existingUrl = state.wordpressPublishedUrl?.trim();
  if (!forcePublish && existingUrl?.startsWith("http")) {
    persistContentRunId();
    console.log(
      JSON.stringify(
        {
          ok: true,
          skipped: true,
          reason: "already_published",
          wordpressPublishedUrl: existingUrl,
          wordpressPostId: state.wordpressPostId ?? null,
          hint: "Задайте WP_PUBLISH_FORCE=true, чтобы создать ещё один пост.",
        },
        null,
        2,
      ),
    );
    return;
  }

  const publishStatus =
    (process.env.WP_POST_STATUS || "publish").trim() || "publish";
  const postType = (process.env.WP_POST_TYPE || "posts").trim() || "posts";

  const requirePermanentMedia = shouldRequirePermanentMedia(publishStatus);
  const featuredCandidate = requirePermanentMedia
    ? state.coverNanoPublicUrl
    : process.env.FEATURED_IMAGE_URL?.trim() ||
      state.coverNanoPublicUrl ||
      DEFAULT_BANNER;

  const transport = new StreamableHTTPClientTransport(new URL(urlStr), {
    requestInit: { headers: bearerHeaders() },
  });
  const client = new Client({ name: "wp-publish-streamable", version: "1.0.0" });

  await client.connect(transport, { timeout: reqTimeoutMs });

  let coverMedia = existingMedia(state, "cover");
  let bannerMedia = existingMedia(state, "banner");

  if (featuredCandidate?.startsWith("http")) {
    try {
      coverMedia = (await uploadFeaturedFromUrl(
        client,
        featuredCandidate,
        title,
        state.metaDescription ?? "",
      )) ?? coverMedia;
      if (typeof coverMedia.id === "number") state.coverWordpressMediaId = coverMedia.id;
      if (coverMedia.publicUrl) state.coverWordpressPublicUrl = coverMedia.publicUrl;
    } catch {
      coverMedia = existingMedia(state, "cover");
    }
  }

  const bannerCandidate = state.bannerNanoPublicUrl;
  if (bannerCandidate?.startsWith("http")) {
    try {
      bannerMedia = (await uploadMediaFromUrl(client, bannerCandidate, {
        title: `${title} banner`,
        alt_text: title,
        caption: "",
      })) ?? bannerMedia;
      if (typeof bannerMedia.id === "number") state.bannerWordpressMediaId = bannerMedia.id;
      if (bannerMedia.publicUrl) {
        state.bannerWordpressPublicUrl = bannerMedia.publicUrl;
        state.midArticleBannerSrcUrl = bannerMedia.publicUrl;
      }
    } catch {
      bannerMedia = existingMedia(state, "banner");
    }
  }

  if (requirePermanentMedia) {
    const coverOk =
      typeof coverMedia.id === "number" &&
      isPermanentWordpressOrCdnUrl(coverMedia.publicUrl);
    const bannerOk =
      typeof bannerMedia.id === "number" &&
      isPermanentWordpressOrCdnUrl(bannerMedia.publicUrl);
    if (!coverOk || !bannerOk) {
      await client.close();
      const result = writeMediaActionRequired(statePath, state, {
        missing: {
          cover16x9: !coverOk,
          banner21x9: !bannerOk,
        },
        cover: {
          generatedUrl: state.coverNanoPublicUrl ?? null,
          wordpressMediaId: coverMedia.id ?? null,
          wordpressPublicUrl: coverMedia.publicUrl ?? null,
        },
        banner: {
          generatedUrl: state.bannerNanoPublicUrl ?? null,
          wordpressMediaId: bannerMedia.id ?? null,
          wordpressPublicUrl: bannerMedia.publicUrl ?? null,
        },
        statePath: path.relative(ROOT, statePath),
        mediaResultPath: path.relative(ROOT, path.join(ART, "media-result.json")),
      });
      console.error(JSON.stringify(result, null, 2));
      process.exitCode = 3;
      return;
    }
  }

  const htmlForPublish =
    bannerMedia.publicUrl && state.bannerNanoPublicUrl
      ? html.replaceAll(state.bannerNanoPublicUrl, bannerMedia.publicUrl)
      : html;
  if (htmlForPublish !== html) state.articleHtml = htmlForPublish;

  const excerpt = (state.metaDescription ?? "").slice(0, 500);
  const blobHalvesPath = process.env.WP_BLOB_HALVES_JSON?.trim();
  let created;
  if (blobHalvesPath && existsSync(blobHalvesPath)) {
    const halves = JSON.parse(readFileSync(blobHalvesPath, "utf-8"));
    const h1Path = path.resolve(ROOT, String(halves.half1 ?? ""));
    const h2Path = path.resolve(ROOT, String(halves.half2 ?? ""));
    const chunk1 = readFileSync(h1Path, "utf-8");
    const chunk2 = readFileSync(h2Path, "utf-8");
    if (chunk1 + chunk2 !== htmlForPublish) {
      await client.close();
      console.error(
        JSON.stringify({
          ok: false,
          error: "WP_BLOB_HALVES_JSON_concat_mismatch",
          hint: "half1+half2 must equal article HTML after banner URL substitution",
        }),
      );
      process.exitCode = 5;
      return;
    }
    const append1 = await client.callTool(
      {
        name: "wordpress_content_blob_append",
        arguments: { reset: true, chunk: chunk1, finalize: false },
      },
      undefined,
      { timeout: reqTimeoutMs },
    );
    const t1 = toolPayloadText(append1);
    const blobId = parseBlobIdFromAppend(t1);
    if (!blobId) {
      await client.close();
      console.error(
        JSON.stringify({
          ok: false,
          error: "wordpress_content_blob_append_missing_blob_id",
          snippet: t1.slice(0, 800),
        }),
      );
      process.exitCode = 5;
      return;
    }
    const append2 = await client.callTool(
      {
        name: "wordpress_content_blob_append",
        arguments: { blob_id: blobId, chunk: chunk2, finalize: true },
      },
      undefined,
      { timeout: reqTimeoutMs },
    );
    const t2 = toolPayloadText(append2);
    if (!/sha256|финализ|finalize/i.test(t2)) {
      console.warn(
        `[wp-publish-streamable] blob finalize: unexpected response (first 400 chars): ${t2.slice(0, 400)}`,
      );
    }
    created = await client.callTool(
      {
        name: "wordpress_create_post_from_blob",
        arguments: {
          blob_id: blobId,
          title,
          excerpt,
          status: publishStatus,
          post_type: postType,
          ...(typeof coverMedia.id === "number" ? { featured_media: coverMedia.id } : {}),
        },
      },
      undefined,
      { timeout: reqTimeoutMs },
    );
  } else {
    const createArgs = {
      title,
      content: htmlForPublish,
      excerpt,
      status: publishStatus,
      post_type: postType,
      ...(typeof coverMedia.id === "number" ? { featured_media: coverMedia.id } : {}),
    };
    created = await client.callTool(
      {
        name: "wordpress_create_post",
        arguments: createArgs,
      },
      undefined,
      { timeout: reqTimeoutMs },
    );
  }

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
  if (wordpressPostIdGuess != null)
    state.wordpressPostId = wordpressPostIdGuess;

  mkdirSync(ART, { recursive: true });
  const crid = process.env.CONTENT_RUN_ID?.trim();
  if (crid) state.contentRunId = crid;
  writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");

  console.log(
    JSON.stringify(
      {
        ok: Boolean(wordpressPublishedUrl),
        wordpressPublishedUrl: wordpressPublishedUrl ?? null,
        wordpressPostIdGuess: wordpressPostIdGuess ?? null,
        featuredMediaId: coverMedia.id ?? null,
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
