import type { ContentIndex, ContentIndexEntry } from "./types.js";

export interface DuplicateCandidate {
  runId: string;
  primaryKeyword: string;
  slug: string;
  title: string;
  bodyText: string;
}

export interface DuplicateReport {
  decision: "pass" | "rewrite" | "blocked";
  maxSimilarity: number;
  matchedEntry?: ContentIndexEntry;
  checks: Array<{ field: string; similarity: number }>;
}

function normalizeText(input = ""): string {
  return input
    .toLowerCase()
    .replace(/https?:\/\/\S+/gu, " ")
    .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function tokenSet(input = ""): Set<string> {
  return new Set(
    normalizeText(input)
      .split(/\s+/u)
      .filter((token) => token.length > 2),
  );
}

function jaccard(a: string, b: string): number {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (!left.size && !right.size) return 0;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection++;
  }
  return intersection / (left.size + right.size - intersection);
}

export function evaluateDuplicate(
  index: ContentIndex,
  candidate: DuplicateCandidate,
): DuplicateReport {
  let maxSimilarity = 0;
  let matchedEntry: ContentIndexEntry | undefined;
  const checks: DuplicateReport["checks"] = [];

  for (const entry of index.entries ?? []) {
    const comparisons = [
      ["primaryKeyword", candidate.primaryKeyword, entry.primaryKeyword],
      ["slug", candidate.slug, entry.slug],
      ["title", candidate.title, entry.title],
      ["bodyText", candidate.bodyText, entry.bodyText],
    ] as const;

    for (const [field, left, right] of comparisons) {
      const similarity = jaccard(left ?? "", right ?? "");
      checks.push({ field, similarity });
      if (similarity > maxSimilarity) {
        maxSimilarity = similarity;
        matchedEntry = entry;
      }
    }
  }

  const decision =
    maxSimilarity > 0.82 ? "blocked" : maxSimilarity >= 0.65 ? "rewrite" : "pass";

  return { decision, maxSimilarity, matchedEntry, checks };
}
