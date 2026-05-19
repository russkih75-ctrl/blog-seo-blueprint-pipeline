#!/usr/bin/env node
/**
 * Поверхностное клонирование репозитория ЯДрышко в vendor/ (не коммитится в основной репозиторий при игноре vendor).
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

function loadTargetPath() {
  try {
    const cfg = JSON.parse(
      readFileSync(path.join(REPO_ROOT, "config", "wordprais-wordstat-automation.json"), "utf-8"),
    );
    const rel = cfg.semanticRefill?.targetVendorPath ?? "vendor/yadryshko-semantic-core-subagent";
    return path.join(REPO_ROOT, rel.replace(/^\//, ""));
  } catch {
    return path.join(REPO_ROOT, "vendor", "yadryshko-semantic-core-subagent");
  }
}

function main() {
  const dest = loadTargetPath();
  const cfg = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "config", "wordprais-wordstat-automation.json"), "utf-8"),
  );
  const url =
    cfg.semanticRefill?.repositoryUrl ?? "https://github.com/Horosheff/yadryshko-semantic-core-subagent.git";

  if (existsSync(path.join(dest, ".git"))) {
    console.log(JSON.stringify({ ok: true, skipped: true, dest: path.relative(REPO_ROOT, dest) }, null, 2));
    return;
  }
  mkdirSync(path.dirname(dest), { recursive: true });
  execSync(`git clone --depth 1 "${url}" "${dest}"`, { stdio: "inherit", cwd: REPO_ROOT });
  console.log(JSON.stringify({ ok: true, cloned: true, dest: path.relative(REPO_ROOT, dest) }, null, 2));
}

main();
