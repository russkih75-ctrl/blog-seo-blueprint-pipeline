#!/usr/bin/env node
/**
 * Smoke: публичный GET по URL поста, успех при HTTP 2xx (без REST WP и секретов).
 * Usage: npm run wp:verify-published -- <https://...>
 *    or WP_VERIFY_PUBLISHED_URL=https://...
 */
const urlRaw = process.argv[2] ?? process.env.WP_VERIFY_PUBLISHED_URL;
if (!urlRaw?.trim()) {
  console.error("Usage: npm run wp:verify-published -- <https://...>");
  process.exit(2);
}
const target = urlRaw.trim();
const res = await fetch(target, {
  method: "GET",
  redirect: "follow",
  headers: { "User-Agent": "wp-verify-published/1 (smoke)" },
});
const ok = res.ok;
console.error(`HTTP ${res.status}${ok ? " OK" : " FAIL"}`);
process.exit(ok ? 0 : 1);
