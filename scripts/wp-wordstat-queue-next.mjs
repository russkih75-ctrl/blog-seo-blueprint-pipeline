#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { durableProcessedNormSet } from "./lib/wordstat-published-state.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Только stdout JSON «как при обычном запуске», без записи state/last-out (диагностика в Telegram). */
const PEEK_QUEUE =
  process.argv.includes("--peek") ||
  process.env.WORDSTAT_QUEUE_NEXT_PEEK === "1";
const ART = path.join(ROOT, "artifacts");
const CONFIG_PATH = path.join(ROOT, "config", "wordprais-wordstat-automation.json");
const CONTENT_INDEX_PATH = path.join(ART, "content-index.json");
const STATE_PATH = path.join(ART, "simple-keyword-queue.json");
const LAST_OUT_PATH = path.join(ART, "wordstat-queue-last.json");

function normalize(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(text) {
  return normalize(text).replace(/\s+/g, "-").slice(0, 96) || "topic";
}

function canonicalTopicKey(text) {
  const tokens = normalize(text).split(/\s+/).filter(Boolean);
  const set = new Set(tokens);
  if (set.has("wordpress") && set.has("заказать")) return "wordpress заказать сайт";
  if (set.has("wordpress") && (set.has("разработка") || set.has("создание") || set.has("создания"))) {
    return "wordpress разработка сайта";
  }
  if (set.has("wordpress") && set.has("elementor")) return "wordpress elementor";
  if (set.has("wordpress") && (set.has("вирусы") || set.has("безопасность") || set.has("восстановление"))) {
    return "wordpress безопасность";
  }
  const weak = new Set(["сайт", "сайта", "сайтов", "сайты", "на", "для", "под", "без", "как", "что", "это", "или", "и", "в", "с", "по", "до", "от", "при", "2026", "году"]);
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

function pushUnique(values, next, max = 2000) {
  const out = (values ?? []).map((value) => normalize(value)).filter(Boolean);
  const norm = normalize(next);
  if (norm && !out.includes(norm)) out.push(norm);
  return out.slice(-max);
}

function indexBlocks(indexEntries) {
  const norms = new Set();
  const slugs = new Set();
  const topicKeys = new Set();
  for (const entry of indexEntries) {
    const state = String(entry.keywordState ?? "");
    const status = String(entry.status ?? entry.publishStatus ?? "");
    const blocks =
      state === "processed" ||
      status.includes("published") ||
      status.includes("verified") ||
      Boolean(entry.publicUrl || entry.verifiedAt || entry.publishVerifiedAt);
    if (!blocks) continue;
    for (const key of ["phrase", "primaryKeyword", "normalizedPhrase", "title", "titleNorm"]) {
      const value = entry[key];
      if (typeof value === "string" && value.trim()) norms.add(normalize(value));
      if (typeof value === "string" && value.trim()) topicKeys.add(canonicalTopicKey(value));
    }
    if (entry.canonicalTopicKey) topicKeys.add(normalize(entry.canonicalTopicKey));
    if (entry.slug) slugs.add(String(entry.slug).toLowerCase());
  }
  return { norms, slugs, topicKeys };
}

function buildQueue(config) {
  if (Array.isArray(config.keywordQueue) && config.keywordQueue.length) {
    return config.keywordQueue.map((item, index) => ({
      id: item.id ?? `kw_${String(index + 1).padStart(4, "0")}`,
      phrase: String(item.phrase ?? "").trim(),
      seedId: item.seedId ?? null,
      seedPhrase: item.seedPhrase ?? item.phrase ?? "",
      clusterId: item.clusterId ?? null,
      shows: item.shows ?? null,
      priority: item.priority ?? null,
    }));
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
      });
    }
  }
  return queue;
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
- в уместном месте добавить: «Остались вопросы или нужна помощь? Контакты в шапке профиля или пишите в комментариях».
`;
}

function main() {
  if (!PEEK_QUEUE) mkdirSync(ART, { recursive: true });
  const config = readJsonSafe(CONFIG_PATH, null);
  if (!config) throw new Error(`Missing config: ${CONFIG_PATH}`);
  const clustersById = new Map((config.clusters ?? []).map((cluster) => [cluster.id, cluster]));
  const queue = buildQueue(config).filter((item) => item.phrase);
  const state = readJsonSafe(STATE_PATH, {
    version: 1,
    reservedPhrasesNorm: [],
    processedPhrasesNorm: [],
    failedPhrasesNorm: [],
    lastReservedAt: null,
  });
  const index = readJsonSafe(CONTENT_INDEX_PATH, { entries: [] });
  const indexEntries = Array.isArray(index.entries) ? index.entries : [];
  const blocked = indexBlocks(indexEntries);
  const reserved = new Set((state.reservedPhrasesNorm ?? []).map(normalize));
  const processed = new Set((state.processedPhrasesNorm ?? []).map(normalize));
  for (const n of durableProcessedNormSet()) processed.add(n);
  const excluded = new Set((config.excludedBrandedQueries ?? []).map(normalize));
  const blockedConfigTopics = new Set((config.blockedCanonicalTopicKeys ?? []).map(normalize));

  const picked = queue.find((item) => {
    const norm = normalize(item.phrase);
    const topicKey = canonicalTopicKey(item.phrase);
    if (!norm) return false;
    if (excluded.has(norm)) return false;
    if (reserved.has(norm)) return false;
    if (processed.has(norm)) return false;
    if (blocked.norms.has(norm)) return false;
    if (topicKey && blocked.topicKeys.has(topicKey)) return false;
    if (topicKey && blockedConfigTopics.has(topicKey)) return false;
    if (blocked.slugs.has(slugify(item.phrase))) return false;
    return true;
  });

  if (!picked) {
    const out = {
      mode: "semantic_refill",
      reason: "keyword_queue_exhausted",
      taskRu:
        "Плоский список ключевых слов исчерпан или все ключи уже зарезервированы/опубликованы. Запусти YADryshko и обнови keywordQueue.",
      configPath: path.relative(ROOT, CONFIG_PATH),
    };
    const stamp = new Date().toISOString();
    if (!PEEK_QUEUE)
      writeJsonAtomic(LAST_OUT_PATH, { ...out, generatedAt: stamp });
    process.stdout.write(`${JSON.stringify({ ...out, generatedAt: stamp, peek: PEEK_QUEUE }, null, 2)}\n`);
    return;
  }

  const norm = normalize(picked.phrase);
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
    keywordId: picked.id,
    seedId: picked.seedId,
    seedPhrase: picked.seedPhrase,
    clusterId: picked.clusterId,
    draftLandingUrl: cluster?.draftLandingUrl ?? null,
    phrase: picked.phrase,
    shows: picked.shows,
    meta: config.meta ?? {},
    taskRu: buildTaskRu(config, picked, cluster),
    configPath: path.relative(ROOT, CONFIG_PATH),
  };
  if (!PEEK_QUEUE) writeJsonAtomic(LAST_OUT_PATH, { ...out, generatedAt: now });
  process.stdout.write(`${JSON.stringify({ ...out, generatedAt: now, peek: PEEK_QUEUE }, null, 2)}\n`);
}

main();
