# Blog SEO blueprint → Cursor Cloud

Автоматизация по blueprint **«RU SEO/GEO СТАТЬИ ДЛЯ БЛОГА 2026»**: промпты из вашего `.json`, шаги **Wordstat**, **Nano Banana (Kie)** и **WordPress** через инструменты **mcp-kv**, уже подключённые в Cursor (**cursor.com/agents**). Отдельный `MCP_KV_HTTP_URL` в `.env` **не обязателен** — только если хотите передать MCP из скрипта по HTTP с Bearer.

Дальше всё гоняется **Cursor Cloud** (`@cursor/sdk`).

## План работ и соответствие модулям Make

См. **[PLAN-RU.md](./PLAN-RU.md)**.

## Быстрый старт

1. Скопируйте blueprint JSON (как в Downloads).
2. Извлеките промпты:

```bash
npm install
npm run extract -- "C:\полный\путь\к\файлу.blueprint.json"
```

3. Настройте `.env` из `.env.example`: минимум **`CURSOR_API_KEY`**, **`CLOUD_REPO_URL`**. Убедитесь, что **mcp-kv** включён в Cursor для облачных агентов.

4. Запустите цепочку:

```bash
npm run workflow:cloud -- "Тема статьи как в ячейке Google Sheets A1"
```

Опционально: длинный прогон в фоне (лог в `artifacts/workflow-last-run.log`):

```bash
node scripts/start-workflow-bg.mjs "Тема статьи"
```

Промежуточное состояние: `artifacts/pipeline-state.json`.

## Ограничения

- **Cursor Cloud Background Agent**: при ошибке вида `[usage_limit_exceeded]` нужно включить **usage-based pricing** и **Spend Limit** в [настройках Cursor](https://www.cursor.com/dashboard?tab=settings) (для Background Agent нужен остаток лимита, обычно не менее ~\$2 до hard limit).
- Ветки Router Make (VK, Pinterest, …) не подключены; промпты лежат в `prompts/_extracted/` после extract.
