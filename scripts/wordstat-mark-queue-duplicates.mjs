#!/usr/bin/env node
/**
 * Помечает дубликаты в keywordQueue: exact normalized и канонический интент.
 * Запуск: node scripts/wordstat-mark-queue-duplicates.mjs --write
 */
import {
  readFileSync,
  renameSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import path from "node:path";
import {
  ROOT,
  normalizePhrase,
  sortQueueForSelection,
  canonicalIntentForPhrase,
} from "./wordstat-queue-core.mjs";

const CONFIG_PATH = path.join(ROOT, "config", "wordprais-wordstat-automation.json");
const WRITE = process.argv.includes("--write");

function main() {
  const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  const kq = raw.keywordQueue;
  if (!Array.isArray(kq)) throw new Error("keywordQueue missing");

  const items = kq.map((item, index) => {
    const { skipReason: _sr, queueStatus: _qs, ...rest } = item;
    return {
      ...rest,
      id: item.id ?? `kw_${String(index + 1).padStart(4, "0")}`,
      phrase: String(item.phrase ?? "").trim(),
      queueStatus: "active",
    };
  });

  const sorted = sortQueueForSelection(items);

  const seenNorm = new Set();
  const seenCanon = new Set();

  const statusById = new Map();

  for (const item of sorted) {
    const id = item.id;
    const n = normalizePhrase(item.phrase);
    const ci = canonicalIntentForPhrase(item.phrase, item.clusterId);

    if (!n) {
      statusById.set(id, {
        queueStatus: "active",
        skipReason: undefined,
      });
      continue;
    }

    if (seenNorm.has(n)) {
      statusById.set(id, {
        queueStatus: "skipped_duplicate_exact",
        skipReason: "duplicate_normalized_phrase_lower_priority",
      });
      continue;
    }
    seenNorm.add(n);

    if (ci && seenCanon.has(ci)) {
      statusById.set(id, {
        queueStatus: "skipped_duplicate_canonical",
        skipReason: `duplicate_canonical_intent:${ci}`,
      });
      continue;
    }
    if (ci) seenCanon.add(ci);

    statusById.set(id, {
      queueStatus: "active",
      skipReason: undefined,
    });
  }

  const nextKq = kq.map((orig, index) => {
    const id = orig.id ?? `kw_${String(index + 1).padStart(4, "0")}`;
    const st = statusById.get(id);
    if (!st) return orig;
    const out = { ...orig, id, queueStatus: st.queueStatus };
    if (st.skipReason) out.skipReason = st.skipReason;
    else delete out.skipReason;
    return out;
  });

  const stats = {
    active: nextKq.filter((x) => x.queueStatus === "active").length,
    skipped_exact: nextKq.filter((x) => x.queueStatus === "skipped_duplicate_exact")
      .length,
    skipped_canonical: nextKq.filter(
      (x) => x.queueStatus === "skipped_duplicate_canonical",
    ).length,
    other_skipped: nextKq.filter(
      (x) =>
        String(x.queueStatus ?? "").startsWith("skipped") &&
        x.queueStatus !== "skipped_duplicate_exact" &&
        x.queueStatus !== "skipped_duplicate_canonical",
    ).length,
  };

  console.error(JSON.stringify(stats));

  if (WRITE) {
    mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    raw.keywordQueue = nextKq;
    raw.meta = raw.meta ?? {};
    raw.meta.queueDedupe = {
      generatedAt: new Date().toISOString(),
      stats,
    };
    const tmp = `${CONFIG_PATH}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(raw, null, 2)}\n`, "utf-8");
    renameSync(tmp, CONFIG_PATH);
    console.error(`Wrote ${CONFIG_PATH}`);
  }
}

main();
