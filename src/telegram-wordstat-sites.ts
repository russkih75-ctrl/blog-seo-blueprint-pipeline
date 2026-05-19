/**
 * Профиль сайта Wordstat / WordPress для Telegram-чата (изоляция от второго сайта).
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export interface TelegramWordstatSiteRow {
  label: string;
  wordstatAutomationConfig: string;
  publishedKeywordsPath: string;
  /** Если задано — подставляются WORDPRESS_*_${suffix} поверх базовых WORDPRESS_* */
  wordpressEnvSuffix: string | null;
}

export interface TelegramWordstatSitesRegistry {
  defaultSite: string;
  sites: Record<string, TelegramWordstatSiteRow>;
}

export function readTelegramWordstatSites(
  workspaceRoot: string,
): TelegramWordstatSitesRegistry {
  const p = path.join(workspaceRoot, "config", "telegram-wordstat-sites.json");
  const raw = JSON.parse(readFileSync(p, "utf-8")) as TelegramWordstatSitesRegistry;
  if (!raw?.sites || typeof raw.sites !== "object")
    throw new Error("Invalid telegram-wordstat-sites.json");
  return raw;
}

export function chatSiteMapPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".telegram-wordstat-site-by-chat.json");
}

export type ChatSiteMap = Record<string, string>;

export function readChatSiteMap(workspaceRoot: string): ChatSiteMap {
  const p = chatSiteMapPath(workspaceRoot);
  try {
    if (!existsSync(p)) return {};
    const j = JSON.parse(readFileSync(p, "utf-8")) as ChatSiteMap;
    return j && typeof j === "object" ? j : {};
  } catch {
    return {};
  }
}

export function writeChatSiteMap(workspaceRoot: string, map: ChatSiteMap): void {
  const p = chatSiteMapPath(workspaceRoot);
  mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(map, null, 2), "utf-8");
  renameSync(tmp, p);
}

export function normalizeSiteKey(
  registry: TelegramWordstatSitesRegistry,
  key: string,
): string {
  const k = key.trim().toLowerCase();
  if (registry.sites[k]) return k;
  const d = registry.defaultSite.trim().toLowerCase();
  return registry.sites[d] ? d : "wordprais";
}

export function getSiteForChat(
  workspaceRoot: string,
  chatId: string | number,
): string {
  const registry = readTelegramWordstatSites(workspaceRoot);
  const map = readChatSiteMap(workspaceRoot);
  const id = String(chatId);
  const fromMap = map[id];
  if (fromMap && registry.sites[fromMap]) return fromMap;
  return normalizeSiteKey(registry, registry.defaultSite);
}

export function setSiteForChat(
  workspaceRoot: string,
  chatId: string | number,
  site: string,
): string {
  const registry = readTelegramWordstatSites(workspaceRoot);
  const k = normalizeSiteKey(registry, site);
  const map = readChatSiteMap(workspaceRoot);
  map[String(chatId)] = k;
  writeChatSiteMap(workspaceRoot, map);
  return k;
}

/** Env для дочерних процессов (очередь Wordstat): не мутирует глобальный process.env. */
export function wordstatSpawnEnv(
  workspaceRoot: string,
  siteKey: string,
): NodeJS.ProcessEnv {
  const registry = readTelegramWordstatSites(workspaceRoot);
  const row = registry.sites[siteKey];
  if (!row) return { ...process.env };
  const base = process.env as NodeJS.ProcessEnv;
  const out: NodeJS.ProcessEnv = { ...base, WORDSTAT_SITE_KEY: siteKey };
  out.WORDSTAT_AUTOMATION_CONFIG = row.wordstatAutomationConfig;
  out.WORDSTAT_PUBLISHED_PATH = row.publishedKeywordsPath;
  const suffix = row.wordpressEnvSuffix?.trim();
  if (suffix) {
    const S = suffix.toUpperCase();
    for (const key of [
      "WORDPRESS_BASE_URL",
      "WORDPRESS_USERNAME",
      "WORDPRESS_APPLICATION_PASSWORD",
    ] as const) {
      const v = base[`${key}_${S}`]?.trim();
      if (v) out[key] = v;
    }
  }
  return out;
}

export function siteAutomationHintBlock(
  workspaceRoot: string,
  siteKey: string,
): string {
  const registry = readTelegramWordstatSites(workspaceRoot);
  const row = registry.sites[siteKey];
  if (!row) return "";
  const npmSite =
    siteKey === "bytmaster34"
      ? "npm run site:bytmaster34"
      : "npm run site:wordprais";
  const wpNote = row.wordpressEnvSuffix
    ? `Для WordPress REST используйте переменные с суффиксом _${row.wordpressEnvSuffix.toUpperCase()} в Secrets (бот уже подставил базовые WORDPRESS_* для очереди); для сценариев агента экспортируйте те же значения в шелл перед npm.`
    : "WordPress: обычные WORDPRESS_* в окружении.";
  return [
    "## Профиль сайта (изоляция от второго проекта)",
    `Активный сайт: **${row.label}** (\`WORDSTAT_SITE_KEY=${siteKey}\`).`,
    `- Очередь: \`${row.wordstatAutomationConfig}\`, durable: \`${row.publishedKeywordsPath}\`.`,
    `- Контент в отдельном файле: при этом ключе используйте **artifacts/pipeline-state.${siteKey === "wordprais" ? "json" : `${siteKey}.json`}** (или задайте \`PIPELINE_STATE_PATH\`).`,
    `- Перед сценариями «Вордпресс статьи» синхронизируйте allowlist: \\\`${npmSite}\\\` (обновляет config/wordpress-articles.json).`,
    `- Экспорт для команд агента (пример):`,
    "```bash",
    `export WORDSTAT_SITE_KEY=${siteKey}`,
    `export WORDSTAT_AUTOMATION_CONFIG=${row.wordstatAutomationConfig}`,
    `export WORDSTAT_PUBLISHED_PATH=${row.publishedKeywordsPath}`,
    "```",
    wpNote,
  ].join("\n");
}
