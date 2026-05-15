/** Проверка перед Cursor Cloud: GitHub ↔ Cursor + (опционально) HTTP MCP mcp-kv. */
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { config } from "dotenv";
import { Cursor } from "@cursor/sdk";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadProjectsEnv() {
	config({ path: path.join(root, ".env") });
	const extra = process.env.MCP_KV_DOTENV_PATH?.trim();
	if (extra) config({ path: path.resolve(root, extra), override: true });
}

/** Как в run-workflow-cloud.ts — подхват URL из IDE (%USERPROFILE%\.cursor\mcp.json). */
function hydrateFromCursorMcpJson() {
	if (process.env.MCP_KV_HTTP_URL?.trim()) return;
	const custom = process.env.CURSOR_MCP_JSON_PATH?.trim();
	const jsonPath = custom
		? path.isAbsolute(custom)
			? custom
			: path.resolve(root, custom)
		: path.join(homedir(), ".cursor", "mcp.json");
	if (!existsSync(jsonPath)) return;
	try {
		const raw = JSON.parse(readFileSync(jsonPath, "utf8"));
		const s =
			raw.mcpServers?.["mcp-kv"] ??
			raw.mcpServers?.mcp_kv ??
			raw.mcpServers?.mcpkv;
		const u = s?.url?.trim();
		if (u) process.env.MCP_KV_HTTP_URL = u;
	} catch {
		/* noop */
	}
}
loadProjectsEnv();
hydrateFromCursorMcpJson();

function normalizeGithubRepoKey(raw) {
	const s = raw.trim().replace(/\.git$/i, "").replace(/\/+$/, "");
	if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(s))
		return `github.com/${s.toLowerCase()}`;
	const withScheme = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(s) ? s : `https://${s}`;
	try {
		const u = new URL(withScheme);
		if (/\.?github\.com$/i.test(u.hostname)) {
			const p = u.pathname.replace(/^\/+|\/+$/g, "").toLowerCase();
			return `github.com/${p}`;
		}
	} catch {
		/* noop */
	}
	const scp = /^git@github\.com:([^:]+)$/i.exec(s);
	if (scp)
		return `github.com/${scp[1].replace(/\.git$/i, "").toLowerCase()}`;
	return s.toLowerCase();
}

const apiKey = process.env.CURSOR_API_KEY?.trim();
if (!apiKey) {
	console.error("Нет CURSOR_API_KEY в .env");
	process.exit(1);
}

try {
	const me = await Cursor.me({ apiKey });
	console.log(
		"API-ключ Cursor:",
		me.userEmail || me.apiKeyName,
		me.userId != null ? ` (userId ${me.userId})` : "",
	);

	const repos = await Cursor.repositories.list({ apiKey });
	console.log("\nРепозитории GitHub, подключённые к Cursor (Background / Cloud):");
	if (!repos.length) console.warn("(список пуст — Cloud не проверит ветку вашего CLOUD_REPO_URL)\n");
	else for (const r of repos) console.log(" -", r.url);

	const wantRaw = process.env.CLOUD_REPO_URL?.trim();
	if (wantRaw) {
		const want = normalizeGithubRepoKey(wantRaw);
		const ok = repos.some((r) => normalizeGithubRepoKey(r.url) === want);
		console.log(
			ok
				? `\nOK: CLOUD_REPO_URL совпадает с записью Cursor (${want}).`
				: `\nОШИБКА: CLOUD_REPO_URL (${wantRaw} → ${want}) НЕ среди подключённых к Cursor репозиториев.`,
		);
		if (!ok) {
			console.error(
				`\nОткройте https://cursor.com/dashboard → Settings / Integrations → GitHub и добавьте репозиторий (или org). Без этого Cloud ответит: «Failed to verify … branch main».`,
			);
			process.exitCode = 2;
		}
	} else {
		console.warn("\nCLOUD_REPO_URL не задан в .env — пропущено сравнение.");
	}

	const mcpUrl = process.env.MCP_KV_HTTP_URL?.trim();
	const requireHttp =
		process.env.CLOUD_REQUIRE_MCP_KV_HTTP?.trim().toLowerCase() === "true";
	console.log("\n--- HTTP MCP mcp-kv (для sdk Agent.prompt на Cloud)");
	if (mcpUrl) {
		console.log(" MCP_KV_HTTP_URL задан — инструменты будут проброшены в Cloud из скрипта.");
	} else if (requireHttp) {
		console.error(
			" CLOUD_REQUIRE_MCP_KV_HTTP=true, но MCP_KV_HTTP_URL пустой после .env и после подхвата из ~/.cursor/mcp.json.",
		);
		if (process.exitCode === 0) process.exitCode = 3;
	} else {
		console.warn(
			" MCP_KV_HTTP_URL не задан и не найден в ~/.cursor/mcp.json — см. ЛК mcp-kv.ru или добавьте сервер mcp-kv в Cursor (локальный mcp.json).",
		);
	}

	if (process.exitCode && process.exitCode !== 0) process.exit(process.exitCode);
} catch (e) {
	const status = e?.status ?? e?.response?.status;
	const operation = e?.operation ?? e?.endpoint;
	if (status === 401) {
		console.error(
			JSON.stringify(
				{
					ok: false,
					blocker: "cursor_api_key_unauthorized",
					status,
					operation: operation ?? "Cursor API",
					actionRequired:
						"Create or reconnect a valid Cursor API key for this account/workspace, update CURSOR_API_KEY in the runtime secrets, then rerun npm run check:cloud-setup and Cursor Automation Test run.",
				},
				null,
				2,
			),
		);
	} else {
		console.error(
			JSON.stringify(
				{
					ok: false,
					blocker: "cursor_cloud_setup_check_failed",
					status: status ?? null,
					operation: operation ?? null,
					error: e instanceof Error ? e.message : String(e),
				},
				null,
				2,
			),
		);
	}
	process.exitCode = 1;
}
