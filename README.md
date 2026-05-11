# Blog SEO blueprint → Cursor Cloud

Автоматизация по blueprint **«RU SEO/GEO СТАТЬИ ДЛЯ БЛОГА 2026»**: промпты из вашего `.json`, шаги **Wordstat**, **Nano Banana (Kie)** и **WordPress** через MCP **mcp-kv**.

**Cursor Cloud через `@cursor/sdk`** чаще всего требует: (1) GitHub‑репозиторий добавленный к вашему Cursor в Dashboard, (2) **HTTP MCP** — URL и Bearer из [личного кабинета mcp-kv.ru](https://mcp-kv.ru/) в переменных `MCP_KV_HTTP_URL` / `MCP_KV_HTTP_BEARER` (удобнее вынести в `.env.mcp.local`, см. `.env.mcp.example` и **`MCP_KV_DOTENV_PATH`**). Так инструменты попадают в облачный агент вместе со скриптом.

## План работ и соответствие модулям Make

См. **[PLAN-RU.md](./PLAN-RU.md)**.

## Быстрый старт

1. Скопируйте blueprint JSON (как в Downloads).
2. Извлеките промпты:

```bash
npm install
npm run extract -- "C:\полный\путь\к\файлу.blueprint.json"
```

3. Скопируйте **`.env.example` → `.env`**, **`.env.mcp.example` → `.env.mcp.local`**, в `.env` добавьте **`MCP_KV_DOTENV_PATH=.env.mcp.local`**. Заполните endpoint и токен HTTP MCP в ЛК [mcp-kv.ru](https://mcp-kv.ru/). Проверка: **`npm run check:cloud-setup`** — `CLOUD_REPO_URL` должен совпасть с репозиторием, подключённым к Cursor (иначе ошибка проверки ветки `main`), а при желании включите **`CLOUD_REQUIRE_MCP_KV_HTTP=true`**, когда URL уже вписан.

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

- **Репозиторий не виден Cloud** (`validation_error … branch 'main'`): у API-ключа пуст или неполный список `Cursor.repositories.list`. **`npm run check:cloud-setup`** (алиас **`check:crsr-repos`**) — добавьте репозиторий в GitHub‑интеграцию Cursor. Либо **`WORKFLOW_RUNTIME=local`** для прогона без Remote GitHub.
- **Инструменты mcp-kv в Cloud**: задайте **`MCP_KV_HTTP_URL`** (+ **`MCP_KV_HTTP_BEARER`**) из ЛК mcp-kv.ru; после заполнения — **`CLOUD_REQUIRE_MCP_KV_HTTP=true`**, чтобы скрипт не стартовал без MCP.
- **Cursor Cloud Background Agent**: при ошибке вида `[usage_limit_exceeded]` нужно включить **usage-based pricing** и **Spend Limit** в [настройках Cursor](https://www.cursor.com/dashboard?tab=settings) (для Background Agent нужен остаток лимита, обычно не менее ~\$2 до hard limit).
- Ветки Router Make (VK, Pinterest, …) не подключены; промпты лежат в `prompts/_extracted/` после extract.
