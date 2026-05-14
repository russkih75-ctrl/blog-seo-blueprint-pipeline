/**
 * Fallback-публикация: WordPress REST API —
 * − из artifacts/pipeline-state.json (workflow:cloud), или
 * − из каталога Content Factory (WP_PUBLISH_CF_RUN_ID + article.md ↔ HTML).
 *
 * Переменные: WORDPRESS_BASE_URL, WORDPRESS_USERNAME, WORDPRESS_APPLICATION_PASSWORD.
 * Опции: WP_PUBLISH_SOURCE=pipeline | cf-run, WP_PUBLISH_CF_RUN_ID=run_…
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";

const ROOT = path.resolve(import.meta.dirname, "..");
loadEnv({ path: path.join(ROOT, ".env") });

interface PipelineState {
  seoTitle?: string;
  metaDescription?: string;
  articleHtml?: string;
}

interface SeoDoc {
  title?: string;
  metaDescription?: string;
  slug?: string;
}

function ensureEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Нужна переменная окружения ${name}`);
  return v;
}

function normalizeBaseUrl(raw: string): string {
  return raw.replace(/\/+$/u, "");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Убирает TOC после заголовка «Оглавление» до следующего ##. */
function stripTableOfContents(md: string): string {
  const re = /^## Оглавление\s*\n(?:[\s\S]*?)(?=^## \S)/mu;
  return md.replace(re, "").trimStart();
}

function stripHeadingAnchors(s: string): string {
  return s.replace(/\s*\{#[^}]+\}\s*/gu, " ").trimEnd();
}

function formatInlineMarkdown(text: string): string {
  const esc = escapeHtml(text);
  return esc.replace(/\*\*([^*]+)\*\*/gu, "<strong>$1</strong>");
}

function parseMarkdownTableCells(line: string): string[] {
  const s = line.trim();
  const core = s.startsWith("|") ? s.slice(1) : s;
  const trimmed = core.endsWith("|") ? core.slice(0, -1) : core;
  return trimmed.split("|").map((c) => c.trim());
}

function isDelimiterMarkdownTableRow(line: string): boolean {
  const cells = parseMarkdownTableCells(line);
  return (
    cells.length > 0 &&
    cells.every((c) => /^:?-{3,}:?$/.test(c.trim().replace(/\s/gu, "")))
  );
}

function markdownTableRowsToHtml(rows: readonly string[]): string {
  const bodyRows = rows.filter((r) => !isDelimiterMarkdownTableRow(r));
  if (!bodyRows.length) return "";
  const matrices = bodyRows.map(parseMarkdownTableCells);
  const width = matrices[0]?.length ?? 0;
  if (!width || matrices.some((m: string[]) => m.length !== width)) {
    const plain = escapeHtml(bodyRows.join("\n"));
    return `<pre>${plain}</pre>`;
  }

  let out = `<table>\n<thead>\n<tr>`;
  for (const cell of matrices[0]!)
    out += `<th>${formatInlineMarkdown(cell)}</th>`;
  out += `</tr>\n</thead>\n<tbody>`;
  for (let r = 1; r < matrices.length; r++) {
    out += `\n<tr>`;
    for (const cell of matrices[r]!) out += `<td>${formatInlineMarkdown(cell)}</td>`;
    out += `</tr>`;
  }
  out += `\n</tbody>\n</table>`;
  return out;
}

/** Достаточно для статей CF: заголовки, таблицы, абзацы, списки, **жирное**. */
function simpleMarkdownToHtml(md: string): string {
  const cleaned = stripHeadingAnchors(stripTableOfContents(md.trim()));

  /** Разбиваем на блоки по пустым строкам, кроме многострочных списков */
  const lines = cleaned.split(/\r?\n/);
  const blocks: string[] = [];
  let buf: string[] = [];
  const flushParagraph = (): void => {
    if (!buf.length) return;
    const t = buf.join(" ").trim();
    if (t) blocks.push(`<p>${formatInlineMarkdown(t)}</p>`);
    buf = [];
  };

  let inList = false;
  let listLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();

    if (trimmed.startsWith("|")) {
      flushParagraph();
      if (inList && listLines.length) {
        blocks.push("<ul>");
        for (const l of listLines)
          blocks.push(`<li>${formatInlineMarkdown(l)}</li>`);
        blocks.push("</ul>");
        listLines = [];
        inList = false;
      }
      const tbl: string[] = [];
      let j = i;
      while (j < lines.length && lines[j]!.trim().startsWith("|")) {
        tbl.push(lines[j]!);
        j++;
      }
      i = j - 1;
      const htmlTbl = markdownTableRowsToHtml(tbl);
      if (htmlTbl) blocks.push(htmlTbl);
      continue;
    }

    const h1 = trimmed.match(/^#\s+(.+)/u);
    const h2 = trimmed.match(/^##\s+(.+)/u);
    const h3 = trimmed.match(/^###\s+(.+)/u);

    const li = trimmed.match(/^[-*]\s+(.+)/u);

    if (h1 || h2 || h3) {
      if (inList) {
        blocks.push("<ul>");
        for (const l of listLines) {
          blocks.push(`<li>${formatInlineMarkdown(l)}</li>`);
        }
        blocks.push("</ul>");
        listLines = [];
        inList = false;
      }
      flushParagraph();
      const raw = stripHeadingAnchors(h1?.[1] ?? h2?.[1] ?? h3?.[1] ?? "");
      const tag = h1 ? "h1" : h3 ? "h3" : "h2";
      blocks.push(`<${tag}>${formatInlineMarkdown(raw.trim())}</${tag}>`);
      continue;
    }

    if (li) {
      flushParagraph();
      inList = true;
      listLines.push(li[1]!.trim());
      continue;
    }

    if (inList && trimmed === "") {
      blocks.push("<ul>");
      for (const l of listLines) blocks.push(`<li>${formatInlineMarkdown(l)}</li>`);
      blocks.push("</ul>");
      listLines = [];
      inList = false;
      continue;
    }

    if (inList && !li && trimmed !== "") {
      blocks.push("<ul>");
      for (const l of listLines) blocks.push(`<li>${formatInlineMarkdown(l)}</li>`);
      blocks.push("</ul>");
      listLines = [];
      inList = false;
      buf.push(trimmed);
      continue;
    }

    if (trimmed === "") {
      flushParagraph();
      continue;
    }

    buf.push(trimmed);
  }

  if (inList && listLines.length) {
    blocks.push("<ul>");
    for (const l of listLines) blocks.push(`<li>${formatInlineMarkdown(l)}</li>`);
    blocks.push("</ul>");
  }
  flushParagraph();

  /** Табличные блоки — как текстовые абзацы, если есть | но не распознано */
  return blocks.join("\n");
}

function loadCfRunPayload(runId: string): {
  title: string;
  excerpt: string;
  html: string;
  slug?: string;
} {
  const runDir = path.join(ROOT, "artifacts", "content-runs", runId);
  const mdPath = path.join(runDir, "article.md");
  const seoPath = path.join(runDir, "seo.json");
  if (!existsSync(mdPath) || !existsSync(seoPath))
    throw new Error(
      `Не найдены article.md или seo.json в artifacts/content-runs/${runId}/`,
    );
  const seo = JSON.parse(readFileSync(seoPath, "utf-8")) as SeoDoc;
  const md = readFileSync(mdPath, "utf-8");
  const title = seo.title?.trim();
  const excerpt =
    seo.metaDescription?.trim().slice(0, 240) ?? title?.slice(0, 240) ?? "";
  if (!title) throw new Error("В seo.json пустое title для CF-прогона");
  const html = simpleMarkdownToHtml(md);
  return { title, excerpt, html, slug: seo.slug?.trim() };
}

function loadPipelinePayload(): { title: string; excerpt: string; html: string } {
  const statePath = path.join(ROOT, "artifacts", "pipeline-state.json");
  const state = JSON.parse(readFileSync(statePath, "utf-8")) as PipelineState;
  if (!state.seoTitle?.trim() || !state.articleHtml?.trim())
    throw new Error(
      "В pipeline-state.json нет seoTitle или articleHtml — сначала npm run workflow:cloud",
    );
  const excerpt =
    state.metaDescription?.trim().slice(0, 240) ??
    state.seoTitle.trim().slice(0, 240);
  return {
    title: state.seoTitle.trim(),
    excerpt,
    html: state.articleHtml.trim(),
  };
}

async function main(): Promise<void> {
  const base = normalizeBaseUrl(ensureEnv("WORDPRESS_BASE_URL"));
  const user = ensureEnv("WORDPRESS_USERNAME");
  const appPass = ensureEnv("WORDPRESS_APPLICATION_PASSWORD");

  const source = (
    process.env.WP_PUBLISH_SOURCE?.trim().toLowerCase() || "pipeline"
  ).toLowerCase();

  let title: string;
  let excerpt: string;
  let html: string;
  let slug: string | undefined;

  if (source === "cf-run") {
    const runId = process.env.WP_PUBLISH_CF_RUN_ID?.trim();
    if (!runId)
      throw new Error(
        "Для WP_PUBLISH_SOURCE=cf-run задайте WP_PUBLISH_CF_RUN_ID (например run_2026-…)",
      );
    const p = loadCfRunPayload(runId);
    title = p.title;
    excerpt = p.excerpt;
    html = p.html;
    slug = p.slug;
  } else {
    const p = loadPipelinePayload();
    title = p.title;
    excerpt = p.excerpt;
    html = p.html;
  }

  const status = (process.env.WP_REST_POST_STATUS || "publish").trim() || "publish";

  const url = `${base}/wp-json/wp/v2/posts`;
  const auth = Buffer.from(`${user}:${appPass}`, "utf-8").toString("base64");
  const bodyJson: Record<string, unknown> = {
    title,
    content: html,
    excerpt,
    status,
  };
  if (slug) bodyJson.slug = slug.replace(/^\/+|\/+$/gu, "").slice(0, 190);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(bodyJson),
  });

  const text = await res.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    console.error(text);
    throw new Error(`REST ответ не JSON, HTTP ${res.status}`);
  }

  if (!res.ok) {
    console.error(JSON.stringify(body, null, 2));
    throw new Error(`WordPress REST: HTTP ${res.status}`);
  }

  const link = typeof body.link === "string" ? body.link : undefined;
  const id = typeof body.id === "number" ? body.id : undefined;

  mkdirSync(path.join(ROOT, "artifacts"), { recursive: true });
  const report = {
    ok: true,
    httpStatus: res.status,
    wordpressPostId: id,
    publishedUrl: link,
    title,
    source,
    wpPublishCfRunId: source === "cf-run" ? process.env.WP_PUBLISH_CF_RUN_ID : undefined,
    at: new Date().toISOString(),
  };
  writeFileSync(
    path.join(ROOT, "artifacts", "wp-rest-publish-result.json"),
    JSON.stringify(report, null, 2),
    "utf-8",
  );

  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
