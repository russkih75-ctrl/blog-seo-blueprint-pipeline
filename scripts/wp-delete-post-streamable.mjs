/**
 * Удаление поста WordPress через MCP Streamable HTTP (mcp-kv.ru).
 * Usage: node scripts/wp-delete-post-streamable.mjs [post_id]
 *    или WP_DELETE_POST_ID=123
 */
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
config({ path: path.join(ROOT, ".env") });
const mcpKvDotenvRel = process.env.MCP_KV_DOTENV_PATH?.trim();
if (mcpKvDotenvRel)
  config({ path: path.resolve(ROOT, mcpKvDotenvRel), override: true });

const reqTimeoutMs = Number(process.env.MCP_REQUEST_TIMEOUT_MS ?? "120000");

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
  return (
    result.content
      ?.filter((c) => c.type === "text")
      .map((c) => c.text.trim())
      .filter(Boolean)
      .join("\n") ?? ""
  );
}

async function main() {
  const raw =
    process.argv[2]?.trim() ||
    process.env.WP_DELETE_POST_ID?.trim() ||
    "";
  const postId = Number(raw);
  if (!Number.isFinite(postId) || postId <= 0) {
    console.error(
      JSON.stringify({
        ok: false,
        error: "Укажите числовой post_id аргументом или WP_DELETE_POST_ID",
      }),
    );
    process.exit(1);
  }

  const urlStr = envUrl();
  if (!urlStr) {
    console.error(JSON.stringify({ ok: false, error: "MCP_KV_HTTP_URL_missing" }));
    process.exit(1);
  }

  const transport = new StreamableHTTPClientTransport(new URL(urlStr), {
    requestInit: { headers: bearerHeaders() },
  });
  const client = new Client({ name: "wp-delete-post", version: "1.0.0" });
  await client.connect(transport, { timeout: reqTimeoutMs });

  const deleted = await client.callTool(
    {
      name: "wordpress_delete_post",
      arguments: { post_id: postId },
    },
    undefined,
    { timeout: reqTimeoutMs },
  );

  const text = toolPayloadText(deleted);
  await client.close();

  console.log(
    JSON.stringify(
      {
        ok: true,
        postId,
        response: text.slice(0, 4000),
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
