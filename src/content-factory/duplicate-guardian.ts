import type {
  ContentIndex,
  ContentIndexEntry,
  DuplicateDecision,
  DuplicateEvaluation,
} from "./types.js";

function normalizeFingerprint(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim();
}

function tokens(text: string): string[] {
  const n = normalizeFingerprint(text);
  if (!n) return [];
  return n.split(/\s+/u).filter((w) => w.length > 1);
}

/** Коэффициент Жаккара по множеству слов (простой прокси «похожести» для title/meta). */
function jaccardSimilarity(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (!ta.size && !tb.size) return 0;
  let inter = 0;
  for (const x of ta) if (tb.has(x)) inter++;
  const union = ta.size + tb.size - inter;
  return union ? inter / union : 0;
}

function bestEntrySimilarity(
  probeTitle: string,
  probeKeyword: string,
  probeSlug: string,
  probeBody: string,
  entry: ContentIndexEntry,
): number {
  const parts = [
    entry.title ?? "",
    entry.primaryKeyword ?? "",
    entry.metaDescription ?? "",
  ];
  const probe = [probeTitle, probeKeyword, probeBody].join(" ");
  let max = 0;
  for (const p of parts) {
    const s1 = jaccardSimilarity(probeTitle, p);
    const s2 = jaccardSimilarity(probeKeyword, p);
    const s3 = jaccardSimilarity(probe, p);
    const slugSim =
      entry.slug && probeSlug
        ? entry.slug.toLowerCase() === probeSlug.toLowerCase()
          ? 1
          : 0
        : 0;
    max = Math.max(max, s1, s2, s3, slugSim);
  }
  return max;
}

export function evaluateDuplicate(
  index: ContentIndex,
  input: {
    runId: string;
    primaryKeyword: string;
    slug: string;
    title: string;
    bodyText: string;
  },
): DuplicateEvaluation {
  const notes: string[] = [];
  const np = normalizeFingerprint(input.primaryKeyword);
  const nt = normalizeFingerprint(input.title);
  const slug = input.slug.toLowerCase();

  for (const e of index.entries ?? []) {
    if (e.slug && String(e.slug).toLowerCase() === slug) {
      return {
        decision: "blocked",
        similarity: 1,
        matchedEntry: e,
        notes: ["Точное совпадение slug с индексом."],
      };
    }
    const pk = e.primaryKeyword ? normalizeFingerprint(String(e.primaryKeyword)) : "";
    if (pk && pk === np) {
      return {
        decision: "blocked",
        similarity: 1,
        matchedEntry: e,
        notes: ["Точное совпадение primary keyword с индексом."],
      };
    }
    const et = e.title ? normalizeFingerprint(String(e.title)) : "";
    if (et && et === nt) {
      return {
        decision: "blocked",
        similarity: 1,
        matchedEntry: e,
        notes: ["Точное совпадение title с индексом."],
      };
    }
  }

  let best = 0;
  let matched: ContentIndexEntry | undefined;
  for (const e of index.entries ?? []) {
    const sim = bestEntrySimilarity(
      input.title,
      input.primaryKeyword,
      input.slug,
      input.bodyText,
      e,
    );
    if (sim > best) {
      best = sim;
      matched = e;
    }
  }

  notes.push(`Max similarity vs index: ${best.toFixed(3)}`);

  let decision: DuplicateDecision = "pass";
  if (best > 0.82) {
    decision = "blocked";
    notes.push(">0.82 — блок публикации, нужен новый angle.");
  } else if (best > 0.65) {
    decision = "rewrite_angle";
    notes.push("0.65–0.82 — переписать angle и повторить проверку.");
  }

  return { decision, similarity: best, matchedEntry: matched, notes };
}
