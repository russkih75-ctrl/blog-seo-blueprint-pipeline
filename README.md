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

3. Настройте `.env` из `.env.example`: минимум **`CURSOR_API_KEY`**; **`CLOUD_REPO_URL`** для режима Cloud; **`CURSOR_MODEL=composer-2`**. Если Cloud пишет, что не видит ветку `main`, выполните `npm run check:crsr-repos` и добавьте репозиторий в интеграцию GitHub в [настройках Cursor](https://www.cursor.com/dashboard?tab=settings), либо временно включите **`WORKFLOW_RUNTIME=local`** (локальный агент, без привязки репо). Убедитесь, что **mcp-kv** включён для агентов (Cloud и/или inline `MCP_KV_HTTP_URL` при local).

4. Запустите цепочку:

```bash
npm run workflow:cloud -- "Тема статьи как в ячейке Google Sheets A1"
```

То же с явной загрузкой `.env` в обёртке (удобно для планировщика и фоновых запусков):

```bash
npm run workflow:run -- "Тема статьи"
```

Опционально: длинный прогон в фоне (лог в `artifacts/workflow-last-run.log`):

```bash
node scripts/start-workflow-bg.mjs "Тема статьи"
```

Промежуточное состояние: `artifacts/pipeline-state.json`.

## Ограничения

- **Репозиторий не виден Cloud** (`validation_error … branch 'main'`): у API-ключа пуст список `Cursor.repositories.list`. Запустите **`npm run check:crsr-repos`** и при необходимости добавьте `CLOUD_REPO_URL` в связанные с Cursor GitHub репозитории, или используйте **`WORKFLOW_RUNTIME=local`** для прогона на этой машине.
- **Cursor Cloud Background Agent**: при ошибке вида `[usage_limit_exceeded]` нужно включить **usage-based pricing** и **Spend Limit** в [настройках Cursor](https://www.cursor.com/dashboard?tab=settings) (для Background Agent нужен остаток лимита, обычно не менее ~\$2 до hard limit).
- Ветки Router Make (VK, Pinterest, …) не подключены; промпты лежат в `prompts/_extracted/` после extract.
