/** Дефолтный баннер в теле статьи (нейтральный сток, без привязки к доменам заказчика) */
export const DEFAULT_BANNER_IN_ARTICLE =
  "https://images.unsplash.com/photo-1467232004584-a241de8bcf5d?w=1600&q=80";

/** Референсы для Nano при отсутствии пользовательских изображений — нейтральные стоки */
export const DEFAULT_NANO_REFERENCE_IMAGE_URLS: readonly string[] = [
  "https://images.unsplash.com/photo-1547658719-da9b46aea9e8?w=1200&q=80",
  "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1200&q=80",
  "https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=1200&q=80",
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
