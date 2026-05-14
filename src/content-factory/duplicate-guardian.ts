import type { ContentIndex } from "./types.js";

export type DuplicateDecision = "pass" | "rewrite_required" | "blocked";

export interface DuplicateInput {
  runId: string;
  primaryKeyword: string;
  slug: string;
  title: string;
  bodyText: string;
}

export interface DuplicateReport {
  decision: DuplicateDecision;
  maxTitleSimilarity: number;
  maxMetaSimilarity: number;
  maxBodySimilarity: number;
  slugCollision: boolean;
  notes: string[];
}

function normalizeSemantic(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, "")
    .trim();
}

function tokenSet(text: string): Set<string> {
  const n = normalizeSemantic(text);
  const parts = n.split(/\s+/u).filter((t) => t.length > 1);
  return new Set(parts);
}

/** Jaccard similarity по токенам (0..1) */
function jaccardSimilarity(a: string, b: string): number {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (A.size === 0 && B.size === 0) return 0;
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

function slugBase(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}-]+/gu, "").replace(/-+$/u, "");
}

export function evaluateDuplicate(
  index: ContentIndex,
  input: DuplicateInput,
): DuplicateReport {
  const notes: string[] = [];
  let maxTitle = 0;
  let maxMeta = 0;
  let maxBody = 0;
  let slugCollision = false;
  const inSlug = slugBase(input.slug);

  for (const e of index.entries ?? []) {
    if (e.slug && slugBase(String(e.slug)) === inSlug && inSlug.length > 2) {
      slugCollision = true;
      notes.push(`Slug совпадает с записью индекса: ${e.slug}`);
    }
    if (e.title) {
      const sim = jaccardSimilarity(input.title, String(e.title));
      maxTitle = Math.max(maxTitle, sim);
    }
    if (e.metaDescription && input.bodyText.length < 400) {
      const sim = jaccardSimilarity(input.title, String(e.metaDescription));
      maxMeta = Math.max(maxMeta, sim);
    } else if (e.metaDescription) {
      const sim = jaccardSimilarity(
        input.bodyText.slice(0, 800),
        String(e.metaDescription),
      );
      maxMeta = Math.max(maxMeta, sim);
    }
    if (e.primaryKeyword) {
      const sim = jaccardSimilarity(
        input.primaryKeyword,
        String(e.primaryKeyword),
      );
      maxBody = Math.max(maxBody, sim);
    }
    if (e.title) {
      const bodySim = jaccardSimilarity(
        input.bodyText.slice(0, 2000),
        String(e.title),
      );
      maxBody = Math.max(maxBody, bodySim);
    }
  }

  const worst = Math.max(maxTitle, maxMeta, maxBody);

  let decision: DuplicateDecision = "pass";
  if (slugCollision || worst > 0.82) {
    decision = "blocked";
    notes.push(
      `Порог антидубля: worst=${worst.toFixed(3)} — блок (>${0.82}) или slug collision.`,
    );
  } else if (worst >= 0.65) {
    decision = "rewrite_required";
    notes.push(
      `Похожесть ${worst.toFixed(3)} в диапазоне 0.65–0.82 — нужен новый angle title/meta/slug.`,
    );
  }

  return {
    decision,
    maxTitleSimilarity: maxTitle,
    maxMetaSimilarity: maxMeta,
    maxBodySimilarity: maxBody,
    slugCollision,
    notes,
  };
}
