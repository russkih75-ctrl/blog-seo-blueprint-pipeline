import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";

const root =
	"C:\\Users\\User\\Desktop\\Курсор полезныеинструменты\\Артура\\Автоматизация курсор\\blog-seo-blueprint-pipeline";

mkdirSync(`${root}\\artifacts`, { recursive: true });
const topic =
	process.argv.slice(2).join(" ") ||
	"SEO GEO автотест: ремонт стиральной машины Волгоград";
const logPath = `${root}\\artifacts\\workflow-last-run.log`;
const errPath = `${root}\\artifacts\\workflow-last-run.err.log`;
const outFd = openSync(logPath, "a");
const errFd = openSync(errPath, "a");

const child = spawn(
	"npm",
	["run", "workflow:cloud", "--", topic],
	{
		cwd: root,
		detached: true,
		stdio: ["ignore", outFd, errFd],
		shell: true,
		env: process.env,
	},
);
child.unref();
console.log(`Started workflow pid=${child.pid}; logs: ${logPath}`);
