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

## Telegram-бот → локальный Cursor Agent

Бот пересылает текст в **локальный** агент `@cursor/sdk` (`Agent.local.cwd` = `WORKSPACE_ROOT`), без Cloud Agent. Сессии: один `agentId` на `chat_id`, файл **`.telegram-agent-sessions.json`** в корне workspace (в `.gitignore`). Пока задача выполняется, в чате **одно** служебное сообщение с текстовым прогресс-баром: оно **редактируется**, а после ответа **удаляется**.

### Настройка

1. Скопируйте **`.env.example` → `.env`**, задайте как минимум: **`CURSOR_API_KEY`**, **`TELEGRAM_BOT_TOKEN`**, **`CURSOR_MODEL`**. При необходимости **`WORKSPACE_ROOT`** (абсолютный путь к клону репозитория на сервере).
2. Опционально: **`TELEGRAM_ALLOWED_CHAT_IDS`** (через запятую), **`TELEGRAM_AGENT_PERSONALITY`** / **`TELEGRAM_AGENT_PERSONALITY_FILE`**, **`BOT_TIMEZONE`** (IANA), **`CONTEXT7_API_KEY`** (stdio MCP context7). Чтобы у локального агента были те же инструменты **mcp-kv**, что и у пайплайна, задайте **`MCP_KV_HTTP_URL`** (SSE или HTTP из ЛК [mcp-kv.ru](https://mcp-kv.ru/)), при необходимости **`MCP_KV_HTTP_BEARER`**, либо общий **`MCP_KV_DOTENV_PATH=.env.mcp.local`** — бот подхватывает конфиг так же, как `run-workflow-cloud`. Если URL не в `.env`, можно положить сервер в **`~/.cursor/mcp.json`** (ключ `mcp-kv`): URL подставится автоматически.
3. Сборка и запуск:

```bash
npm install
npm run build
npm run bot
```

Команды в чате: **`/start`**, **`/help`**, **`/reset`**. Если persona в `.env` изменилась, а в сессии старый хеш — в лог пишется предупреждение; при странном поведении выполните **`/reset`**.

### Расписание в Telegram

Расписания хранятся локально в **`.telegram-schedules.json`** (не коммитится).

- **`/schedule`** — текущий интервал и время следующего запуска.
- **`/schedule_every 30m`** / **`3h`** / **`1d`** — повтор (от 15 минут до 7 суток).
- **`/schedule_off`** — выключить автозапуски в этом чате.
- В одном сообщении с задачей можно написать, например: *«…публикация раз в 3 часа»* — шаблон текста сохранится для следующих запусков.

Плановый запуск выполняет **ту же цепочку Cursor**, что и обычное сообщение (одно статус-сообщение с полосой прогресса, затем ответ). Публикация в прод по-прежнему только при **`CONTENT_PUBLISH_MODE=publish`** или **`--publish`** у CLI.

### Docker (опционально)

В репозитории есть **`Dockerfile`** (образ бота, не весь CI-проект). Сборка и запуск с примонтированным репозиторием:

```bash
docker build -t blog-seo-telegram-bot .
docker run --rm --env-file .env -v /path/to/repo:/repo -e WORKSPACE_ROOT=/repo blog-seo-telegram-bot
```

В `.env` задайте **`WORKSPACE_ROOT=/repo`** (как в примере) — туда должен указывать абсолютный путь к рабочей копии проекта внутри контейнера. Файл **`.env`** подхватывается из хоста через `--env-file`; при необходимости продублируйте переменные в командной строке `-e`.

## Content Factory (SEO / GEO / нейропоиск)

Универсальный слой поверх репозитория: **Director + стадии агентов** (см. `config/agent-orchestration.json`, `.cursor/rules/`, `.cursor/skills/`). Реальную статью и публикацию выполняет **локальный Cursor Agent** по артефактам; CLI создаёт каркас запуска и антидубль.

### Быстрый каркас (dry-run по умолчанию)

```bash
npm run content:check
npm run content:run -- --niche "Ваша ниша" --keywords "ключ1, ключ2" --reference "https://example.com/..." --dry-run
```

Публикация включается только явно: **`--publish`** или **`CONTENT_PUBLISH_MODE=publish`** в `.env`.

После того как агент или **`npm run workflow:cloud`** заполнили **`artifacts/pipeline-state.json`**, полный безопасный цикл «WP + синхронизация артефактов как после Telegram»:

```bash
npm run scenario:publish-complete
```

Скрипт собирает проект, проверяет конфиги, вызывает **`wp:publish-streamable`** (если URL уже есть — пропуск без дубликата, см. **`WP_PUBLISH_FORCE=true`** для нового поста), затем **`content:finalize-publish`**: обновляет **`publish-result.json`**, **`indexnow-result.json`**, **`qa-report.json`** в каталоге последнего запуска из **`content-index.json`** (или **`CONTENT_RUN_ID`**).

### Формат задачи в Telegram

В сообщении укажите **нишу**, **ключевые фразы**, при желании **ссылку на статью-образец** (mayai и др.) — она задаёт **только структуру и стиль**, не факты и не иллюстрации текста. Факты собираются отдельно (Research). Для **обложки и горизонтального баннера** опишите или приложите **отдельный референс с вашим лицом** (или URL снимка): лицо и идентичность не меняются (`identity_lock`), меняются при необходимости фон, одежда, композиция по логике blueprint Nano.

**Пример формулировки в одном сообщении:**

```text
Ниша: автоматизация бизнес-процессов на производстве.
Ключи: умное производство 2026, MES внедрение.
Референс статьи (только структура/стиль): https://example.com/.../...
Референс лица для обложки и баннера (отдельно): https://мой-сайт.ru/face-reference.jpg
Публикация: черновик в WP.
```

CLI-эквивалент:

```bash
npm run content:run -- --niche "..." --keywords "..." \
  --reference "https://example.com/..." \
  --visual-reference "https://example.com/face.jpg" \
  --dry-run
```

Если в тексте есть слова вроде «статья», «ключи», «опубликовать», «SEO», «GEO», бот добавит блок про **director-content-factory**; упоминание mayai добавляет уточнение про два типа референсов.

### Антидубль

Глобальный индекс: **`artifacts/content-index.json`** (в `.gitignore`). Логика в `src/content-factory/duplicate-guardian.ts`: exact fingerprint, **simhash** с порогами **> 0.82 блок**, **0.65–0.82 — перепись / новый angle**. Отчёт по запуску: `duplicate-report.json` в каталоге run.

### AI Метла (cleanerai, как Make-модуль)

Ожидаемый результат — **`cleanedImageUrl`** (или исходный URL при pass-through). Задайте **`METLA_WEBHOOK_URL`** или **`METLA_ENDPOINT`**: POST JSON `{ imageUrl, runId, mode }`, ответ с полем вроде `cleanedImageUrl` / `url`. Секретный API key **не нужен**. Если endpoint не задан, пайплайн возвращает **pass-through** исходного изображения. **`METLA_REQUIRE=true`** блокирует **publish**, пока webhook не настроен (см. `media-metla.json`).

### Yandex IndexNow

Приватного API key **нет**. Нужны публичный **verification key** и файл на вашем домене (обычно `https://<хост>/<ключ>.txt` с содержимым = ключ), как требует [протокол IndexNow](https://www.indexnow.org/):

- **`INDEXNOW_KEY`** — строка ключа (дубликат допускается в именах **`YANDEX_INDEXNOW_VERIFICATION_KEY`** или устаревшее **`YANDEX_INDEXNOW_KEY`**).
- **`INDEXNOW_KEY_LOCATION`** — полный HTTPS URL этого файла (или **`YANDEX_INDEXNOW_KEY_LOCATION`**).
- **`SITE_HOST`** — имя хоста (например `example.ru`), если нужно для генерации каркаса.

Подготовка файла локально без отправки URL:

```bash
npm run content:indexnow -- --prepare-key --host https://example.com
```

Отправка URL (вывод JSON как у Make-модуля: `ok`, `mode`, `httpStatus`, `status`, `detail`, при необходимости `actionRequired`):

```bash
npm run content:indexnow -- --urls https://example.com/page
# или
npm run content:indexnow -- https://example.com/page
```

Без настроенного ключа и URL файла CLI создаст ключ локально и вернёт **`needs_key_file_upload`** — это не ошибка процесса. Коды **200** и **202** считаются успешной отправкой (`submitted` / `accepted_pending_verification`). Значения ключа в логах не печатаются.

### Где артефакты

`artifacts/content-runs/<runId>/`: **`handoff.json`**, **`article.md`**, **`seo.json`**, **`qa-report.json`**, и др. Шаблон промпта для агента: **`ORCHESTRATOR_PROMPT.md`**.

### WordPress bridge

Для полного legacy-пайплайна Make (Wordstat, Nano и т.д.) используйте **`npm run workflow:cloud`** по **`src/run-workflow-cloud.ts`** — см. handoff `wordpressBridge` в `handoff.json`.

## Ограничения

- **Репозиторий не виден Cloud** (`validation_error … branch 'main'`): у API-ключа пуст или неполный список `Cursor.repositories.list`. **`npm run check:cloud-setup`** (алиас **`check:crsr-repos`**) — добавьте репозиторий в GitHub‑интеграцию Cursor. Либо **`WORKFLOW_RUNTIME=local`** для прогона без Remote GitHub.
- **Инструменты mcp-kv в Cloud**: задайте **`MCP_KV_HTTP_URL`** (+ **`MCP_KV_HTTP_BEARER`**) из ЛК mcp-kv.ru; после заполнения — **`CLOUD_REQUIRE_MCP_KV_HTTP=true`**, чтобы скрипт не стартовал без MCP.
- **Cursor Cloud Background Agent**: при ошибке вида `[usage_limit_exceeded]` нужно включить **usage-based pricing** и **Spend Limit** в [настройках Cursor](https://www.cursor.com/dashboard?tab=settings) (для Background Agent нужен остаток лимита, обычно не менее ~\$2 до hard limit).
- Ветки Router Make (VK, Pinterest, …) не подключены; промпты лежат в `prompts/_extracted/` после extract.
