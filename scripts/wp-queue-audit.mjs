#!/usr/bin/env node
/**
 * Аудит очереди Wordstat: следующий publishable ключ и причины пропусков (без секретов).
 */
import path from "node:path";
import { config as loadEnv } from "dotenv";
import {
  ROOT,
  SEO_SITE_PROMOTION_INTENT,
  readJsonSafe,
  normalizePhrase,
  sortQueueForSelection,
  loadPublishedKeywordsState,
  indexBlockingSets,
  canonicalIntentForPhrase,
  evaluateKeywordSkip,
  seoPromotionSkeleton,
  resolveWordstatConfigPath,
  resolveQueueStatePath,
  resolvePublishedKeywordsPath,
} from "./wordstat-queue-core.mjs";
import {
  fetchWpRecentPublishedPosts,
  buildWpLiveDuplicateMap,
} from "./lib/wp-public-live-queue-guard.mjs";

loadEnv({ path: path.join(ROOT, ".env") });

const CONFIG_PATH = resolveWordstatConfigPath();
const CONTENT_INDEX_PATH = path.join(ROOT, "artifacts", "content-index.json");
const STATE_PATH = resolveQueueStatePath();
const JSON_ONLY = process.argv.includes("--json");

function buildQueue(config) {
  if (!Array.isArray(config.keywordQueue)) return [];
  return config.keywordQueue
    .map((item, index) => ({
      id: item.id ?? `kw_${String(index + 1).padStart(4, "0")}`,
      phrase: String(item.phrase ?? "").trim(),
      seedId: item.seedId ?? null,
      seedPhrase: item.seedPhrase ?? item.phrase ?? "",
      clusterId: item.clusterId ?? null,
      shows: item.shows ?? null,
      priority: item.priority ?? null,
      queueStatus: item.queueStatus ?? "active",
    }))
    .filter((item) => item.phrase)
    .filter((item) => item.queueStatus === "active");
}

function buildDuplicateQueueNormMap(sortedQueue) {
  const m = new Map();
  for (const item of sortedQueue) {
    const n = normalizePhrase(item.phrase);
    if (!n) continue;
    if (!m.has(n)) m.set(n, item.id);
  }
  return m;
}

function selectNextKeyword(sortedQueue, ctx) {
  const skips = [];
  const seenCanonical = new Set();
  for (const item of sortedQueue) {
    const skip = evaluateKeywordSkip(item, ctx);
    if (skip) {
      skips.push({
        keywordId: item.id,
        phrase: item.phrase,
        clusterId: item.clusterId,
        normalizedPhrase: normalizePhrase(item.phrase),
        canonicalIntent: canonicalIntentForPhrase(item.phrase, item.clusterId),
        seoSkeleton:
          item.clusterId === "c_seo_wp"
            ? seoPromotionSkeleton(item.phrase)
            : undefined,
        reason: skip.reason,
      });
      continue;
    }
    const ci = canonicalIntentForPhrase(item.phrase, item.clusterId);
    if (ci && seenCanonical.has(ci)) {
      skips.push({
        keywordId: item.id,
        phrase: item.phrase,
        clusterId: item.clusterId,
        normalizedPhrase: normalizePhrase(item.phrase),
        canonicalIntent: ci,
        reason: "duplicate_canonical_intent_in_queue_scan",
      });
      continue;
    }
    if (ci) seenCanonical.add(ci);
    return { picked: item, skips };
  }
  return { picked: null, skips };
}

async function main() {
  const publishedPath = resolvePublishedKeywordsPath();
  const config = readJsonSafe(CONFIG_PATH, null);
  if (!config) throw new Error(`Missing config: ${CONFIG_PATH}`);

  const pub = loadPublishedKeywordsState(publishedPath);
  const queue = buildQueue(config);
  const sortedQueue = sortQueueForSelection(queue);
  const duplicateQueueNorm = buildDuplicateQueueNormMap(sortedQueue);

  const state = readJsonSafe(STATE_PATH, {
    reservedPhrasesNorm: [],
    processedPhrasesNorm: [],
  });
  const index = readJsonSafe(CONTENT_INDEX_PATH, { entries: [] });
  const indexEntries = Array.isArray(index.entries) ? index.entries : [];
  const ib = indexBlockingSets(indexEntries);

  const liveGuardOff = process.env.WORDSTAT_WP_LIVE_GUARD?.trim() === "0";
  let wpLiveGuard = {
    enabled: !liveGuardOff,
    ok: null,
    postsFetched: 0,
    error: liveGuardOff ? "disabled_WORDSTAT_WP_LIVE_GUARD_0" : null,
  };
  let wpLiveDuplicateNorms = new Set();
  if (!liveGuardOff) {
    const origin = String(config.targetSite ?? "https://wordprais.ru").replace(
      /\/+$/u,
      "",
    );
    const live = await fetchWpRecentPublishedPosts(origin, {
      perPage: 50,
      timeoutMs: 12_000,
    });
    wpLiveGuard = {
      ...wpLiveGuard,
      ok: live.ok,
      postsFetched: live.posts?.length ?? 0,
      error: live.ok ? null : live.error ?? "fetch_failed",
      httpStatus: live.httpStatus,
    };
    if (live.ok && Array.isArray(live.posts)) {
      const dupMap = buildWpLiveDuplicateMap(sortedQueue, live.posts);
      wpLiveDuplicateNorms = new Set(dupMap.keys());
    }
  }

  const ctx = {
    keywordIdsPublished: pub.keywordIds,
    publishedNorms: pub.norms,
    publishedIntents: pub.intents,
    duplicateQueueNorm,
    reserved: new Set((state.reservedPhrasesNorm ?? []).map(normalizePhrase)),
    processed: new Set((state.processedPhrasesNorm ?? []).map(normalizePhrase)),
    excluded: new Set((config.excludedBrandedQueries ?? []).map(normalizePhrase)),
    blockedConfigTopics: new Set(
      (config.blockedCanonicalTopicKeys ?? []).map(normalizePhrase),
    ),
    indexNorms: ib.norms,
    indexSlugs: ib.slugs,
    indexTopicKeys: ib.topicKeys,
    indexCanonicalIntents: ib.canonicalIntents,
    wpLiveDuplicateNorms,
  };

  const { picked, skips } = selectNextKeyword(sortedQueue, ctx);

  /** Не полагаться на `skips` (туда попадают только элементы до первого publishable). */
  const kw001x = ["kw_0014", "kw_0015", "kw_0016"].map((id) => {
    const item = sortedQueue.find((x) => x.id === id);
    if (!item) {
      return { keywordId: id, skipped: true, reason: "not_in_active_queue" };
    }
    const skip = evaluateKeywordSkip(item, ctx);
    if (skip) return { keywordId: id, skipped: true, reason: skip.reason };
    const ci = canonicalIntentForPhrase(item.phrase, item.clusterId);
    const idx = sortedQueue.findIndex((x) => x.id === id);
    const seenCanon = new Set();
    for (let i = 0; i < idx; i++) {
      const e = sortedQueue[i];
      if (evaluateKeywordSkip(e, ctx)) continue;
      const eci = canonicalIntentForPhrase(e.phrase, e.clusterId);
      if (eci) seenCanon.add(eci);
    }
    if (ci && seenCanon.has(ci)) {
      return {
        keywordId: id,
        skipped: true,
        reason: "duplicate_canonical_intent_in_queue_scan",
      };
    }
    return { keywordId: id, skipped: false, reason: null };
  });

  const report = {
    generatedAt: new Date().toISOString(),
    publishedPath: path.relative(ROOT, publishedPath),
    wpLiveGuard,
    seoPromotionIntent: SEO_SITE_PROMOTION_INTENT,
    nextPublishable: picked
      ? {
          keywordId: picked.id,
          phrase: picked.phrase,
          normalizedPhrase: normalizePhrase(picked.phrase),
          canonicalIntent: canonicalIntentForPhrase(picked.phrase, picked.clusterId),
          clusterId: picked.clusterId,
          shows: picked.shows,
          priority: picked.priority,
        }
      : null,
    skippedTotal: skips.length,
    skippedKeywordsPreview: skips.slice(0, 35),
    kw0014_kw0015_kw0016: kw001x,
    note: "Один нормализованный ключ и один канонический интент SEO-продвижения сайта = одна статья; kw_0014–0016 закрыты durable + canonical. Перед выбором ключа учитываются последние публичные посты WP (WORDSTAT_WP_LIVE_GUARD=0 отключает сеть).",
  };

  if (JSON_ONLY) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  console.error("=== wp:queue-audit (без секретов) ===");
  console.error(`published: ${report.publishedPath}`);
  console.error(`blocked SEO intent: ${report.seoPromotionIntent}`);
  if (report.nextPublishable) {
    console.error(
      `next publishable: ${report.nextPublishable.keywordId} — ${report.nextPublishable.phrase}`,
    );
  } else {
    console.error("next publishable: (нет — очередь исчерпана фильтрами)");
  }
  console.error(`skipped total (preview limited): ${report.skippedTotal}`);
  console.error("kw_0014 / kw_0015 / kw_0016:");
  for (const row of kw001x) {
    console.error(
      `  ${row.keywordId}: ${row.skipped ? `SKIP (${row.reason})` : "NOT SKIPPED (unexpected)"}`,
    );
  }
  console.error("--- preview skipped ---");
  for (const s of skips.slice(0, 15)) {
    console.error(`  ${s.keywordId} | ${s.reason} | ${s.phrase}`);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
