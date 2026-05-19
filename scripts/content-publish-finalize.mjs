/**
 * После публикации в WP: синхронизирует artifacts/content-runs/<run>/publish-result.json,
 * indexnow-result.json (если есть URL) и qa-report.json с данными из pipeline-state.json.
 *
 * RunId: CONTENT_RUN_ID → pipeline-state.contentRunId → самая новая запись в content-index (createdAt).
 */
import { config } from "dotenv";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  mergeDurablePublishedRecord,
  normalizeQueuePhrase,
} from "./lib/wordstat-published-state.mjs";
import {
  resolvePipelineStatePath,
  resolveQueueStatePath,
} from "./wordstat-queue-core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ART = path.join(ROOT, "artifacts");
const CONTENT_INDEX_PATH = path.join(ART, "content-index.json");
const CURSOR_PATH = path.join(ART, "wordstat-queue-cursor.json");

function simpleKeywordQueuePath() {
  return resolveQueueStatePath();
}

config({ path: path.join(ROOT, ".env") });
const mcpKvDotenvRel = process.env.MCP_KV_DOTENV_PATH?.trim();
if (mcpKvDotenvRel)
  config({ path: path.resolve(ROOT, mcpKvDotenvRel), override: true });

function pickRunId(state) {
  const envId = process.env.CONTENT_RUN_ID?.trim();
  if (envId) return envId;
  const fromState =
    typeof state.contentRunId === "string" ? state.contentRunId.trim() : "";
  if (fromState) return fromState;
  const indexPath = path.join(ART, "content-index.json");
  if (!existsSync(indexPath)) return null;
  const idx = JSON.parse(readFileSync(indexPath, "utf-8"));
  const entries = Array.isArray(idx.entries) ? idx.entries : [];
  if (!entries.length) return null;
  const sorted = [...entries].sort((a, b) => {
    const ta = Date.parse(a.createdAt ?? "") || 0;
    const tb = Date.parse(b.createdAt ?? "") || 0;
    return tb - ta;
  });
  return sorted[0]?.runId ?? null;
}

function findRunDir(runId) {
  for (const parent of ["content-runs", "automation-runs"]) {
    const candidate = path.join(ART, parent, runId);
    if (existsSync(candidate)) return candidate;
  }
  return path.join(ART, "content-runs", runId);
}

function normalizeFingerprint(text) {
  return String(text ?? "")
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
  if (tokenSet.has("wordpress") && tokenSet.has("разработка")) return "wordpress разработка";
  if (tokenSet.has("wordpress") && tokenSet.has("elementor")) return "wordpress elementor";
  const weak = new Set(["сайт", "сайта", "сайтов", "на", "для", "под", "и", "в", "с", "по"]);
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

function runResultPath(runDir, name) {
  return path.join(runDir, name);
}

function isMediaOk(media) {
  if (!media || media.ok !== true) return false;
  return Boolean(media.wordpressMediaId || media.wordpressMediaUrl || media.sourceUrl);
}

function isVerificationOk(verification, pubUrl) {
  return Boolean(pubUrl && verification && verification.ok === true && verification.publicUrl);
}

function removeNorm(values, norm) {
  return (values ?? [])
    .map((x) => normalizeFingerprint(String(x)))
    .filter((x) => x && x !== norm);
}

function removeQueueNorm(values, targetNorm) {
  const t = normalizeQueuePhrase(targetNorm);
  return (values ?? [])
    .map((x) => normalizeQueuePhrase(String(x)))
    .filter((x) => x && x !== t);
}

function pushQueueNormUnique(values, norm, max = 2000) {
  const out = (values ?? []).map((x) => normalizeQueuePhrase(String(x))).filter(Boolean);
  const n = normalizeQueuePhrase(norm);
  if (n && !out.includes(n)) out.push(n);
  return out.slice(-max);
}

function pushUnique(values, norm, max = 400) {
  const out = (values ?? [])
    .map((x) => normalizeFingerprint(String(x)))
    .filter(Boolean);
  if (norm && !out.includes(norm)) out.push(norm);
  return out.slice(-max);
}

function syncSimpleKeywordQueue(phraseRaw, processed, now) {
  const queueNorm = normalizeQueuePhrase(phraseRaw ?? "");
  if (!queueNorm) return;
  const queue = readJsonSafe(simpleKeywordQueuePath(), null);
  if (!queue || typeof queue !== "object") return;
  queue.reservedPhrasesNorm = removeQueueNorm(queue.reservedPhrasesNorm ?? [], queueNorm);
  if (processed) {
    queue.processedPhrasesNorm = pushQueueNormUnique(
      queue.processedPhrasesNorm ?? [],
      queueNorm,
      2000,
    );
    queue.processedAtByNorm = {
      ...(queue.processedAtByNorm ?? {}),
      [queueNorm]: now,
    };
  }
  writeJsonAtomic(simpleKeywordQueuePath(), queue);
}

function syncDurableKeywordState({
  runId,
  runDir,
  pubUrl,
  postId,
  publishResult,
  media,
  verification,
  pipelineTopic,
  pipelineWordstatKeywordId,
}) {
  const mediaOk = isMediaOk(media);
  const verificationOk = isVerificationOk(verification, pubUrl);
  const processed = mediaOk && verificationOk;
  const now = new Date().toISOString();

  const index = readJsonSafe(CONTENT_INDEX_PATH, { version: 1, entries: [] });
  const entries = Array.isArray(index.entries) ? index.entries : [];
  const keywords = readJsonSafe(runResultPath(runDir, "keywords.json"), {});
  const seo = readJsonSafe(runResultPath(runDir, "seo.json"), {});
  let entry = entries.find((item) => item.runId === runId);
  const phrase =
    entry?.primaryKeyword ??
    entry?.phrase ??
    keywords.primary ??
    null;
  const norm = normalizeFingerprint(
    entry?.normalizedPhrase ?? entry?.primaryKeywordNorm ?? entry?.keywordNorm ?? phrase,
  );
  const topicKey = canonicalTopicKey(
    entry?.canonicalTopicKey ?? entry?.primaryKeyword ?? entry?.title ?? phrase,
  );

  if (!entry && (phrase || pubUrl)) {
    entry = {
      runId,
      createdAt: now,
      primaryKeyword: phrase ?? undefined,
      title: typeof seo.title === "string" ? seo.title : undefined,
      slug: typeof seo.slug === "string" ? seo.slug : undefined,
    };
    entries.push(entry);
  }

  if (entry) {
    if (pubUrl) entry.publicUrl = pubUrl;
    if (postId != null) entry.postId = postId;
    if (phrase && !entry.primaryKeyword) entry.primaryKeyword = phrase;
    if (norm) entry.normalizedPhrase = norm;
    if (topicKey) entry.canonicalTopicKey = topicKey;
    entry.publishStatus = publishResult.status;
    entry.mediaStatus = mediaOk ? "ok" : "pending";
    entry.verificationStatus = verificationOk ? "verified" : "pending";
    entry.keywordState = processed ? "processed" : "pending";
    if (processed) {
      entry.status = "published_verified";
      entry.verifiedAt = verification.verifiedAt ?? now;
      entry.keywordProcessedAt = now;
    }
    writeJsonAtomic(CONTENT_INDEX_PATH, { ...index, entries });
  }

  const phraseForQueue = (phrase ?? pipelineTopic ?? "").trim();

  if (norm) {
    const cursor = readJsonSafe(CURSOR_PATH, null);
    if (cursor && typeof cursor === "object") {
      cursor.emittedPhrasesNorm = pushUnique(cursor.emittedPhrasesNorm ?? [], norm);
      if (topicKey) cursor.emittedTopicKeys = pushUnique(cursor.emittedTopicKeys ?? [], topicKey);
      cursor.phraseStateByNorm = {
        ...(cursor.phraseStateByNorm ?? {}),
        [norm]: {
          ...(cursor.phraseStateByNorm?.[norm] ?? {}),
          state: processed ? "processed" : "pending",
          phrase: phrase ?? cursor.phraseStateByNorm?.[norm]?.phrase,
          canonicalTopicKey: topicKey || cursor.phraseStateByNorm?.[norm]?.canonicalTopicKey,
          runId,
          updatedAt: now,
          processedAt: processed
            ? now
            : cursor.phraseStateByNorm?.[norm]?.processedAt,
        },
      };
      cursor.pendingPhrasesNorm = processed
        ? removeNorm(cursor.pendingPhrasesNorm ?? [], norm)
        : pushUnique(cursor.pendingPhrasesNorm ?? [], norm);
      cursor.processedPhrasesNorm = processed
        ? pushUnique(cursor.processedPhrasesNorm ?? [], norm)
        : cursor.processedPhrasesNorm ?? [];
      if (topicKey) {
        cursor.pendingTopicKeys = processed
          ? removeNorm(cursor.pendingTopicKeys ?? [], topicKey)
          : pushUnique(cursor.pendingTopicKeys ?? [], topicKey);
        cursor.processedTopicKeys = processed
          ? pushUnique(cursor.processedTopicKeys ?? [], topicKey)
          : cursor.processedTopicKeys ?? [];
      }
      writeJsonAtomic(CURSOR_PATH, cursor);
    }
  }

  syncSimpleKeywordQueue(phraseForQueue, processed, now);

  if (processed && pubUrl) {
    const qn = normalizeQueuePhrase(phraseForQueue);
    if (qn) {
      let keywordId =
        typeof pipelineWordstatKeywordId === "string" && pipelineWordstatKeywordId.trim()
          ? pipelineWordstatKeywordId.trim()
          : null;
      if (!keywordId) {
        const lastQ = readJsonSafe(path.join(ART, "wordstat-queue-last.json"), null);
        if (
          lastQ &&
          typeof lastQ.phrase === "string" &&
          normalizeQueuePhrase(lastQ.phrase) === qn
        )
          keywordId = typeof lastQ.keywordId === "string" ? lastQ.keywordId : null;
      }
      mergeDurablePublishedRecord({
        phraseNorm: qn,
        keywordId,
        postId: postId ?? null,
        publicUrl: pubUrl,
        source: "content_publish_finalize",
      });
    }
  }

  return {
    keywordState: processed ? "processed" : "pending",
    mediaOk,
    verificationOk,
    normalizedPhrase: norm || null,
  };
}

async function main() {
  mkdirSync(ART, { recursive: true });
  const statePath = resolvePipelineStatePath();
  if (!existsSync(statePath))
    throw new Error(`Нет ${path.relative(ROOT, statePath)}`);

  const state = JSON.parse(readFileSync(statePath, "utf-8"));
  const pubUrl =
    typeof state.wordpressPublishedUrl === "string"
      ? state.wordpressPublishedUrl.trim()
      : "";
  const postId =
    typeof state.wordpressPostId === "number"
      ? state.wordpressPostId
      : typeof state.wordpressPostId === "string" &&
          /^\d+$/.test(state.wordpressPostId)
        ? Number(state.wordpressPostId)
        : undefined;

  const runId = pickRunId(state);
  if (!runId)
    throw new Error(
      "Не удалось определить runId: задайте CONTENT_RUN_ID или заполните artifacts/content-index.json",
    );

  const runDir = findRunDir(runId);
  if (!existsSync(runDir))
    throw new Error(`Нет каталога запуска: ${path.relative(ROOT, runDir)}`);

  const publishResult = {
    runId,
    mode: "publish",
    status: pubUrl ? "published" : "pending",
    wordpressPublishedUrl: pubUrl || null,
    wordpressPostId: postId ?? null,
    syncedFrom: path.relative(ROOT, statePath).replace(/\\/g, "/"),
    rawSnippet:
      typeof state.wordpressPublishRaw === "string"
        ? state.wordpressPublishRaw.slice(0, 2000)
        : undefined,
    finalizedAt: new Date().toISOString(),
  };
  writeFileSync(
    path.join(runDir, "publish-result.json"),
    JSON.stringify(publishResult, null, 2),
    "utf-8",
  );

  let indexNowPayload = {
    runId,
    note:
      "IndexNow не вызывался (нет опубликованного URL или модуль недоступен).",
  };

  if (pubUrl) {
    try {
      const modUrl = pathToFileURL(
        path.join(ROOT, "dist/content-factory/indexnow-yandex.js"),
      ).href;
      const { submitSingleUrlGet } = await import(modUrl);
      const result = await submitSingleUrlGet(pubUrl, ROOT);
      indexNowPayload = {
        runId,
        ok: result.ok,
        httpStatus: result.httpStatus,
        status: result.status,
        detail: result.detail,
        actionRequired: result.actionRequired,
        localKeyFileRelative: result.localKeyFileRelative,
        expectedPublicUrlMasked: result.expectedPublicUrlMasked,
        keyMasked: result.keyMasked,
        finalizedAt: new Date().toISOString(),
      };
    } catch (e) {
      indexNowPayload = {
        runId,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        finalizedAt: new Date().toISOString(),
      };
    }
  }

  writeFileSync(
    path.join(runDir, "indexnow-result.json"),
    JSON.stringify(indexNowPayload, null, 2),
    "utf-8",
  );

  const media = readJsonSafe(path.join(runDir, "media-result.json"), null);
  const verification = readJsonSafe(
    path.join(runDir, "publish-verification.json"),
    null,
  );
  const keywordSync = syncDurableKeywordState({
    runId,
    runDir,
    pubUrl,
    postId,
    publishResult,
    media,
    verification,
    pipelineTopic: typeof state.topic === "string" ? state.topic.trim() : "",
    pipelineWordstatKeywordId:
      typeof state.wordstatKeywordId === "string" ? state.wordstatKeywordId.trim() : "",
  });

  const qaPath = path.join(runDir, "qa-report.json");
  if (existsSync(qaPath)) {
    const qa = JSON.parse(readFileSync(qaPath, "utf-8"));
    const findings = Array.isArray(qa.findings) ? qa.findings : [];
    qa.pass =
      Boolean(pubUrl) &&
      findings.length === 0 &&
      keywordSync.mediaOk === true &&
      keywordSync.verificationOk === true;
    if (keywordSync.mediaOk !== true)
      findings.push({ code: "media_not_verified", severity: "blocker" });
    if (keywordSync.verificationOk !== true)
      findings.push({ code: "publication_not_verified", severity: "blocker" });
    qa.findings = findings;
    qa.publishFinalizeAt = new Date().toISOString();
    if (pubUrl) qa.wordpressPublishedUrl = pubUrl;
    writeFileSync(qaPath, JSON.stringify(qa, null, 2), "utf-8");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        runId,
        runDir: path.relative(ROOT, runDir),
        wordpressPublishedUrl: pubUrl || null,
        wordpressPostId: postId ?? null,
        keywordState: keywordSync.keywordState,
        mediaOk: keywordSync.mediaOk,
        verificationOk: keywordSync.verificationOk,
        indexNow: indexNowPayload.status ?? indexNowPayload.note ?? "n/a",
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
