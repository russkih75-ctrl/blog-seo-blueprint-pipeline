/**
 * Git-tracked durable state for Wordstat flat-queue keywords that reached
 * verified publication (or manual reconcile). Cloud agents lose artifacts/;
 * this file persists across runs when committed.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizePhrase,
  resolvePublishedKeywordsPath,
} from "../wordstat-queue-core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** @deprecated используйте resolvePublishedKeywordsPath() из wordstat-queue-core */
export const DURABLE_PUBLISHED_PATH = path.join(
  ROOT,
  "data",
  "wordstat-published-keywords.json",
);

function durablePath() {
  return resolvePublishedKeywordsPath();
}

/** Общая нормализация с wordstat-queue-core (дефисы → пробелы, сайт→сайта, …). */
export function normalizeQueuePhrase(text) {
  return normalizePhrase(text);
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

export function readDurablePublished() {
  const raw = readJsonSafe(durablePath(), null);
  if (!raw || typeof raw !== "object")
    return { version: 1, updatedAt: null, processedPhrasesNorm: [], records: [] };
  return {
    version: raw.version ?? 1,
    updatedAt: raw.updatedAt ?? null,
    processedPhrasesNorm: Array.isArray(raw.processedPhrasesNorm)
      ? raw.processedPhrasesNorm.map((x) => normalizeQueuePhrase(x)).filter(Boolean)
      : [],
    records: Array.isArray(raw.records) ? raw.records : [],
  };
}

function pushUniqueNorm(arr, norm, max = 2000) {
  const out = [...new Set((arr ?? []).map((x) => normalizeQueuePhrase(x)).filter(Boolean))];
  if (norm && !out.includes(norm)) out.push(norm);
  return out.slice(-max);
}

/**
 * @param {{ phraseNorm: string, keywordId?: string|null, postId?: number|null, publicUrl?: string|null, source: string }} p
 */
export function mergeDurablePublishedRecord(p) {
  const norm = normalizeQueuePhrase(p.phraseNorm);
  if (!norm) return readDurablePublished();

  const now = new Date().toISOString();
  const rawFull = readJsonSafe(durablePath(), {}) ?? {};
  const data = readDurablePublished();
  const records = Array.isArray(data.records) ? [...data.records] : [];

  const nextRecord = {
    phraseNorm: norm,
    keywordId: p.keywordId ?? null,
    postId: p.postId ?? null,
    publicUrl: typeof p.publicUrl === "string" ? p.publicUrl.trim() : null,
    source: p.source ?? "unknown",
    updatedAt: now,
  };

  const idx = records.findIndex((r) => normalizeQueuePhrase(r.phraseNorm) === norm);
  if (idx >= 0) records[idx] = { ...records[idx], ...nextRecord };
  else records.push(nextRecord);

  const out = {
    ...rawFull,
    version: rawFull.version ?? 1,
    updatedAt: now,
    processedPhrasesNorm: pushUniqueNorm(data.processedPhrasesNorm, norm),
    records,
  };
  writeJsonAtomic(durablePath(), out);
  return readDurablePublished();
}

/** Norms that must be treated as processed for queue picking */
export function durableProcessedNormSet() {
  const data = readDurablePublished();
  const s = new Set(data.processedPhrasesNorm ?? []);
  for (const r of data.records ?? []) {
    const n = normalizeQueuePhrase(r.phraseNorm);
    if (n) s.add(n);
  }
  return s;
}
