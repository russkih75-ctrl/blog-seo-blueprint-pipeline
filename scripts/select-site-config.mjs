#!/usr/bin/env node
/**
 * Переключает активный конфиг «Вордпресс статьи» между сайтами в одном репозитории.
 * Очередь Wordstat и durable-ключи задаются отдельно через .env (см. .env.bytmaster34.example).
 */
import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ARTICLES = {
  bytmaster34: path.join(ROOT, "config", "wordpress-articles.bytmaster34.json"),
};

function main() {
  const site = process.argv[2]?.toLowerCase();
  if (!site || !["bytmaster34", "wordprais"].includes(site)) {
    console.error(
      "Usage: node scripts/select-site-config.mjs <bytmaster34|wordprais>",
    );
    process.exit(2);
  }

  const dst = path.join(ROOT, "config", "wordpress-articles.json");

  if (site === "wordprais") {
    const r = spawnSync("git", ["checkout", "--", "config/wordpress-articles.json"], {
      cwd: ROOT,
      encoding: "utf-8",
    });
    if (r.status !== 0) {
      console.error(r.stderr?.trim() || r.stdout?.trim() || "git checkout failed");
      process.exit(1);
    }
    console.error("Restored config/wordpress-articles.json from git (wordprais).");
    console.error(
      "Unset WORDSTAT_AUTOMATION_CONFIG / WORDSTAT_PUBLISHED_PATH or set them для очереди wordprais.",
    );
    return;
  }

  const src = ARTICLES[site];
  if (!src || !existsSync(src)) {
    console.error(`Missing source config for ${site}`);
    process.exit(1);
  }

  copyFileSync(src, dst);
  console.error(`Copied ${path.relative(ROOT, src)} -> config/wordpress-articles.json`);
  console.error("Добавьте в .env (или Cursor Secrets) для этого сайта:");
  console.error("  WORDSTAT_AUTOMATION_CONFIG=config/bytmaster34-wordstat-automation.json");
  console.error("  WORDSTAT_PUBLISHED_PATH=data/wordstat-published-keywords.bytmaster34.json");
  console.error("Плюс WORDPRESS_* и MCP_KV_* — см. config/bytmaster34.env.example");
}

main();
