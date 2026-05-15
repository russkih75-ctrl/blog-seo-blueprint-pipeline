/**
 * Проверка tools/list по MCP SSE из .env (URL не печатается).
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
    /* Do not print config contents. */
  }
}

loadFirstLineEnvFile("MCP_KV_HTTP_URL_FILE", "MCP_KV_HTTP_URL");
loadFirstLineEnvFile("MCP_KV_HTTP_BEARER_FILE", "MCP_KV_HTTP_BEARER");
hydrateMcpKvFromCursorConfig();

const urlStr =
  process.env.MCP_KV_HTTP_URL?.trim() || process.env.MCP_KV_URL?.trim();
if (!urlStr) {
  console.log(
    JSON.stringify({
      ok: false,
      error: "MCP_KV_HTTP_URL_missing",
      checkedFallbacks: [
        ".env",
        "MCP_KV_DOTENV_PATH",
        "MCP_KV_HTTP_URL_FILE",
        "CURSOR_MCP_JSON_PATH",
        "~/.cursor/mcp.json",
      ],
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

/** Streamable HTTP на том же URL, что и SSE у mcp-kv.ru (legacy SSE клиент зависает). */
const transport = new StreamableHTTPClientTransport(new URL(urlStr), {
  requestInit: { headers },
});

/** MCP SDK default is 60s; удалённые хабы часто отвечают медленнее */
const reqTimeoutMs = Number(process.env.MCP_REQUEST_TIMEOUT_MS ?? "120000");

const client = new Client({ name: "pipeline-tools-check", version: "1.0.0" });
try {
  await client.connect(transport, { timeout: reqTimeoutMs });
  const res = await client.listTools(undefined, { timeout: reqTimeoutMs });
  const names = res.tools.map((t) => t.name);
  const want = [
    "wordpress_create_post",
    "wordpress_update_post_from_blob",
    "wordpress_upload_image_from_url",
  ];
  const wordpress = Object.fromEntries(
    want.map((n) => [n, names.includes(n)]),
  );
  console.log(
    JSON.stringify({
      ok: true,
      toolCount: names.length,
      wordpress,
      requestTimeoutMs: reqTimeoutMs,
    }),
  );
  await client.close();
} catch (e) {
  console.log(
    JSON.stringify({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      endpointConfigured: true,
    }),
  );
  process.exit(1);
}
