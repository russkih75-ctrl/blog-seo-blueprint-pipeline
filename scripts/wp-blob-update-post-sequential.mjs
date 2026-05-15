/**
 * Последовательная загрузка HTML в wordpress_content_blob_append и применение
 * через wordpress_update_post_from_blob (обходит гонки при параллельных MCP-вызовах).
 * URL MCP и токены не печатаются.
 */
import { config } from "dotenv";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
config({ path: path.join(ROOT, ".env") });
const mcpKvDotenvRel = process.env.MCP_KV_DOTENV_PATH?.trim();
if (mcpKvDotenvRel) config({ path: path.resolve(ROOT, mcpKvDotenvRel), override: true });

function loadFirstLineEnvFile(envName, targetName) {
  const rel = process.env[envName]?.trim();
  if (!rel || process.env[targetName]?.trim()) return;
  const filePath = path.isAbsolute(rel) ? rel : path.resolve(ROOT, rel);
  if (!existsSync(filePath)) return;
  const firstLine = readFileSync(filePath, "utf-8").trim().split(/\r?\n/u)[0]?.trim();
  if (firstLine) process.env[targetName] = firstLine;
}

function cursorMcpJsonPath() {
  const custom = process.env.CURSOR_MCP_JSON_PATH?.trim();
  if (custom) return path.isAbsolute(custom) ? custom : path.resolve(ROOT, custom);
  return path.join(homedir(), ".cursor", "mcp.json");
}

function hydrateMcpKvFromCursorConfig() {
  if (process.env.MCP_KV_HTTP_URL?.trim() || process.env.MCP_KV_URL?.trim()) return;
  const cfgPath = cursorMcpJsonPath();
  if (!existsSync(cfgPath)) return;
  try {
    const cfg = JSON.parse(readFileSync(cfgPath, "utf-8"));
    const server =
      cfg.mcpServers?.["mcp-kv"] ??
      cfg.mcpServers?.mcp_kv ??
      cfg.mcpServers?.mcpkv;
    const url = server?.url?.trim();
    if (!url) return;
    process.env.MCP_KV_HTTP_URL = url;
    const auth =
      server.headers?.Authorization ??
      server.headers?.authorization ??
      server.headers?.["x-api-key"];
    if (auth && !process.env.MCP_KV_HTTP_BEARER) {
      process.env.MCP_KV_HTTP_BEARER = String(auth).replace(/^Bearer\s+/iu, "");
    }
  } catch {
    /* ignore */
  }
}

loadFirstLineEnvFile("MCP_KV_HTTP_URL_FILE", "MCP_KV_HTTP_URL");
loadFirstLineEnvFile("MCP_KV_HTTP_BEARER_FILE", "MCP_KV_HTTP_BEARER");
hydrateMcpKvFromCursorConfig();

const urlStr =
  process.env.MCP_KV_HTTP_URL?.trim() || process.env.MCP_KV_URL?.trim();
if (!urlStr) {
  console.error(JSON.stringify({ ok: false, error: "MCP_KV_HTTP_URL_missing" }));
  process.exit(1);
}

const postId = Number(process.argv[2] || "0");
const htmlPath = process.argv[3] || path.join(ROOT, "tmp-article-trimmed.html");
if (!postId || !existsSync(htmlPath)) {
  console.error(
    JSON.stringify({
      ok: false,
      error: "usage: node scripts/wp-blob-update-post-sequential.mjs <post_id> [htmlPath]",
    }),
  );
  process.exit(1);
}

const headers = {};
const bearer =
  process.env.MCP_KV_HTTP_BEARER?.trim() ||
  process.env.MCP_KV_BEARER?.trim() ||
  process.env.MCP_KV_TOKEN?.trim();
if (bearer) headers.Authorization = `Bearer ${bearer}`;

const reqTimeoutMs = Number(process.env.MCP_REQUEST_TIMEOUT_MS ?? "120000");
const transport = new StreamableHTTPClientTransport(new URL(urlStr), {
  requestInit: { headers },
});
const client = new Client({ name: "wp-blob-sequential", version: "1.0.0" });

function splitHtml(s) {
  const max = 2200;
  const markers = [
    "</h2>\n",
    "</figure>\n",
    "</div>\n",
    "</details>\n",
    "</ul>\n",
    "</nav>\n",
    "</p>\n",
  ];
  const chunks = [];
  let buf = "";
  function flush() {
    if (buf) chunks.push(buf);
    buf = "";
  }
  for (let i = 0; i < s.length; ) {
    let best = -1;
    let bestM = "";
    const limit = Math.min(i + max, s.length);
    for (const m of markers) {
      const idx = s.lastIndexOf(m, limit);
      if (idx >= i && idx + m.length <= s.length) {
        if (idx > best) {
          best = idx;
          bestM = m;
        }
      }
    }
    if (best === -1 || best === i) {
      const take = Math.min(max, s.length - i);
      buf += s.slice(i, i + take);
      i += take;
      if (buf.length >= 1800) flush();
      continue;
    }
    buf += s.slice(i, best + bestM.length);
    i = best + bestM.length;
    if (buf.length >= 1600) flush();
  }
  if (buf) flush();
  const joined = chunks.join("");
  if (joined !== s) throw new Error("chunk_join_mismatch");
  return chunks;
}

async function callTool(name, args) {
  const res = await client.callTool({ name, arguments: args }, undefined, {
    timeout: reqTimeoutMs,
  });
  const text = Array.isArray(res.content)
    ? res.content.map((c) => (c.type === "text" ? c.text : "")).join("\n")
    : "";
  return text;
}

try {
  await client.connect(transport, { timeout: reqTimeoutMs });
  const html = readFileSync(htmlPath, "utf8");
  const parts = splitHtml(html);
  let blobId = "";
  let lastBytes = 0;
  for (let n = 0; n < parts.length; n++) {
    const args = { chunk: parts[n] };
    if (n === 0) args.reset = true;
    if (n === parts.length - 1) args.finalize = true;
    if (blobId) args.blob_id = blobId;
    const out = await callTool("wordpress_content_blob_append", args);
    const m = out.match(/blob_id:\s*(\S+)/);
    if (m) blobId = m[1];
    const b = out.match(/bytes_total:\s*(\d+)/) || out.match(/bytes:\s*(\d+)/);
    if (b) lastBytes = Number(b[1]);
    if (!/Chunk принят|Blob готов/u.test(out) && !/✅/u.test(out)) {
      throw new Error(`append_failed: ${out.slice(0, 500)}`);
    }
  }
  if (!blobId) throw new Error("no_blob_id");

  const upd = await callTool("wordpress_update_post_from_blob", {
    post_id: postId,
    blob_id: blobId,
    status: "publish",
    featured_media: Number(process.env.WP_FEATURED_MEDIA_ID || "477") || undefined,
  });
  if (!/обновлена/u.test(upd) && !/✅/u.test(upd)) {
    throw new Error(`update_failed: ${upd.slice(0, 500)}`);
  }
  console.log(
    JSON.stringify({
      ok: true,
      postId,
      blobId,
      chunks: parts.length,
      lastBytes,
      updateSnippet: upd.slice(0, 200),
    }),
  );
  await client.close();
} catch (e) {
  console.error(
    JSON.stringify({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }),
  );
  try {
    await client.close();
  } catch {
    /* ignore */
  }
  process.exit(1);
}
