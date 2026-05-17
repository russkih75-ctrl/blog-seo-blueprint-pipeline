/**
 * Обновление тела поста WordPress из локального HTML через MCP:
 * wordpress_content_blob_append → wordpress_update_post_from_blob.
 * URL/секреты не печатаются.
 */
import { config } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { homedir } from "node:os";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

config({ path: path.join(ROOT, ".env") });
const mcpKvDotenvRel = process.env.MCP_KV_DOTENV_PATH?.trim();
if (mcpKvDotenvRel)
  config({ path: path.resolve(ROOT, mcpKvDotenvRel), override: true });

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
    /* Do not print config contents. */
  }
}

loadFirstLineEnvFile("MCP_KV_HTTP_URL_FILE", "MCP_KV_HTTP_URL");
loadFirstLineEnvFile("MCP_KV_HTTP_BEARER_FILE", "MCP_KV_HTTP_BEARER");
hydrateMcpKvFromCursorConfig();

const reqTimeoutMs = Number(process.env.MCP_REQUEST_TIMEOUT_MS ?? "300000");

function envUrl() {
  return (
    process.env.MCP_KV_HTTP_URL?.trim() ||
    process.env.MCP_KV_URL?.trim() ||
    ""
  ).replace(/\/$/, "");
}

function bearerHeaders() {
  const bearer =
    process.env.MCP_KV_HTTP_BEARER?.trim() ||
    process.env.MCP_KV_BEARER?.trim() ||
    process.env.MCP_KV_TOKEN?.trim();
  const headers = {};
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  return headers;
}

function toolPayloadText(result) {
  const texts =
    result.content
      ?.filter((c) => c.type === "text")
      .map((c) => c.text.trim())
      .filter(Boolean) ?? [];
  return texts.join("\n").trim();
}

function parseBlobId(text) {
  const m =
    text.match(/blob[_ ]?id\s*[:=]\s*([A-Za-z0-9_-]+)/iu) ||
    text.match(/"blob_id"\s*:\s*"([^"]+)"/) ||
    text.match(/\bID blob\s*:\s*([A-Za-z0-9_-]+)/iu);
  return m?.[1]?.trim();
}

function chunkHtml(html, max = 18000) {
  const out = [];
  let pos = 0;
  while (pos < html.length) {
    let end = Math.min(html.length, pos + max);
    if (end < html.length) {
      const slice = html.slice(pos, end);
      const li = slice.lastIndexOf("</p>\n");
      if (li > 4000) end = pos + li + 5;
    }
    out.push(html.slice(pos, end));
    pos = end;
  }
  return out;
}

async function main() {
  const postId = Number(process.argv[2]);
  const htmlPath = process.argv[3];
  const featuredRaw = process.argv[4];
  const featuredMedia =
    featuredRaw && /^\d+$/.test(featuredRaw.trim())
      ? Number(featuredRaw.trim())
      : undefined;
  if (!Number.isFinite(postId) || postId <= 0 || !htmlPath?.trim()) {
    console.log(
      JSON.stringify({
        ok: false,
        error: "usage: node scripts/wp-update-post-html-blob.mjs <post_id> <path/to.html> [featured_media_id]",
      }),
    );
    process.exit(1);
  }
  const abs = path.isAbsolute(htmlPath)
    ? htmlPath
    : path.resolve(ROOT, htmlPath);
  if (!existsSync(abs)) {
    console.log(JSON.stringify({ ok: false, error: "html_file_missing" }));
    process.exit(1);
  }
  const html = readFileSync(abs, "utf-8");
  const urlStr = envUrl();
  if (!urlStr) {
    console.log(JSON.stringify({ ok: false, error: "MCP_KV_HTTP_URL_missing" }));
    process.exit(1);
  }

  const transport = new StreamableHTTPClientTransport(new URL(urlStr), {
    requestInit: { headers: bearerHeaders() },
  });
  const client = new Client({ name: "wp-update-html-blob", version: "1.0.0" });
  await client.connect(transport, { timeout: reqTimeoutMs });

  const parts = chunkHtml(html);
  let blobId;
  for (let i = 0; i < parts.length; i++) {
    const finalize = i === parts.length - 1;
    const res = await client.callTool(
      {
        name: "wordpress_content_blob_append",
        arguments: {
          reset: i === 0,
          chunk: parts[i],
          finalize,
          ...(blobId ? { blob_id: blobId } : {}),
        },
      },
      undefined,
      { timeout: reqTimeoutMs },
    );
    const text = toolPayloadText(res);
    if (!blobId) {
      const parsed = parseBlobId(text);
      if (parsed) blobId = parsed;
    }
    if (finalize && !blobId) blobId = parseBlobId(text);
  }

  if (!blobId) {
    console.log(JSON.stringify({ ok: false, error: "blob_id_not_parsed" }));
    await client.close();
    process.exit(1);
  }

  const upArgs = {
    post_id: postId,
    blob_id: blobId,
    post_type: "posts",
  };
  if (typeof featuredMedia === "number") {
    upArgs.featured_media = featuredMedia;
  }

  const up = await client.callTool(
    { name: "wordpress_update_post_from_blob", arguments: upArgs },
    undefined,
    { timeout: reqTimeoutMs },
  );
  const upText = toolPayloadText(up);
  await client.close();

  console.log(
    JSON.stringify(
      {
        ok: true,
        postId,
        blobId,
        htmlChars: html.length,
        chunks: parts.length,
        toolResultPreview: upText.slice(0, 500),
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.log(
    JSON.stringify({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }),
  );
  process.exit(1);
});
