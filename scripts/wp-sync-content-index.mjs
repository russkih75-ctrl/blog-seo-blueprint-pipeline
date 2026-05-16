#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ART = path.join(ROOT, "artifacts");
const INDEX_PATH = path.join(ART, "content-index.json");
const REPORT_PATH = path.join(ART, "wp-content-index-sync.json");
const SITE = (process.env.WP_PUBLIC_SITE_URL || "https://wordprais.ru").replace(/\/+$/, "");

function stripHtml(value) {
  return String(value ?? "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#8212;|&mdash;/gi, " ")
    .replace(/&#8211;|&ndash;/gi, " ")
    .replace(/&#171;|&laquo;/gi, " ")
    .replace(/&#187;|&raquo;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeFingerprint(text) {
  return stripHtml(text)
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalTopicKey(text) {
  const tokens = normalizeFingerprint(text)
    .split(/\s+/)
    .filter(Boolean);
  const set = new Set(tokens);
  if (set.has("wordpress") && set.has("заказать")) return "wordpress заказать сайт";
  if (set.has("wordpress") && (set.has("разработка") || set.has("разработать"))) return "wordpress разработка сайта";
  if (set.has("wordpress") && set.has("elementor")) return "wordpress elementor";
  if (set.has("wordpress") && (set.has("взлом") || set.has("восстановление") || set.has("чистка"))) {
    return "wordpress взлом восстановление";
  }
  const weak = new Set([
    "на",
    "для",
    "под",
    "без",
    "как",
    "что",
    "это",
    "или",
    "и",
    "в",
    "с",
    "по",
    "до",
    "от",
    "при",
    "2026",
    "году",
    "сайт",
    "сайта",
    "сайты",
  ]);
  const strong = tokens.filter((token) => !weak.has(token));
  return (strong.length ? strong : tokens).slice(0, 4).join(" ");
}

function readJsonSafe(file, fallback) {
  try {
    if (!existsSync(file)) return fallback;
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), "utf-8");
  renameSync(tmp, file);
}

async function fetchPublishedPosts() {
  const posts = [];
  for (let page = 1; page <= 10; page += 1) {
    const url = `${SITE}/wp-json/wp/v2/posts?per_page=100&page=${page}&status=publish&_fields=id,date,link,slug,title`;
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (res.status === 400 && page > 1) break;
    if (!res.ok) throw new Error(`WordPress REST HTTP ${res.status}`);
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    posts.push(...batch);
    const totalPages = Number(res.headers.get("x-wp-totalpages") ?? "1");
    if (page >= totalPages) break;
  }
  return posts;
}

function mergeEntries(existing, posts) {
  const byKey = new Map();
  for (const entry of existing) {
    const key = entry.postId ? `id:${entry.postId}` : entry.publicUrl ? `url:${entry.publicUrl}` : undefined;
    if (key) byKey.set(key, entry);
  }

  let added = 0;
  let updated = 0;
  for (const post of posts) {
    const title = stripHtml(post.title?.rendered ?? post.title ?? "");
    const publicUrl = String(post.link ?? "").trim();
    const key = `id:${post.id}`;
    const current = byKey.get(key) ?? {};
    const next = {
      ...current,
      source: current.source ?? "wordpress_rest_sync",
      postId: Number(post.id),
      publicUrl,
      title,
      titleNorm: normalizeFingerprint(title),
      slug: String(post.slug ?? current.slug ?? ""),
      canonicalTopicKey: canonicalTopicKey(title),
      status: "published_verified",
      keywordState: "processed",
      syncedFromWordPressAt: new Date().toISOString(),
      publishedAt: post.date ?? current.publishedAt ?? null,
    };
    if (byKey.has(key)) updated += 1;
    else added += 1;
    byKey.set(key, next);
  }

  return { entries: [...byKey.values()], added, updated };
}

async function main() {
  const existing = readJsonSafe(INDEX_PATH, { version: 1, entries: [] });
  const posts = await fetchPublishedPosts();
  const merged = mergeEntries(Array.isArray(existing.entries) ? existing.entries : [], posts);
  const index = {
    version: 1,
    entries: merged.entries,
    syncedFromWordPressAt: new Date().toISOString(),
  };
  const topicCounts = new Map();
  for (const entry of index.entries) {
    if (!entry.canonicalTopicKey) continue;
    topicCounts.set(entry.canonicalTopicKey, (topicCounts.get(entry.canonicalTopicKey) ?? 0) + 1);
  }
  const duplicateTopicKeys = [...topicCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([topicKey, count]) => ({ topicKey, count }));
  const report = {
    ok: true,
    site: SITE,
    fetchedPublishedPosts: posts.length,
    added: merged.added,
    updated: merged.updated,
    totalIndexEntries: index.entries.length,
    duplicateTopicKeys,
    indexPath: path.relative(ROOT, INDEX_PATH),
    checkedAt: new Date().toISOString(),
  };
  writeJsonAtomic(INDEX_PATH, index);
  writeJsonAtomic(REPORT_PATH, report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  const report = {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    checkedAt: new Date().toISOString(),
  };
  writeJsonAtomic(REPORT_PATH, report);
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
});
