/**
 * Обновление тела поста WordPress через MCP: wordpress_content_blob_append (последовательно) → wordpress_update_post_from_blob.
 * URL/Bearer: MCP_KV_HTTP_URL / MCP_KV_HTTP_BEARER или ~/.cursor/mcp.json (сервер mcp-kv).
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reqTimeoutMs = Number(process.env.MCP_REQUEST_TIMEOUT_MS ?? "600000");
const maxChunk = Number(process.env.BLOB_CHUNK_CHARS ?? "18000");

function envUrl() {
  let u =
    process.env.MCP_KV_HTTP_URL?.trim() ||
    process.env.MCP_KV_URL?.trim() ||
    "";
  if (!u) {
    const jsonPath = path.join(homedir(), ".cursor", "mcp.json");
    if (existsSync(jsonPath)) {
      try {
        const raw = JSON.parse(readFileSync(jsonPath, "utf-8"));
        const s =
          raw.mcpServers?.["mcp-kv"] ??
          raw.mcpServers?.mcp_kv ??
          raw.mcpServers?.mcpkv;
        u = s?.url?.trim() ?? "";
      } catch {
        /* noop */
      }
    }
  }
  return u.replace(/\/$/, "");
}

function bearerHeaders() {
  const bearer =
    process.env.MCP_KV_HTTP_BEARER?.trim() ||
    process.env.MCP_KV_BEARER?.trim() ||
    process.env.MCP_KV_TOKEN?.trim();
  const headers = {};
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const jsonPath = path.join(homedir(), ".cursor", "mcp.json");
  if (!bearer && existsSync(jsonPath)) {
    try {
      const raw = JSON.parse(readFileSync(jsonPath, "utf-8"));
      const s =
        raw.mcpServers?.["mcp-kv"] ??
        raw.mcpServers?.mcp_kv ??
        raw.mcpServers?.mcpkv;
      const h = s?.headers;
      if (h && typeof h === "object")
        for (const [k, v] of Object.entries(h))
          if (typeof v === "string") headers[k] = v;
    } catch {
      /* noop */
    }
  }
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

/** Разбить HTML по границам строк, не превышая maxChunk */
function lineBoundedChunks(html, max) {
  const lines = String(html).split("\n");
  const chunks = [];
  let buf = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] + (i < lines.length - 1 ? "\n" : "");
    if (buf.length + line.length > max && buf.length > 0) {
      chunks.push(buf);
      buf = line;
    } else {
      buf += line;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

async function callTool(client, name, args) {
  const res = await client.callTool(
    { name, arguments: args },
    undefined,
    { timeout: reqTimeoutMs },
  );
  return toolPayloadText(res);
}

function parseBlobId(text) {
  const m = text.match(/blob[_ ]?id\s*[:=]\s*([a-zA-Z0-9_-]+)/i);
  if (m) return m[1];
  try {
    const j = JSON.parse(text);
    if (j && typeof j.blob_id === "string") return j.blob_id;
    if (j && typeof j.blobId === "string") return j.blobId;
  } catch {
    /* noop */
  }
  return undefined;
}

async function main() {
  const urlStr = envUrl();
  if (!urlStr) {
    console.error(
      JSON.stringify({
        ok: false,
        error: "MCP_KV_HTTP_URL_missing_and_no_cursor_mcp_json",
      }),
    );
    process.exit(1);
  }

  const filePath = process.argv[2]?.trim();
  const postId = Number(process.argv[3]?.trim());
  if (!filePath || !Number.isFinite(postId)) {
    console.error(
      JSON.stringify({
        ok: false,
        error: "usage: node wp-blob-update-post-from-file.mjs <html-file> <post_id>",
      }),
    );
    process.exit(1);
  }

  const abs = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(ROOT, filePath);
  const html = readFileSync(abs, "utf-8");
  const chunks = lineBoundedChunks(html, maxChunk);

  const transport = new StreamableHTTPClientTransport(new URL(urlStr), {
    requestInit: { headers: bearerHeaders() },
  });
  const client = new Client({
    name: "wp-blob-update-post-from-file",
    version: "1.0.0",
  });
  await client.connect(transport, { timeout: reqTimeoutMs });

  let blobId;
  for (let i = 0; i < chunks.length; i++) {
    const isFirst = i === 0;
    const isLast = i === chunks.length - 1;
    const args = {
      reset: isFirst,
      chunk: chunks[i],
      finalize: isLast,
      ...(blobId && !isFirst ? { blob_id: blobId } : {}),
    };
    const out = await callTool(client, "wordpress_content_blob_append", args);
    if (isFirst) {
      blobId = parseBlobId(out);
      if (!blobId) {
        await client.close();
        console.error(
          JSON.stringify({
            ok: false,
            error: "blob_id_not_found",
            appendResponse: out.slice(0, 2000),
          }),
        );
        process.exit(2);
      }
    }
  }

  const updateOut = await callTool(client, "wordpress_update_post_from_blob", {
    post_id: postId,
    blob_id: blobId,
  });
  await client.close();

  console.log(
    JSON.stringify(
      {
        ok: true,
        post_id: postId,
        blob_id: blobId,
        chunks: chunks.length,
        htmlChars: html.length,
        updateResponsePreview: updateOut.slice(0, 1500),
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
  process.exit(1);
});
