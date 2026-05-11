/** Список GitHub репозиториев, подключённых к Cursor (для диагностики Cloud). */
import { config } from "dotenv";
import { Cursor } from "@cursor/sdk";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
config({ path: path.join(root, ".env") });

const apiKey = process.env.CURSOR_API_KEY?.trim();
if (!apiKey) {
	console.error("Нет CURSOR_API_KEY в .env");
	process.exit(1);
}

try {
	const me = await Cursor.me({ apiKey });
	console.log(
		"Учётная запись:",
		me.userEmail || me.apiKeyName,
		me.userId != null ? ` (userId ${me.userId})` : "",
	);

	const repos = await Cursor.repositories.list({ apiKey });
	console.log("\nПодключённые репозитории Cursor/GitHub:");
	for (const r of repos) {
		console.log(" -", r.url);
	}
	if (!repos.length) {
		console.warn(
			"\n(пусто) Добавьте репо в Cursor: Settings → вкладки GitHub / Cloud agents и включите нужный сайт для Background Agent.",
		);
		process.exitCode = 2;
	}
	const want = (
		process.env.CLOUD_REPO_URL?.trim() || ""
	).replace(/\.git$/i, "");
	const ok = repos.some((r) => r.url.replace(/\.git$/i, "") === want);
	console.log(ok ? `\nCLOUD_REPO_URL (${want}) есть в списке.` : `\nВНИМАНИЕ: CLOUD_REPO_URL не совпал ни с одним URL из списка Cursor.`);
} catch (e) {
	console.error(e);
	process.exit(1);
}
