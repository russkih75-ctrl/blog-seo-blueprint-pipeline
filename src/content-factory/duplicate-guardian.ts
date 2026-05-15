import type {
  ContentIndex,
  DuplicateDecision,
  DuplicateEvaluationInput,
  DuplicateReport,
} from "./types.js";

function normalizeSemantic(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim();
}

function wordSet(text: string): Set<string> {
  const n = normalizeSemantic(text);
  if (!n) return new Set();
  return new Set(n.split(/\s+/u).filter((w) => w.length > 1));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) {
    if (b.has(x)) inter++;
  }
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

/** 3-словные шинглы для грубой оценки похожести тела */
function shingles(text: string, k = 3): Set<string> {
  const words = normalizeSemantic(text).split(/\s+/u).filter(Boolean);
  const out = new Set<string>();
  if (words.length < k) {
    if (words.length) out.add(words.join(" "));
    return out;
  }
  for (let i = 0; i <= words.length - k; i++) {
    out.add(words.slice(i, i + k).join(" "));
  }
  return out;
}

const BLOCK = 0.82;
const REWRITE_LOW = 0.65;

export function evaluateDuplicate(
  index: ContentIndex,
  candidate: DuplicateEvaluationInput,
): DuplicateReport {
  const notes: string[] = [];
  const collisions: DuplicateReport["collisions"] = [];
  let maxSimilarity = 0;

  const candTitle = candidate.title;
  const candSlug = candidate.slug.toLowerCase();
  const candKw = normalizeSemantic(candidate.primaryKeyword);
  const candTitleSet = wordSet(candTitle);
  const candBodySh = shingles(candidate.bodyText.slice(0, 8000));

  for (const e of index.entries ?? []) {
    if (e.slug && String(e.slug).toLowerCase() === candSlug) {
      collisions.push({ field: "slug", against: e.slug, similarity: 1 });
      maxSimilarity = 1;
      notes.push(`Slug совпадает с индексом: ${e.slug}`);
    }
    if (e.primaryKeyword) {
      const pk = normalizeSemantic(e.primaryKeyword);
      if (pk && pk === candKw) {
        collisions.push({ field: "keyword", against: e.primaryKeyword });
        maxSimilarity = Math.max(maxSimilarity, 1);
        notes.push(`Primary keyword совпадает с индексом.`);
      }
    }
    if (e.title) {
      const sim = jaccard(candTitleSet, wordSet(e.title));
      maxSimilarity = Math.max(maxSimilarity, sim);
      if (sim >= REWRITE_LOW) {
        collisions.push({ field: "title", against: e.title, similarity: sim });
      }
    }
    if (e.metaDescription && candidate.bodyText) {
      const metaSim = jaccard(
        wordSet(e.metaDescription),
        wordSet(candidate.bodyText.slice(0, 500)),
      );
      maxSimilarity = Math.max(maxSimilarity, metaSim);
      if (metaSim >= REWRITE_LOW) {
        collisions.push({
          field: "meta",
          against: "(meta vs body lead)",
          similarity: metaSim,
        });
      }
    }
    if (e.title && candidate.bodyText) {
      const bodySim = jaccard(candBodySh, shingles((e.title ?? "") + " " + (e.primaryKeyword ?? "")));
      maxSimilarity = Math.max(maxSimilarity, bodySim);
    }
  }

  let decision: DuplicateDecision = "pass";
  if (maxSimilarity > BLOCK || collisions.some((c) => c.field === "slug" && c.similarity === 1)) {
    decision = "blocked";
    notes.push(
      `Порог блокировки: similarity ${maxSimilarity.toFixed(3)} > ${BLOCK} или дубль slug.`,
    );
  } else if (maxSimilarity >= REWRITE_LOW) {
    decision = "rewrite_required";
    notes.push(
      `Требуется новый angle: similarity ${maxSimilarity.toFixed(3)} в диапазоне [${REWRITE_LOW}, ${BLOCK}].`,
    );
  }

  return {
    runId: candidate.runId,
    decision,
    maxSimilarity,
    notes,
    collisions,
  };
}
