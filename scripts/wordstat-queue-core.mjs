/**
 * Общая логика очереди Wordstat: нормализация фраз, канонические интенты, durable-публикации.
 * Без секретов — только пути к JSON в репозитории.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "..");
export const DEFAULT_PUBLISHED_PATH = path.join(
  ROOT,
  "data",
  "wordstat-published-keywords.json",
);
export const SEO_SITE_PROMOTION_INTENT = "intent:seo_site_promotion_general";

/** Очередь Wordstat: `WORDSTAT_AUTOMATION_CONFIG` или дефолт wordprais. */
export function resolveWordstatConfigPath() {
  const rel = process.env.WORDSTAT_AUTOMATION_CONFIG?.trim();
  if (rel)
    return path.isAbsolute(rel) ? rel : path.join(ROOT, rel.replace(/^\/+/, ""));
  return path.join(ROOT, "config", "wordprais-wordstat-automation.json");
}

/** Базовые SEO / географические / коммерческие «надстройки» для канонизации интента. */
const SEO_PROMO_MODIFIER_TOKENS = new Set([
  "москва",
  "спб",
  "санкт",
  "петербурге",
  "петербург",
  "екатеринбург",
  "заказать",
  "услуги",
  "услуга",
  "цена",
  "цены",
  "стоимость",
  "недорого",
  "россия",
  "рф",
  "ru",
  "яндекс",
  "интернет",
  "магазина",
  "агентство",
  "компания",
  "под",
  "ключ",
]);

export function readJsonSafe(file, fallback) {
  try {
    if (!existsSync(file)) return fallback;
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return fallback;
  }
}

/**
 * Единая нормализация для дедупа: lower, ё→е, пунктуация→пробел, дефис→пробел,
 * слияние пробелов, варианты «сайт/сайта/сайтов/сайте» → корень для exact-match.
 */
export function normalizePhrase(text) {
  let s = String(text ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/-/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  s = s
    .replace(/\bсайтов\b/g, "сайта")
    .replace(/\bсайте\b/g, "сайта")
    .replace(/\bсайты\b/g, "сайта")
    .replace(/\bна сайте\b/g, "сайта")
    .replace(/\bсео\b/g, "seo");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

export function slugifyPhrase(text) {
  return normalizePhrase(text).replace(/\s+/g, "-").slice(0, 96) || "topic";
}

/** WordPress-кластеры — прежняя эвристика + нормализация через normalizePhrase. */
export function canonicalTopicKeyWp(text) {
  const n = normalizePhrase(text);
  const tokens = n.split(/\s+/).filter(Boolean);
  const set = new Set(tokens);
  if (set.has("wordpress") && set.has("заказать")) return "wordpress заказать сайт";
  if (
    set.has("wordpress") &&
    (set.has("разработка") || set.has("создание") || set.has("создания"))
  ) {
    return "wordpress разработка сайта";
  }
  if (set.has("wordpress") && set.has("elementor")) return "wordpress elementor";
  if (
    set.has("wordpress") &&
    (set.has("вирусы") || set.has("безопасность") || set.has("восстановление"))
  ) {
    return "wordpress безопасность";
  }
  const weak = new Set([
    "сайт",
    "сайта",
    "сайтов",
    "сайты",
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
  ]);
  const strong = tokens.filter((token) => !weak.has(token));
  return (strong.length ? strong : tokens).slice(0, 4).join(" ");
}

/**
 * Канонический интент для анти-дубля статей (1 интент ≈ 1 статья на /blog/).
 * Для c_seo_wp агрессивно склеиваем «продвижение сайта» + синонимы модификаторов.
 */
export function canonicalIntentForPhrase(phrase, clusterId) {
  const n = normalizePhrase(phrase);
  if (!clusterId) return null;

  if (clusterId === "c_seo_wp") {
    if (/\bаудит\b/.test(n)) return "intent:seo_audit_mixed";
    const hasSite = /\bсайт/.test(n);
    const promo =
      /продвиж|раскрутк|оптимизац|поисков/.test(n) ||
      /\bпродвижение\b/.test(n);
    const seoLike =
      /\bseo\b/.test(n) ||
      n.includes("seo") ||
      /\bсео\b/.test(n) ||
      /поисковое/.test(n);
    if (hasSite && promo && seoLike) return SEO_SITE_PROMOTION_INTENT;
    return `intent:seo_wp_other:${n.slice(0, 48)}`;
  }

  if (clusterId.startsWith("c_wp"))
    return `intent:wp:${canonicalTopicKeyWp(phrase)}`;
  if (clusterId === "c_yandex_seo") return `intent:yandex_seo:${n.slice(0, 40)}`;
  if (clusterId === "c_seo_audit") return `intent:seo_audit_cluster:${n.slice(0, 40)}`;

  return `intent:${clusterId}:${n.slice(0, 56)}`;
}

/** Skeleton без модификаторов города/«заказать» для отчётов аудита. */
export function seoPromotionSkeleton(phrase) {
  const tokens = normalizePhrase(phrase).split(/\s+/).filter(Boolean);
  const kept = tokens.filter((t) => !SEO_PROMO_MODIFIER_TOKENS.has(t));
  return kept.join(" ");
}

export function loadPublishedKeywordsState(publishedPath = DEFAULT_PUBLISHED_PATH) {
  const raw = readJsonSafe(publishedPath, {
    version: 1,
    blockedIntents: [],
    entries: [],
    records: [],
    processedPhrasesNorm: [],
  });
  const norms = new Set();
  const intents = new Set(
    Array.isArray(raw.blockedIntents) ? raw.blockedIntents : [],
  );
  const keywordIds = new Set();
  for (const e of raw.entries ?? []) {
    if (e.keywordId) keywordIds.add(String(e.keywordId));
    if (e.normalizedPhrase) norms.add(normalizePhrase(e.normalizedPhrase));
    if (e.phrase) norms.add(normalizePhrase(e.phrase));
    if (e.canonicalIntent) intents.add(String(e.canonicalIntent));
  }
  for (const n of raw.processedPhrasesNorm ?? []) {
    const nn = normalizePhrase(n);
    if (nn) norms.add(nn);
  }
  for (const r of raw.records ?? []) {
    if (r.keywordId) keywordIds.add(String(r.keywordId));
    if (r.phraseNorm) norms.add(normalizePhrase(r.phraseNorm));
    if (r.canonicalIntent) intents.add(String(r.canonicalIntent));
  }
  return {
    raw,
    norms,
    intents,
    keywordIds,
  };
}

export function indexBlockingSets(indexEntries) {
  const norms = new Set();
  const slugs = new Set();
  const topicKeys = new Set();
  const canonicalIntents = new Set();
  for (const entry of indexEntries) {
    const state = String(entry.keywordState ?? "");
    const status = String(entry.status ?? entry.publishStatus ?? "");
    const blocks =
      state === "processed" ||
      status.includes("published") ||
      status.includes("verified") ||
      Boolean(entry.publicUrl || entry.verifiedAt || entry.publishVerifiedAt);
    if (!blocks) continue;
    for (const key of [
      "phrase",
      "primaryKeyword",
      "normalizedPhrase",
      "title",
      "titleNorm",
    ]) {
      const value = entry[key];
      if (typeof value === "string" && value.trim()) {
        norms.add(normalizePhrase(value));
        topicKeys.add(canonicalTopicKeyWp(value));
      }
    }
    if (entry.canonicalTopicKey)
      topicKeys.add(normalizePhrase(entry.canonicalTopicKey));
    if (entry.slug) slugs.add(String(entry.slug).toLowerCase());
    if (entry.canonicalIntent)
      canonicalIntents.add(String(entry.canonicalIntent));
  }
  return { norms, slugs, topicKeys, canonicalIntents };
}

export function priorityWeight(p) {
  if (p === "P0") return 0;
  if (p === "P1") return 1;
  return 2;
}

export function sortQueueForSelection(queue) {
  return [...queue].sort((a, b) => {
    const pw = priorityWeight(a.priority) - priorityWeight(b.priority);
    if (pw !== 0) return pw;
    return (b.shows ?? 0) - (a.shows ?? 0);
  });
}

/**
 * @returns {{ reason: string } | null} null если ключ можно брать (без учёта scan-дедупа канона).
 */
export function evaluateKeywordSkip(item, ctx) {
  const norm = normalizePhrase(item.phrase);
  if (!norm) return { reason: "empty_phrase" };

  if (ctx.keywordIdsPublished?.has?.(String(item.id)))
    return { reason: "published_keyword_id_durable" };

  if (ctx.excluded?.has(norm)) return { reason: "config_excluded_branded" };

  if (
    ctx.duplicateQueueNorm?.get(norm) &&
    ctx.duplicateQueueNorm.get(norm) !== item.id
  )
    return { reason: "duplicate_exact_queue_order" };

  if (ctx.publishedNorms?.has(norm)) return { reason: "published_durable_exact" };

  const ci = canonicalIntentForPhrase(item.phrase, item.clusterId);
  if (ci && ctx.publishedIntents?.has(ci))
    return { reason: "published_durable_canonical_intent" };

  if (ci && ctx.indexCanonicalIntents?.has(ci))
    return { reason: "content_index_canonical_intent" };

  if (ctx.reserved?.has(norm)) return { reason: "reserved_active_queue_state" };
  if (ctx.processed?.has(norm)) return { reason: "processed_queue_state" };

  if (ctx.indexNorms?.has(norm)) return { reason: "content_index_exact_phrase" };

  const topicWp = canonicalTopicKeyWp(item.phrase);
  if (topicWp && ctx.blockedConfigTopics?.has(normalizePhrase(topicWp)))
    return { reason: "config_blocked_canonical_topic" };

  if (topicWp && ctx.indexTopicKeys?.has(topicWp))
    return { reason: "content_index_wp_topic" };

  if (ctx.indexSlugs?.has(slugifyPhrase(item.phrase)))
    return { reason: "content_index_slug" };

  if (ctx.wpLiveDuplicateNorms?.has(norm))
    return { reason: "duplicate_wp_public_recent_post_title" };

  return null;
}
