#!/usr/bin/env node
/**
 * Следующая задача для автоматизации «Вордпресс статьи» по очереди Wordstat (семена ws_01 … ws_16).
 * Пишет курсор в artifacts/wordstat-queue-cursor.json и последний снимок в artifacts/wordstat-queue-last.json.
 * При исчерпании доступных фраз — создаёт artifacts/wordstat-queue-need-refill.flag и отдаёт задание на пополнение семантики (ЯДрышко).
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const ART = path.join(REPO_ROOT, "artifacts");
const CONTENT_INDEX_PATH = path.join(ART, "content-index.json");
const CURSOR_PATH = path.join(ART, "wordstat-queue-cursor.json");
const LAST_OUT_PATH = path.join(ART, "wordstat-queue-last.json");

function loadAutomationPath() {
  const envPath = process.env.WORDSTAT_AUTOMATION_CONFIG?.trim();
  if (envPath) return path.isAbsolute(envPath) ? envPath : path.join(REPO_ROOT, envPath);
  return path.join(REPO_ROOT, "config", "wordprais-wordstat-automation.json");
}

function slugifyPrimary(text) {
  const s = text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .slice(0, 96);
  return s || "topic";
}

function normalizeFingerprint(text) {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim();
}

function canonicalTopicKey(text, words = 4) {
  const tokens = normalizeFingerprint(text)
    .split(/\s+/)
    .filter(Boolean);
  const tokenSet = new Set(tokens);
  if (tokenSet.has("wordpress") && tokenSet.has("заказать")) return "wordpress заказать сайт";
  if (tokenSet.has("wordpress") && (tokenSet.has("разработка") || tokenSet.has("разработать"))) return "wordpress разработка сайта";
  if (tokenSet.has("wordpress") && tokenSet.has("elementor")) return "wordpress elementor";
  if (tokenSet.has("wordpress") && (tokenSet.has("взлом") || tokenSet.has("восстановление") || tokenSet.has("чистка"))) return "wordpress взлом восстановление";
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
  const strongTokens = tokens.filter((token) => !weak.has(token));
  return (strongTokens.length ? strongTokens : tokens).slice(0, Math.max(2, words)).join(" ");
}

function readJsonSafe(p, fallback) {
  try {
    if (!existsSync(p)) return fallback;
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(p, obj) {
  mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf-8");
  renameSync(tmp, p);
}

function loadContentIndexEntries() {
  const idx = readJsonSafe(CONTENT_INDEX_PATH, { version: 1, entries: [] });
  return Array.isArray(idx.entries) ? idx.entries : [];
}

function indexEntryBlocksPhrase(entry) {
  const status = String(entry.status ?? "");
  return (
    entry.keywordState === "processed" ||
    status.includes("published") ||
    status === "published_verified" ||
    status.includes("verified") ||
    Boolean(entry.publicUrl || entry.verifiedAt || entry.publishVerifiedAt)
  );
}

function contentIndexBlockedNorms(entries) {
  const out = new Set();
  for (const entry of entries) {
    if (!indexEntryBlocksPhrase(entry)) continue;
    for (const key of [
      "phrase",
      "normalizedPhrase",
      "primaryKeyword",
      "primaryKeywordNorm",
      "keywordNorm",
    ]) {
      const value = entry[key];
      if (typeof value !== "string") continue;
      const norm = normalizeFingerprint(value);
      if (norm) out.add(norm);
    }
  }
  return out;
}

function contentIndexBlockedTopicKeys(entries) {
  const out = new Set();
  for (const entry of entries) {
    if (!indexEntryBlocksPhrase(entry)) continue;
    for (const key of [
      "canonicalTopicKey",
      "phrase",
      "normalizedPhrase",
      "primaryKeyword",
      "primaryKeywordNorm",
      "keywordNorm",
      "title",
    ]) {
      const value = entry[key];
      if (typeof value !== "string") continue;
      const topicKey = canonicalTopicKey(value);
      if (topicKey) out.add(topicKey);
    }
  }
  return out;
}

function collisionWithIndex(phrase, entries) {
  const np = normalizeFingerprint(phrase);
  const cp = canonicalTopicKey(phrase);
  const sp = slugifyPrimary(phrase);
  if (!np) return true;
  for (const e of entries) {
    const t = e.title ? normalizeFingerprint(String(e.title)) : "";
    const pk = e.primaryKeyword ? normalizeFingerprint(String(e.primaryKeyword)) : "";
    const tk = e.title ? canonicalTopicKey(String(e.title)) : "";
    const ptk = e.primaryKeyword ? canonicalTopicKey(String(e.primaryKeyword)) : "";
    if (t && t === np) return true;
    if (pk && pk === np) return true;
    if (tk && tk === cp) return true;
    if (ptk && ptk === cp) return true;
    if (e.slug && String(e.slug).toLowerCase() === sp) return true;
  }
  return false;
}

function sortQueriesDesc(queries) {
  return [...queries].sort((a, b) => (b.shows ?? 0) - (a.shows ?? 0));
}

function defaultCursor() {
  return {
    version: 1,
    seedPointer: 0,
    queryOffsetBySeed: {},
    emittedPhrasesNorm: [],
    pendingPhrasesNorm: [],
    processedPhrasesNorm: [],
    emittedTopicKeys: [],
    pendingTopicKeys: [],
    processedTopicKeys: [],
    phraseStateByNorm: {},
  };
}

function pushUniqueCapped(values, next, max = 400) {
  const normalized = values.map((x) => normalizeFingerprint(String(x))).filter(Boolean);
  const existing = new Set(normalized);
  if (next && !existing.has(next)) normalized.push(next);
  return normalized.slice(-max);
}

function buildRefillTaskRu(cfg) {
  const refill = cfg.semanticRefill ?? {};
  const url = refill.repositoryUrl ?? "https://github.com/Horosheff/yadryshko-semantic-core-subagent";
  const vendor = refill.targetVendorPath ?? "vendor/yadryshko-semantic-core-subagent";
  return (
    `Автоматизация «Вордпресс статьи» — пополнение семантического ядра.\n\n` +
    `Очередь Wordstat исчерпала доступные уникальные формулировки при текущем индексе публикаций.\n\n` +
    `Сделай по шагам:\n` +
    `1) Клонируй или обнови субагента семантики в \`${vendor}\`: npm run install:yadryshko-subagent (или вручную из ${url}).\n` +
    `2) Запусти ЯДрышко по региону 225, источник wordstat_mcp_kv, дата снимка как в config/wordprais-wordstat-automation.json — собери новые кластеры и запросы.\n` +
    `3) Дополни config/wordprais-wordstat-automation.json новыми семенами/queries (без брендового мусора), сохрани формат.\n` +
    `4) Очисти при необходимости artifacts/wordstat-queue-cursor.json (поле emittedPhrasesNorm) или удалите конкретные устаревшие записи.\n` +
    `5) Удали файл-маркер artifacts/wordstat-queue-need-refill.flag после успешного обновления.\n\n` +
    `После этого снова выполни полный цикл «Вордпресс статьи» по MASTER_PROMPT.\n`
  );
}

function pickNextPhrase(cfg, cursor, indexEntries, excludedSet) {
  const excludedBranded = new Set(
    (cfg.excludedBrandedQueries ?? []).map((s) => normalizeFingerprint(String(s))),
  );
  const seeds = cfg.seeds ?? [];
  const workSeeds = seeds.filter(
    (s) =>
      s.wordstatStatus !== "no_data" &&
      s.id !== "ws_16" &&
      Array.isArray(s.queries) &&
      s.queries.length > 0,
  );
  if (!workSeeds.length) return null;

  const n = workSeeds.length;
  const emittedSet = new Set(
    (cursor.emittedPhrasesNorm ?? [])
      .map((x) => normalizeFingerprint(String(x)))
      .filter(Boolean),
  );
  const topicSet = new Set(
    [
      ...(cfg.blockedCanonicalTopicKeys ?? []),
      ...(cursor.emittedTopicKeys ?? []),
      ...(cursor.pendingTopicKeys ?? []),
      ...(cursor.processedTopicKeys ?? []),
    ]
      .map((x) => normalizeFingerprint(String(x)))
      .filter(Boolean),
  );
  const blockedIndexSet = contentIndexBlockedNorms(indexEntries);
  const blockedTopicSet = contentIndexBlockedTopicKeys(indexEntries);
  const blockingIndexEntries = indexEntries.filter(indexEntryBlocksPhrase);

  for (let attempt = 0; attempt < n * 8; attempt++) {
    const si = (cursor.seedPointer + attempt) % n;
    const seed = workSeeds[si];
    const sorted = sortQueriesDesc(seed.queries);
    let qi = cursor.queryOffsetBySeed[seed.id] ?? 0;
    if (qi >= sorted.length) {
      cursor.queryOffsetBySeed[seed.id] = 0;
      qi = 0;
    }

    for (let j = qi; j < sorted.length; j++) {
      const q = sorted[j];
      const phrase = String(q.phrase ?? "").trim();
      if (!phrase) continue;
      const nn = normalizeFingerprint(phrase);
      const topicKey = canonicalTopicKey(phrase);
      if (excludedBranded.has(nn)) continue;
      if (excludedSet.has(nn)) continue;
      if (emittedSet.has(nn)) continue;
      if (topicKey && topicSet.has(topicKey)) continue;
      if (blockedIndexSet.has(nn)) continue;
      if (topicKey && blockedTopicSet.has(topicKey)) continue;
      if (collisionWithIndex(phrase, blockingIndexEntries)) continue;

      cursor.seedPointer = (si + 1) % n;
      cursor.queryOffsetBySeed[seed.id] = j + 1;
      cursor.emittedPhrasesNorm = pushUniqueCapped(cursor.emittedPhrasesNorm ?? [], nn);
      cursor.pendingPhrasesNorm = pushUniqueCapped(cursor.pendingPhrasesNorm ?? [], nn);
      cursor.emittedTopicKeys = pushUniqueCapped(cursor.emittedTopicKeys ?? [], topicKey);
      cursor.pendingTopicKeys = pushUniqueCapped(cursor.pendingTopicKeys ?? [], topicKey);
      cursor.phraseStateByNorm = {
        ...(cursor.phraseStateByNorm ?? {}),
        [nn]: {
          state: "pending",
          phrase,
          canonicalTopicKey: topicKey,
          seedId: seed.id,
          emittedAt: new Date().toISOString(),
        },
      };

      return {
        seed,
        phrase,
        shows: q.shows ?? null,
      };
    }
    cursor.queryOffsetBySeed[seed.id] = 0;
  }
  return null;
}

function writeRefillFlag(cfg) {
  const rel = cfg.semanticRefill?.flagRelativePath ?? "artifacts/wordstat-queue-need-refill.flag";
  const abs = path.join(REPO_ROOT, rel.replace(/^\//, ""));
  mkdirSync(path.dirname(abs), { recursive: true });
  writeJsonAtomic(abs, {
    needRefill: true,
    at: new Date().toISOString(),
    hint: "Запустите ЯДрышко и расширьте config/wordprais-wordstat-automation.json",
    repo: cfg.semanticRefill?.repositoryUrl ?? null,
  });
}

function buildTopicTaskRu(cfg, meta, cluster, seed, phrase, shows) {
  const kwLine =
    shows != null ? `«${phrase}» (показы Wordstat по снимку ${meta.snapshotDate}: ${shows})` : `«${phrase}»`;
  return (
    `Автоматизация «Вордпресс статьи» для ${cfg.targetSite ?? "wordprais.ru"} — очередь Wordstat.\n\n` +
    `Мета Wordstat: регион ${meta.regionCode} (${meta.regionLabel}), дата CSV ${meta.snapshotDate}, источник ${meta.source}, устройство ${meta.device}.\n\n` +
    `Кластер: ${cluster.titleRu} (${cluster.id}), приоритет P${cluster.priority}. Черновик посадочной: ${cluster.draftLandingUrl}\n` +
    `Семя Wordstat: ${seed.id} — «${seed.phrase}».\n` +
    `Основная формулировка материала (очищенное ядро): ${kwLine}.\n\n` +
    `Сделай полный цикл по prompts/wordpress-articles/MASTER_PROMPT.md и HTML_STRUCTURE_WORDPRAIS.md, config/wordpress-articles.json.\n` +
    `Ключи для семантики / распределения по тексту (минимум): «${phrase}», семя «${seed.phrase}». При необходимости добавь LSI по нише WordPress / услуг сайта — без выдуманных цен и без сторонних брендов.\n\n` +
    `Обязательные контроли качества:\n` +
    `• Отдельный проход субагента duplicate-title-meta-guardian (skill): seoTitle, meta description и slug ДОЛЖНЫ быть уникальны относительно artifacts/content-index.json (и при наличии доступа — проверка через wordpress_search_posts). Никаких дублей заголовков / описаний / статей.\n` +
    `• После duplicate-guardian / перед публикацией ещё раз сверь заголовок и meta с индексом.\n` +
    `• Обложка 16:9 и баннер 21:9 через MCP nano_* по NANO_WORDPRESS_STUDIO.md; загрузка в медиатеку WordPress.\n` +
    `• Таблица только в стиле с рамками из HTML_STRUCTURE_WORDPRAIS.md.\n`
  );
}

function main() {
  mkdirSync(ART, { recursive: true });
  const cfgPath = loadAutomationPath();
  const cfg = JSON.parse(readFileSync(cfgPath, "utf-8"));
  const meta = cfg.meta ?? {};
  const clustersById = Object.fromEntries((cfg.clusters ?? []).map((c) => [c.id, c]));

  let cursor = readJsonSafe(CURSOR_PATH, defaultCursor());
  if (!cursor.version) cursor = defaultCursor();

  const indexEntries = loadContentIndexEntries();
  const excludedNorm = new Set(
    (cfg.excludedBrandedQueries ?? []).map((s) => normalizeFingerprint(String(s))),
  );

  const picked = pickNextPhrase(cfg, cursor, indexEntries, excludedNorm);

  let out;
  if (!picked) {
    writeRefillFlag(cfg);
    out = {
      mode: "semantic_refill",
      taskRu: buildRefillTaskRu(cfg),
      meta,
      configPath: path.relative(REPO_ROOT, cfgPath),
    };
  } else {
    const cluster = clustersById[picked.seed.clusterId];
    if (!cluster) throw new Error(`Неизвестный clusterId ${picked.seed.clusterId} у семени ${picked.seed.id}`);
    out = {
      mode: "topic",
      seedId: picked.seed.id,
      seedPhrase: picked.seed.phrase,
      clusterId: cluster.id,
      draftLandingUrl: cluster.draftLandingUrl,
      phrase: picked.phrase,
      shows: picked.shows,
      meta,
      taskRu: buildTopicTaskRu(cfg, meta, cluster, picked.seed, picked.phrase, picked.shows),
      configPath: path.relative(REPO_ROOT, cfgPath),
    };
  }

  writeJsonAtomic(CURSOR_PATH, cursor);
  writeJsonAtomic(LAST_OUT_PATH, { ...out, generatedAt: new Date().toISOString() });

  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}

main();
