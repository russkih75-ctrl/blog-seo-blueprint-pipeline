#!/usr/bin/env node
import {
  mkdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import {
  ROOT,
  DEFAULT_PUBLISHED_PATH,
  readJsonSafe,
  normalizePhrase,
  sortQueueForSelection,
  loadPublishedKeywordsState,
  indexBlockingSets,
  canonicalIntentForPhrase,
  evaluateKeywordSkip,
  resolveWordstatConfigPath,
} from "./wordstat-queue-core.mjs";
import {
  fetchWpRecentPublishedPosts,
  buildWpLiveDuplicateMap,
} from "./lib/wp-public-live-queue-guard.mjs";

loadEnv({ path: path.join(ROOT, ".env") });

/** Только stdout JSON «как при обычном запуске», без записи state/last-out (диагностика в Telegram). */
const PEEK_QUEUE =
  process.argv.includes("--peek") ||
  process.env.WORDSTAT_QUEUE_NEXT_PEEK === "1";
const ART = path.join(ROOT, "artifacts");
const CONFIG_PATH = resolveWordstatConfigPath();
const CONTENT_INDEX_PATH = path.join(ART, "content-index.json");
const STATE_PATH = path.join(ART, "simple-keyword-queue.json");
const LAST_OUT_PATH = path.join(ART, "wordstat-queue-last.json");
const LAST_SELECTION_PATH = path.join(ROOT, "data", "wordstat-queue-last-selection.json");

function writeJsonAtomic(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), "utf-8");
  renameSync(tmp, file);
}

function buildQueue(config) {
  if (Array.isArray(config.keywordQueue) && config.keywordQueue.length) {
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
  const queue = [];
  for (const seed of config.seeds ?? []) {
    for (const query of seed.queries ?? []) {
      queue.push({
        id: `kw_${String(queue.length + 1).padStart(4, "0")}`,
        phrase: String(query.phrase ?? "").trim(),
        seedId: seed.id,
        seedPhrase: seed.phrase,
        clusterId: seed.clusterId,
        shows: query.shows ?? null,
        priority: null,
        queueStatus: "active",
      });
    }
  }
  return queue.filter((item) => item.phrase);
}

function pushUnique(values, next, max = 2000) {
  const out = (values ?? []).map((value) => normalizePhrase(value)).filter(Boolean);
  const norm = normalizePhrase(next);
  if (norm && !out.includes(norm)) out.push(norm);
  return out.slice(-max);
}

function buildTaskRu(config, item, cluster) {
  return `Автоматизация «Вордпресс статьи» для ${config.targetSite ?? "https://wordprais.ru/"} — простой список ключевых слов.

Ключ № ${item.id}: «${item.phrase}».
Показы Wordstat: ${item.shows ?? "нет данных"}.
Кластер: ${cluster?.titleRu ?? item.clusterId ?? "без кластера"} (${item.clusterId ?? "n/a"}).
Посадочная/связанный URL: ${cluster?.draftLandingUrl ?? "/blog/"}.

Сделай одну полноценную статью строго под этот ключ. Не меняй ключ на соседний интент.
После verified publication этот конкретный ключ должен быть помечен processed и больше никогда не браться автоматически.

Обязательные требования:
- следуй prompts/wordpress-articles/MASTER_PROMPT.md и HTML_STRUCTURE_WORDPRAIS.md;
- структура как у mayai-like гайдов: полезные блоки, таблица, FAQ, вывод, логика, SEO/GEO/AI-search;
- обложка 16:9 и баннер 21:9 обязательны, без них публикацию блокировать;
- никакого дубля title/meta/slug/content относительно artifacts/content-index.json и WordPress;
- один нормализованный ключ / один канонический интент = одна статья на /blog/;
- в уместном месте добавить: «Остались вопросы или нужна помощь? Контакты в шапке профиля или пишите в комментариях».
`;
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
        reason: "duplicate_canonical_intent_in_queue_scan",
        canonicalIntent: ci,
      });
      continue;
    }
    if (ci) seenCanonical.add(ci);
    return { picked: item, skips };
  }
  return { picked: null, skips };
}

function writeLastSelection(payload) {
  try {
    mkdirSync(path.dirname(LAST_SELECTION_PATH), { recursive: true });
    writeJsonAtomic(LAST_SELECTION_PATH, payload);
  } catch {
    /* noop — не блокируем очередь */
  }
}

async function main() {
  if (!PEEK_QUEUE) mkdirSync(ART, { recursive: true });
  mkdirSync(path.dirname(LAST_SELECTION_PATH), { recursive: true });

  const config = readJsonSafe(CONFIG_PATH, null);
  if (!config) throw new Error(`Missing config: ${CONFIG_PATH}`);

  const publishedPath =
    process.env.WORDSTAT_PUBLISHED_PATH?.trim() || DEFAULT_PUBLISHED_PATH;
  const pub = loadPublishedKeywordsState(publishedPath);

  const clustersById = new Map(
    (config.clusters ?? []).map((cluster) => [cluster.id, cluster]),
  );
  const queue = buildQueue(config);
  const sortedQueue = sortQueueForSelection(queue);
  const duplicateQueueNorm = buildDuplicateQueueNormMap(sortedQueue);

  const state = readJsonSafe(STATE_PATH, {
    version: 1,
    reservedPhrasesNorm: [],
    processedPhrasesNorm: [],
    failedPhrasesNorm: [],
    lastReservedAt: null,
  });
  const index = readJsonSafe(CONTENT_INDEX_PATH, { entries: [] });
  const indexEntries = Array.isArray(index.entries) ? index.entries : [];
  const ib = indexBlockingSets(indexEntries);

  const reserved = new Set((state.reservedPhrasesNorm ?? []).map(normalizePhrase));
  const processed = new Set((state.processedPhrasesNorm ?? []).map(normalizePhrase));
  const excluded = new Set((config.excludedBrandedQueries ?? []).map(normalizePhrase));
  const blockedConfigTopics = new Set(
    (config.blockedCanonicalTopicKeys ?? []).map(normalizePhrase),
  );

  const liveGuardOff = process.env.WORDSTAT_WP_LIVE_GUARD?.trim() === "0";
  /** @type {{ enabled: boolean, ok: boolean|null, postsFetched: number, error?: string|null, httpStatus?: number }} */
  let wpLiveGuard = {
    enabled: !liveGuardOff,
    ok: null,
    postsFetched: 0,
    error: liveGuardOff ? "disabled_WORDSTAT_WP_LIVE_GUARD_0" : null,
  };
  /** @type {Set<string>} */
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
    reserved,
    processed,
    excluded,
    blockedConfigTopics,
    indexNorms: ib.norms,
    indexSlugs: ib.slugs,
    indexTopicKeys: ib.topicKeys,
    indexCanonicalIntents: ib.canonicalIntents,
    wpLiveDuplicateNorms,
  };

  const { picked, skips } = selectNextKeyword(sortedQueue, ctx);

  const selectionPayload = {
    generatedAt: new Date().toISOString(),
    peek: PEEK_QUEUE,
    publishedPath: path.relative(ROOT, publishedPath),
    wpLiveGuard,
    skippedPreview: skips.slice(0, 48),
    skippedTotal: skips.length,
    kw0014InSkippedPreview: skips.some((s) => s.keywordId === "kw_0014"),
    kw0015InSkippedPreview: skips.some((s) => s.keywordId === "kw_0015"),
    kw0016InSkippedPreview: skips.some((s) => s.keywordId === "kw_0016"),
  };

  if (!picked) {
    const out = {
      mode: "semantic_refill",
      reason: "keyword_queue_exhausted",
      wpLiveGuard,
      actionRequired:
        "Все ключи отфильтрованы (дубликаты, durable-публикации, canonical intent, content-index). Обновите keywordQueue или data/wordstat-published-keywords.json после новой статьи.",
      taskRu:
        "Очередь не содержит следующего publishable-ключа: проверьте npm run wp:queue-audit и при необходимости пополните семантику (YADryshko), снимите блокировки или добавьте новые уникальные интенты.",
      configPath: path.relative(ROOT, CONFIG_PATH),
      skipReasonsSample: skips.slice(0, 12),
    };
    const stamp = new Date().toISOString();
    selectionPayload.nextPublishable = null;
    selectionPayload.skipReasonsSample = skips.slice(0, 24);
    writeLastSelection(selectionPayload);

    if (!PEEK_QUEUE)
      writeJsonAtomic(LAST_OUT_PATH, { ...out, generatedAt: stamp });
    process.stdout.write(`${JSON.stringify({ ...out, generatedAt: stamp, peek: PEEK_QUEUE }, null, 2)}\n`);
    return;
  }

  selectionPayload.nextPublishable = {
    keywordId: picked.id,
    phrase: picked.phrase,
    normalizedPhrase: normalizePhrase(picked.phrase),
    canonicalIntent: canonicalIntentForPhrase(picked.phrase, picked.clusterId),
    clusterId: picked.clusterId,
  };
  selectionPayload.skipReasonsSample = skips.slice(0, 24);
  writeLastSelection(selectionPayload);

  const norm = normalizePhrase(picked.phrase);
  const now = new Date().toISOString();
  if (!PEEK_QUEUE) {
    state.reservedPhrasesNorm = pushUnique(state.reservedPhrasesNorm ?? [], norm);
    state.lastReservedAt = now;
    state.lastReserved = {
      id: picked.id,
      phrase: picked.phrase,
      seedId: picked.seedId,
      clusterId: picked.clusterId,
      reservedAt: now,
    };
    writeJsonAtomic(STATE_PATH, state);
  }

  const cluster = clustersById.get(picked.clusterId);
  const out = {
    mode: "topic",
    queueMode: "flat_keyword_queue",
    wpLiveGuard,
    keywordId: picked.id,
    seedId: picked.seedId,
    seedPhrase: picked.seedPhrase,
    clusterId: picked.clusterId,
    draftLandingUrl: cluster?.draftLandingUrl ?? null,
    phrase: picked.phrase,
    shows: picked.shows,
    meta: config.meta ?? {},
    normalizedPhrase: norm,
    canonicalIntent: canonicalIntentForPhrase(picked.phrase, picked.clusterId),
    skipReasonsPreview: skips.slice(0, 8),
    taskRu: buildTaskRu(config, picked, cluster),
    configPath: path.relative(ROOT, CONFIG_PATH),
  };
  if (!PEEK_QUEUE) writeJsonAtomic(LAST_OUT_PATH, { ...out, generatedAt: now });
  process.stdout.write(`${JSON.stringify({ ...out, generatedAt: now, peek: PEEK_QUEUE }, null, 2)}\n`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
