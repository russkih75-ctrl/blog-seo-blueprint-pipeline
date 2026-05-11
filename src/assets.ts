/** Дефолтный баннер в теле статьи (константы blueprint, модуль 8 — kv-ai jpeg) */
export const DEFAULT_BANNER_IN_ARTICLE =
  "https://mayai.ru/wp-content/uploads/2025/04/2025-04-14_08-52-43.jpg";

/** Референсные лица blueprint (модули nano 5 и 9 из Make) */
export const DEFAULT_NANO_REFERENCE_IMAGE_URLS: readonly string[] = [
  "https://mayai.ru/wp-content/uploads/2025/11/06bd46d4-89a4-4ad3-bf87-a84adbf8d952.jpg",
  "https://mayai.ru/wp-content/uploads/2025/11/c410cce6a3fa9f9d28915004e46e1c57.jpg",
  "https://mayai.ru/wp-content/uploads/2025/11/3557247553f3360809d41bb5c4ae311c.jpg",
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
