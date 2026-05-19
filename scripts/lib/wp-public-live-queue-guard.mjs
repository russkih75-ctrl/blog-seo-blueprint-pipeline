/**
 * Публичная сверка с WordPress REST (без токенов): недавние опубликованные посты
 * и пересечение нормализованной фразы очереди с заголовком (антидубль, если durable отстаёт).
 */
import { normalizePhrase, canonicalTopicKeyWp } from "../wordstat-queue-core.mjs";

function stripWpTitleHtml(value) {
  return String(value ?? "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#8212;|&mdash;/gi, " ")
    .replace(/&#8211;|&ndash;/gi, " ")
    .replace(/&#171;|&laquo;/gi, " ")
    .replace(/&#187;|&raquo;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenCount(norm) {
  return norm.split(/\s+/).filter(Boolean).length;
}

/**
 * @param {string} origin e.g. https://wordprais.ru
 * @param {{ perPage?: number, timeoutMs?: number }} [opts]
 */
export async function fetchWpRecentPublishedPosts(origin, opts = {}) {
  const base = String(origin ?? "").replace(/\/+$/u, "");
  if (!/^https?:\/\//iu.test(base)) {
    return {
      ok: false,
      posts: [],
      error: "invalid_origin",
    };
  }
  const perPage = Math.min(100, Math.max(1, Number(opts.perPage) || 50));
  const timeoutMs = Math.min(60_000, Math.max(1500, Number(opts.timeoutMs) || 12_000));
  const url = new URL("/wp-json/wp/v2/posts", `${base}/`);
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.set("orderby", "date");
  url.searchParams.set("order", "desc");
  url.searchParams.set("status", "publish");
  url.searchParams.set("_fields", "id,link,slug,title");

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: ac.signal,
    });
    if (!res.ok) {
      return {
        ok: false,
        posts: [],
        error: `http_${res.status}`,
        httpStatus: res.status,
      };
    }
    const body = await res.json();
    const arr = Array.isArray(body) ? body : [];
    const posts = arr.map((p) => {
      const titleRendered =
        p?.title && typeof p.title === "object" ? p.title.rendered : "";
      const titleNorm = normalizePhrase(stripWpTitleHtml(titleRendered));
      return {
        postId: Number(p?.id) || null,
        link: typeof p?.link === "string" ? p.link : "",
        slug: typeof p?.slug === "string" ? String(p.slug).toLowerCase() : "",
        titleNorm,
      };
    });
    return { ok: true, posts, httpStatus: res.status };
  } catch (e) {
    return {
      ok: false,
      posts: [],
      error: e instanceof Error ? e.name : "fetch_error",
    };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Нормализованная фраза считается уже закрытой постом, если:
 * - встречается как непрерывная подстрока в titleNorm недавнего поста (≥3 токена в фразе), или
 * - совпадает канонический WP-topic ключ фразы и заголовка (для длинных заголовков без полного вхождения).
 *
 * @param {string} phraseNorm
 * @param {Array<{ postId: number|null, link: string, slug: string, titleNorm: string }>} posts
 * @returns {{ postId: number|null, link: string } | null}
 */
export function findWpLiveDuplicateForNorm(phraseNorm, posts) {
  const norm = normalizePhrase(phraseNorm);
  if (!norm) return null;
  const tc = tokenCount(norm);
  // Было tc < 3: двухсловные ключи (например «настройка wordpress») не попадали в антидубль
  // и очередь снова резервировала интент, для которого уже есть свежий пост в ленте.
  if (tc < 2) return null;

  const topicPhrase = canonicalTopicKeyWp(norm);

  for (const p of posts) {
    if (!p.titleNorm) continue;
    if (p.titleNorm.includes(norm)) return { postId: p.postId, link: p.link };
    const topicTitle = canonicalTopicKeyWp(p.titleNorm);
    if (
      topicPhrase &&
      topicTitle &&
      topicPhrase === topicTitle &&
      topicPhrase.split(/\s+/).filter(Boolean).length >= 3
    ) {
      return { postId: p.postId, link: p.link };
    }
  }
  return null;
}

/**
 * @param {Iterable<{ phrase: string }>} queueItems
 * @param {Awaited<ReturnType<typeof fetchWpRecentPublishedPosts>>["posts"]} posts
 */
export function buildWpLiveDuplicateMap(queueItems, posts) {
  /** @type {Map<string, { postId: number|null, link: string }>} */
  const m = new Map();
  for (const item of queueItems) {
    const n = normalizePhrase(item.phrase);
    if (!n || m.has(n)) continue;
    const hit = findWpLiveDuplicateForNorm(n, posts);
    if (hit) m.set(n, hit);
  }
  return m;
}
