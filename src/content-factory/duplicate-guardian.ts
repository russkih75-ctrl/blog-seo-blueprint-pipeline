import type { ContentIndex } from "./types.js";

export interface DuplicateInput {
  runId: string;
  primaryKeyword: string;
  slug: string;
  title: string;
  bodyText: string;
}

export interface DuplicateReport {
  decision: "pass" | "blocked" | "rewrite_required";
  maxSimilarity: number;
  reasons: string[];
  againstRunId?: string;
}

function normalizeSemantic(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim();
}

function tokenSet(text: string): Set<string> {
  const n = normalizeSemantic(text);
  return new Set(n.split(/\s+/u).filter((w) => w.length > 1));
}

/** Jaccard similarity двух мультимножеств токенов, 0..1 */
function jaccardTokens(a: string, b: string): number {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (!A.size && !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

/** Упрощённый «simhash»-прокси: косинус по символьным биграммам */
function bigramCosine(a: string, b: string): number {
  const norm = (s: string) => normalizeSemantic(s).replace(/\s/g, "");
  const sa = norm(a);
  const sb = norm(b);
  if (sa.length < 2 || sb.length < 2) return 0;
  const mapA = new Map<string, number>();
  for (let i = 0; i < sa.length - 1; i++) {
    const g = sa.slice(i, i + 2);
    mapA.set(g, (mapA.get(g) ?? 0) + 1);
  }
  const mapB = new Map<string, number>();
  for (let i = 0; i < sb.length - 1; i++) {
    const g = sb.slice(i, i + 2);
    mapB.set(g, (mapB.get(g) ?? 0) + 1);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const v of mapA.values()) na += v * v;
  for (const v of mapB.values()) nb += v * v;
  for (const [g, ca] of mapA) {
    const cb = mapB.get(g);
    if (cb) dot += ca * cb;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : 0;
}

export function evaluateDuplicate(
  index: ContentIndex,
  input: DuplicateInput,
): DuplicateReport {
  const reasons: string[] = [];
  let maxSimilarity = 0;
  let againstRunId: string | undefined;

  const slugIn = input.slug.trim().toLowerCase();
  const pkIn = normalizeSemantic(input.primaryKeyword);
  const titleIn = normalizeSemantic(input.title);

  for (const e of index.entries ?? []) {
    if (e.slug && String(e.slug).toLowerCase() === slugIn) {
      reasons.push(`slug_collision:${e.slug}`);
      maxSimilarity = 1;
      againstRunId = e.runId;
    }
    const pkE = e.primaryKeyword ? normalizeSemantic(String(e.primaryKeyword)) : "";
    if (pkE && pkIn && pkE === pkIn) {
      reasons.push(`primary_keyword_duplicate`);
      maxSimilarity = Math.max(maxSimilarity, 0.95);
      againstRunId = e.runId ?? againstRunId;
    }
    const titleE = e.title ? normalizeSemantic(String(e.title)) : "";
    if (titleE && titleIn && titleE === titleIn) {
      reasons.push(`title_exact_duplicate`);
      maxSimilarity = 1;
      againstRunId = e.runId ?? againstRunId;
    }
    if (e.title) {
      const tj = jaccardTokens(input.title, String(e.title));
      maxSimilarity = Math.max(maxSimilarity, tj);
      if (tj >= 0.92) {
        reasons.push(`title_near_duplicate_jaccard:${tj.toFixed(3)}`);
        againstRunId = e.runId ?? againstRunId;
      } else if (tj >= 0.82 && tj < 0.92) {
        reasons.push(`title_similarity_rewrite_band:${tj.toFixed(3)}`);
        againstRunId = e.runId ?? againstRunId;
      }
    }
    const bodyE = e.bodySnippet ? String(e.bodySnippet) : "";
    if (bodyE.length > 80 && input.bodyText.length > 80) {
      const bc = bigramCosine(input.bodyText, bodyE);
      maxSimilarity = Math.max(maxSimilarity, bc);
      if (bc > 0.82) {
        reasons.push(`body_blocked:${bc.toFixed(3)}`);
        againstRunId = e.runId ?? againstRunId;
      } else if (bc >= 0.65 && bc <= 0.82) {
        reasons.push(`body_rewrite_band:${bc.toFixed(3)}`);
        againstRunId = e.runId ?? againstRunId;
      }
    }
  }

  let decision: DuplicateReport["decision"] = "pass";
  if (maxSimilarity > 0.82 || reasons.some((r) => r.startsWith("slug_")))
    decision = "blocked";
  else if (maxSimilarity >= 0.65 || reasons.some((r) => r.includes("rewrite_band")))
    decision = "rewrite_required";

  return { decision, maxSimilarity, reasons: [...new Set(reasons)], againstRunId };
}
