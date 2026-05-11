/** Запуск workflow с явной загрузкой .env (для родительского процесса / логов). */
import { config } from "dotenv";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
config({ path: path.join(root, ".env") });

const topic =
	process.argv.slice(2).join(" ") ||
	"SEO GEO автотест автоматизации: ремонт стиральной машины Волгоград 2026";

const r = spawnSync("npm", ["run", "workflow:cloud", "--", topic], {
	cwd: root,
	stdio: "inherit",
	shell: true,
	env: { ...process.env, FORCE_COLOR: "0", NODE_OPTIONS: "--no-deprecation" },
});
process.exit(r.status ?? 1);
