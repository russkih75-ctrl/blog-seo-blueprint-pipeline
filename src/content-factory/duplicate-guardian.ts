import type { ContentIndex, ContentIndexEntry } from "./types.js";

export interface DuplicateCandidate {
  runId: string;
  primaryKeyword: string;
  slug: string;
  title: string;
  bodyText: string;
}

export interface DuplicateReport {
  decision: "pass" | "rewrite_required" | "blocked";
  maxSimilarity: number;
  reasons: string[];
  matchedSlug?: string;
  matchedTitle?: string;
}

function normalizeFingerprint(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim();
}

function tokenSet(s: string): Set<string> {
  const n = normalizeFingerprint(s);
  if (!n) return new Set();
  return new Set(n.split(/\s+/u).filter((w) => w.length > 1));
}

/** Jaccard similarity по токенам (0…1) */
function jaccard(a: string, b: string): number {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (A.size === 0 && B.size === 0) return 0;
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) {
    if (B.has(t)) inter++;
  }
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

function slugNorm(s: string): string {
  return s.toLowerCase().trim().replace(/[^\p{L}\p{N}-]+/gu, "");
}

function bestTextSimilarity(candidate: DuplicateCandidate, e: ContentIndexEntry): number {
  const parts: number[] = [];
  if (e.title) parts.push(jaccard(candidate.title, e.title));
  if (e.primaryKeyword) {
    parts.push(jaccard(candidate.primaryKeyword, e.primaryKeyword));
    parts.push(jaccard(candidate.title, e.primaryKeyword));
    if (e.title) parts.push(jaccard(candidate.primaryKeyword, e.title));
  }
  if (e.bodySnippet) {
    parts.push(jaccard(candidate.bodyText, e.bodySnippet));
    if (e.title) parts.push(jaccard(candidate.title, e.bodySnippet));
  }
  return parts.length ? Math.max(...parts) : 0;
}

/**
 * Антидубль: точное совпадение slug, Jaccard по title/keyword/body.
 * Пороги из README: >0.82 — block, 0.65–0.82 — rewrite_required.
 */
export function evaluateDuplicate(
  index: ContentIndex,
  candidate: DuplicateCandidate,
): DuplicateReport {
  const reasons: string[] = [];
  const cSlug = slugNorm(candidate.slug);
  let maxSim = 0;
  let matchedSlug: string | undefined;
  let matchedTitle: string | undefined;

  for (const e of index.entries ?? []) {
    if (e.slug && slugNorm(String(e.slug)) === cSlug && cSlug.length > 2) {
      return {
        decision: "blocked",
        maxSimilarity: 1,
        reasons: ["slug_duplicate"],
        matchedSlug: String(e.slug),
        matchedTitle: e.title,
      };
    }
    const sim = bestTextSimilarity(candidate, e);
    if (sim > maxSim) {
      maxSim = sim;
      if (e.title) matchedTitle = e.title;
      if (e.slug) matchedSlug = String(e.slug);
    }
  }

  if (maxSim > 0.82) {
    reasons.push("near_duplicate_high");
    return {
      decision: "blocked",
      maxSimilarity: maxSim,
      reasons,
      matchedSlug,
      matchedTitle,
    };
  }
  if (maxSim >= 0.65) {
    reasons.push("near_duplicate_medium");
    return {
      decision: "rewrite_required",
      maxSimilarity: maxSim,
      reasons,
      matchedSlug,
      matchedTitle,
    };
  }
  return { decision: "pass", maxSimilarity: maxSim, reasons: [] };
}
