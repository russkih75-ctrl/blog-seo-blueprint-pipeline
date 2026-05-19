#!/usr/bin/env node
/**
 * Помечает ключ как опубликованный+verified и синхронизирует durable state (git)
 * с локальным artifacts/simple-keyword-queue.json.
 *
 * Usage:
 *   node scripts/wp-queue-reconcile-published.mjs --phrase "seo продвижение сайта" --post-id 541 --url "https://wordprais.ru/..."
 *   node scripts/wp-queue-reconcile-published.mjs --phrase "..." --post-id 541 --url "..." --keyword-id kw_0014
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import {
  mergeDurablePublishedRecord,
  normalizeQueuePhrase,
} from "./lib/wordstat-published-state.mjs";
import {
  ROOT,
  resolveQueueStatePath,
  resolvePublishedKeywordsPath,
} from "./wordstat-queue-core.mjs";

loadEnv({ path: path.join(ROOT, ".env") });

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

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--phrase") out.phrase = argv[++i];
    else if (a === "--post-id") out.postId = Number(argv[++i]);
    else if (a === "--url") out.url = argv[++i];
    else if (a === "--keyword-id") out.keywordId = argv[++i];
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const phrase = String(args.phrase ?? "").trim();
  const url = String(args.url ?? "").trim();
  const postId = Number.isFinite(args.postId) ? args.postId : NaN;
  const keywordId = args.keywordId ? String(args.keywordId).trim() : null;

  if (!phrase || !url || !Number.isFinite(postId) || postId <= 0) {
    console.error(
      "Usage: node scripts/wp-queue-reconcile-published.mjs --phrase \"...\" --post-id 541 --url https://... [--keyword-id kw_0014]",
    );
    process.exit(2);
  }

  const now = new Date().toISOString();
  const qn = normalizeQueuePhrase(phrase);
  if (!qn) {
    console.error("Empty phrase after normalize");
    process.exit(2);
  }

  mergeDurablePublishedRecord({
    phraseNorm: qn,
    keywordId,
    postId,
    publicUrl: url,
    source: "cli_wp_queue_reconcile_published",
  });

  const simpleQueuePath = resolveQueueStatePath();

  const queue = readJsonSafe(simpleQueuePath, {
    version: 1,
    reservedPhrasesNorm: [],
    processedPhrasesNorm: [],
    failedPhrasesNorm: [],
    lastReservedAt: null,
  });
  queue.reservedPhrasesNorm = removeQueueNorm(queue.reservedPhrasesNorm ?? [], qn);
  queue.processedPhrasesNorm = pushQueueNormUnique(queue.processedPhrasesNorm ?? [], qn, 2000);
  queue.processedAtByNorm = {
    ...(queue.processedAtByNorm ?? {}),
    [qn]: now,
  };
  queue.lastReconciled = {
    phrase,
    phraseNorm: qn,
    postId,
    publicUrl: url,
    keywordId,
    at: now,
  };
  writeJsonAtomic(simpleQueuePath, queue);

  console.log(
    JSON.stringify(
      {
        ok: true,
        phraseNorm: qn,
        postId,
        publicUrl: url,
        durableRelative: path
          .relative(ROOT, resolvePublishedKeywordsPath())
          .replace(/\\/g, "/"),
        simpleQueueRelative: path.relative(ROOT, simpleQueuePath).replace(/\\/g, "/"),
      },
      null,
      2,
    ),
  );
}

main();
