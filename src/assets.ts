/** No stock fallback for publish: generated + uploaded media is required. */
export const DEFAULT_BANNER_IN_ARTICLE =
  "";

/** Референсы для Nano при отсутствии пользовательских изображений — нейтральные стоки */
export const DEFAULT_NANO_REFERENCE_IMAGE_URLS: readonly string[] = [
  "http://bytmaster34.ru/wp-content/uploads/2026/05/1776706200543-lxk48gqcs3c-224x300.jpg",
  "http://bytmaster34.ru/wp-content/uploads/2026/05/1776707366899-9kshlushgiv-224x300.jpg",
  "http://bytmaster34.ru/wp-content/uploads/2026/05/1776710984257-8p4bnpwivq9-224x300.jpg",
];

/** Точные имена инструментов MCP KV (дескрипторы клиента Cursor) */
export const MCP_TOOL_WORDSTAT_TOP = "wordstat_get_top_requests";
export const MCP_TOOL_NANO_FALLBACK_PRIMARY = "nano_banana_pro";
export const MCP_TOOL_NANO_FALLBACK_LITE = "nano_banana_2";
export const MCP_TOOL_WP_UPLOAD_MEDIA = "wordpress_upload_media";

export const WORDSTAT_BRIDGE_SYSTEM = `# РОЛЬ
Ты воспроизводишь текстовый дамп смежной семантики в духе отчётов Яндекс.Вордстата (БЕЗ ссылок, БЕЗ JSON).
Реальных API нет — сделай максимально полезную, разнообразную кластеризацию для русскоязычного SEO под РФ.

# ВЫХОД
Три блока с заголовками:

## request1
15–25 коротких поисковых фраз через запятую, связанных с первой сид-фразой.

## request2
то же для второй фразы.

## request3
то же для третьей фразы.

В конце одна строка "summary_keywords:" затем топ-40 уникальных фраз через запятую (все блоки объединённые, без дублей).

Без воды до/после.`;
