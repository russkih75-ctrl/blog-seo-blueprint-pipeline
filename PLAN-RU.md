# План: воронка «RU SEO/GEO СТАТЬИ ДЛЯ БЛОГА 2026» → WordPress (Cursor Cloud)

## План работ (чеклист)

1. Положить файл `*.blueprint.json` от Make (как в Downloads).
2. Выполнить `npm install` в каталоге `blog-seo-blueprint-pipeline`.
3. Запустить экстрактор: `npm run extract -- "<путь к json>"` — появится `prompts/_extracted/` с **всеми** текстами промптов.
4. Скопировать `.env.example` → `.env`; нужны только **`CURSOR_API_KEY`** и **`CLOUD_REPO_URL`**. Сервер **mcp-kv** достаточно включить в Cursor (**cursor.com/agents** или командные MCP) — отдельный `MCP_KV_HTTP_URL` не обязателен.
5. Запустить: `npm run workflow:cloud -- "тема черновика"` (аналог ячейки A1).
6. Проверить `artifacts/pipeline-state.json` и логи MCP на финальном шаге WordPress.

Исходник — экспорт blueprint Make.com из JSON (`*.blueprint.json`). Ниже — **как в исходной сцене до развилки на соцсети**.

## Последовательность модулей (ветка статей WP)

| Порядок | ID Make | Роль в автоматизации |
|---------|---------|----------------------|
| 1 | **1** | Тема как в Google Sheets A1 → CLI / `BLUEPRINT_TOPIC_RAW`. |
| 2 | **39** | Сиды `k1,k2,k3` (промпт из `_extracted`). |
| 3 | **3** | Три вызова MCP **`wordstat_get_top_requests`** (инструмент из подключённого в Cursor **mcp-kv**). Суррогат только если `WORDSTAT_FALLBACK_SURROGATE_ONLY=true` или `WORDSTAT_USE_MCP=false`. |
| 4 | **40** | SEO-заголовок. |
| 5 | **5** | Обложка: MCP **`nano_banana_pro`** / **`nano_banana_2`**, промпт мод. **5**, 16:9. |
| 6 | **41** | Исследование (+ Google Search grounding в исходном blueprint). |
| 7 | **9** | Баннер 21:9 (тот же nano-инструмент, промпт мод. **9**). |
| 8 | **≈11** | Опционально **`wordpress_upload_media`** по CDN-URL баннера для стабильного `{{11.source_url}}`. |
| 9 | **8** | Константы (ссылки/баннеры) из текста `_extracted` модуля **8**. |
| 10 | **42** | Тело HTML статьи. |
| 11 | **43** | Мета description. |
| 12 | **44** | JSON описания загрузки Featured. |
| 13 | **15→17** | Финально **`wordpress_*`** с того же подключённого **mcp-kv** (или отдельный `WORDPRESS_MCP_HTTP_URL` в `.env` при редком split-ендпоинте). |

## Справочник имён MCP (могут изменяться — сверять с вашим `tools/list`)

Снято с дескрипторов Cursor для сервера `user-mcp-kv` (брендовое имя **mcp-kv**):

| Назначение | Имя инструмента |
| ------------ | ---------------- |
| Яндекс.Вордстат топ-фраз | `wordstat_get_top_requests` (аргументы: `phrase`, `numPhrases`, `regions[]`, `devices[]`) |
| Регионы / динамика / дерево регионов при необходимости | `wordstat_get_regions`, `wordstat_get_dynamics`, `wordstat_get_regions_tree` … |
| Генерация обложки/баннера Kie | **`nano_banana_pro`** (до 8 `image_input`) или **`nano_banana_2`** (до 14) |
| Загрузка файла из URL в WP | `wordpress_upload_media` |
| Аплоад Featured и пост | `wordpress_upload_image_from_url`, `wordpress_create_post`, blob-цепочка и т.д. (правила MCP-KV см. ваш кабинет mcp-kv.ru) |

Подключение **HTTP MCP URL в `.env`** нужно только если вы хотите передать ключ серверу из скрипта; при типичной настройке Cursor достаточно **dashboard MCP** для облачных агентов.

Развилка Make (VK, Threads, Telegram, Pinterest и др.) в этой репозиторной автоматизации **не реализована** — можно добавить отдельными шагами по извлечённым промптам в `prompts/_extracted/045_*.md …`.

## Откуда берутся промпты

Один раз:

```bash
npm run extract -- "C:\Users\User\Downloads\RU SEO-GEO СТАТЬИ ДЛЯ БЛОГА 2026.blueprint (17).json"
```

Создаётся каталог `prompts/_extracted/` с текстами **без переформулировок**.

## Как запускается пайплайн

```bash
copy .env.example .env
npm install
npm run workflow:cloud -- "Сырой заголовок темы как в Google Sheets"
```

Каждый шаг конвейера = отдельный вызов `Agent.prompt` в **Cursor Cloud** (команда задаётся в `.env`). Результат шагов пишется в `artifacts/pipeline-state.json`.

## Ограничения и точки улучшения

- Если инструменты не видны агенту, проверьте включение **mcp-kv** в настройках Cursor Cloud Agents и тариф/лимиты.
- Разметка GEO-промпта мод. **42** допускает списки; если ваш WordPress MCP при `wordpress_create_post` запрещает `<ul>/<ol>`, финальный облачный агент может нормализовать HTML до вызова инструментов или использовать blob-создание поста после правки текста агентом.
- Развилка роутера Make (соцсети) всё так же описана промптами в `prompts/_extracted/` — при необходимости добавить отдельные шаги в `run-workflow-cloud.ts`.
