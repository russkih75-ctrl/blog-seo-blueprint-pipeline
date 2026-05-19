# Blog SEO blueprint → Cursor Cloud

Автоматизация по blueprint **«RU SEO/GEO СТАТЬИ ДЛЯ БЛОГА 2026»**: промпты из вашего `.json`, шаги **Wordstat**, **Nano Banana (Kie)** и **WordPress** через MCP **mcp-kv**.

Режим публикации статей для **https://wordprais.ru/** (**«Вордпресс статьи»**): пошаговый регламент для агента — **`prompts/wordpress-articles/MASTER_PROMPT.md`**; HTML-блоки и FAQ — **`prompts/wordpress-articles/HTML_STRUCTURE_WORDPRAIS.md`**; цель и Allowlist ссылок — **`config/wordpress-articles.json`**. Статьи с разметкой «как на mayai» берут с этих страниц **только каркас секций**, без копирования чужого текста и промо.

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

Бот пересылает **только обычный текст** (без `/`) в **локальный** агент `@cursor/sdk` (`Agent.local.cwd` = `WORKSPACE_ROOT`). Команды меню **не** запускают агента. Сессии: один `agentId` на `chat_id`, файл **`.telegram-agent-sessions.json`** в корне workspace (в `.gitignore`). **Режим агента** (Ask / Plan / Agent) хранится в **`.telegram-bot-chat-modes.json`** (тоже в `.gitignore`). Пока задача выполняется, в чате **одно** служебное сообщение с прогресс-баром: после ответа оно **удаляется**.

### Настройка владельца (owner setup)

1. **Где секреты.** Для **Cursor Automations / Cloud Agent** ключи задаются в **дашборде Cursor** (Secrets / Environment репозитория) — они **не** подставляются автоматически в файл `.env` на диске. Для **локального** `npm run bot` нужны те же **имена** переменных в **`.env`** (или в окружении процесса / `--env-file` у Docker).

   **Если секреты уже заданы в Cursor UI** и нужен runtime бота в облаке: создайте автоматизацию по шаблону **`.cursor/automations/telegram-bot-owner-runtime.md`** (или эквивалентный Cloud job): агент выполняет `npm ci` / `npm run build` / `npm run bot` в среде, где переменные уже инжектированы из UI — **в репозиторий значения не копируются**. Локальный `.env` нужен только для запуска **`npm run bot` на своей машине**.

2. **`TELEGRAM_ALLOWED_CHAT_IDS` обязателен для работы агента.** Пока переменная пустая, бот в режиме **начальной настройки**: доступны `/whoami`, `/menu`, `/status`, диагностика очереди (`/queue_status`, `/queue_next` с `--peek`) и подсказки; **агент, расписания и смена очереди без предпросмотра** отключены для всех.

3. **Узнать свой chat_id — см. ниже «Как узнать chat_id».** После этого добавьте число в `TELEGRAM_ALLOWED_CHAT_IDS` и перезапустите процесс бота.

### Как узнать chat_id

1. Запустите бота (локально `npm run bot` или автоматизацию Cursor по шаблону `.cursor/automations/telegram-bot-owner-runtime.md`).
2. В Telegram откройте чат с ботом и отправьте **`/whoami`** (или кнопку **«Мой chat_id»** на клавиатуре после **`/start`**).
3. Скопируйте число **`chat_id`** из ответа.
4. Вставьте его в **`TELEGRAM_ALLOWED_CHAT_IDS`** в **Cursor UI → Secrets / Environment** или в локальный **`.env`** (не коммитьте).
5. Перезапустите бота или задание автоматизации / Cloud.

**Дальше (диагностика и запуск):**

- **Проверка окружения без секретов:** `npm run bot:env-check` — только имена переменных и статус **«задано»** или **«пусто»** (значения не печатаются), плюс режим списка чатов.

- **Очередь Wordstat без резерва ключа и смоук бота:** `npm run bot:sanity` — `wp-wordstat-queue-next --peek` (`peek: true` в JSON), **`wp:queue-audit`** (антидубль **kw_0014–kw_0016** и durable **`data/wordstat-published-keywords.json`**), проверка маркеров в собранном `dist/telegram-bot.js`, нормализация текстовых триггеров публикации/остановки.

- **Только аудит очереди (следующий ключ и причины пропусков):** `npm run wp:queue-audit` (JSON на stdout; машинный вид: `--json`). Дедуп конфига очереди по нормализованной фразе и каноническому интенту: `npm run wp:mark-queue-duplicates` (перезаписывает `keywordQueue` статусами `skipped_duplicate_*`; перед массовым применением можно посмотреть статистику без `--write`: `node scripts/wordstat-mark-queue-duplicates.mjs`).

- **Сборка и запуск:**

```bash
npm install
npm run build
npm run bot
```

При отсутствии **`TELEGRAM_BOT_TOKEN`** процесс завершится с **кратким** сообщением (без stack trace). **`CURSOR_API_KEY`** нужен для пересылки обычного текста агенту: без него диагностика и **`/whoami`** всё равно доступны после запуска с токеном.

- **Фон, pid и логи (без утечки секретов в консоль):**

```bash
npm run bot:start    # npm run build + фоновый node dist/telegram-bot.js, pid → artifacts/telegram-bot.pid
npm run bot:status
npm run bot:stop     # SIGTERM по pid из файла
```

Лог: **`artifacts/telegram-bot.log`**. Альтернатива вручную: `nohup npm run bot >> artifacts/telegram-bot.log 2>&1 & echo $! > artifacts/telegram-bot.pid`. Не коммитьте `.env` и логи с чувствительными данными.

### Переменные (.env)

См. **`.env.example`**. Кратко:

- Чтобы процесс бота поднимался: **`TELEGRAM_BOT_TOKEN`**. Чтобы обычный текст уходил агенту: **`CURSOR_API_KEY`**. **`CURSOR_MODEL`** — из примера или свой (по умолчанию в коде задан разумный fallback).
- **`WORKSPACE_ROOT`** — если пусто: используется **`/workspace`** при наличии каталога, иначе **`process.cwd()`**.
- **`BOT_TIMEZONE`** — по умолчанию **`Europe/Moscow`** в префиксе задач агента.
- **`TELEGRAM_ALLOWED_CHAT_IDS`** — whitelist владельца (см. выше).

Опционально: **`TELEGRAM_AGENT_PERSONALITY`**, **`CONTEXT7_API_KEY`**, **`MCP_KV_HTTP_URL`** / bearer или **`MCP_KV_DOTENV_PATH=.env.mcp.local`**, либо **`~/.cursor/mcp.json`** (`mcp-kv`) для подстановки URL.

Команды в чате: **`/start`** (клавиатура), **`/menu`**, **`/help`**, **`/status`**, **`/whoami`**, режимы **`/ask`**, **`/plan`**, **`/agent`** (и **`/mode_*`**), **`/sessions`**, **`/new_agent`**, **`/reset`**, **`/automations`**, **`/queue_status`**, **`/queue_next`** (peek), **`/publish_article`** → подтверждение **`/publish_article_confirm`**, **`/stop_automation`**, расписания (**`/schedule_*`**). Кнопки «Опубликовать статью» и «Остановить автоматизацию» дублируют часть команд.

### Режимы Ask / Plan / Agent

- **`/ask`** или **`/mode_ask`** — ответы и диагностика **без** правок файлов и без терминальных команд в префиксе задачи (ограничения задаются промптом; разрешение инструментов зависит от Cursor Agent).
- **`/plan`** или **`/mode_plan`** — только **план шагов**, без выполнения.
- **`/agent`** или **`/mode_agent`** — прежняя автономная логика с префиксом автономности из кода.

### Публикация статьи и остановка автоматизации

- Фразы **«опубликуй статью»** / **«опубликовать статью»** (отдельным сообщением), кнопка **«Опубликовать статью»** или **`/publish_article`** — только инструкция и напоминание про **`/publish_article_confirm`**.
- **`/publish_article_confirm`** (владелец): сначала **`npm run wp:wordstat-queue-next`** (резерв ключа), затем одно задание агенту по регламенту «Вордпресс статьи» и **`npm run scenario:wordpress-articles-with-nano`** когда контент готов (как в шаблоне автоматизации). Не запускается, если уже идёт другая задача агента.
- **`/stop_automation`** или кнопка **«Остановить автоматизацию»**: выключаются **локальные** расписания этого чата в боте; **Cursor Cloud Automations** из Telegram не отключаются — бот присылает ссылку на страницу автоматизации в UI.

Если persona в `.env` изменилась — при странном поведении **`/reset`** или **`/new_agent`**.

### Расписание в Telegram

Расписания хранятся локально в **`.telegram-schedules.json`** (не коммитится).

- **`/schedule`** / **`/schedule_list`** — текущий интервал и время следующего запуска.
- **`/schedule_every 30m`** / **`3h`** / **`1d`** — повтор (от 15 минут до 7 суток).
- **`/schedule_queue_every`** — каждый запуск новая тема из очереди Wordstat (полный прогон через агента при включённом allowlist).
- **`/schedule_off`** / **`/schedule_stop`** — выключить автозапуски в этом чате.
- В одном сообщении с задачей можно написать, например: *«…публикация раз в 3 часа»* — шаблон сохранится для следующих запусков.

Плановый запуск выполняет **ту же цепочку Cursor**, что и обычное сообщение. В режиме **bootstrap** тики расписания **не** запускают агента (время следующего запуска отодвигается). Публикация в прод по-прежнему только при **`CONTENT_PUBLISH_MODE=publish`** или **`--publish`** у CLI.

**Очередь Wordstat:** `npm run wp:wordstat-queue-next` — обычный запуск (может зарезервировать ключ). Для предпросмотра без записи state: **`node scripts/wp-wordstat-queue-next.mjs --peek`** (используется командой **`/queue_next`** в боте).

**Персистентность Cloud:** каталог **`artifacts/`** в свежем клоне пуст и не коммитится. Обработанные ключи с verified publication дополнительно фиксируются в **`data/wordstat-published-keywords.json`** (коммитится). Скрипт **`npm run wp:queue-reconcile-published`** помечает ключ вручную, если публикация была подтверждена вне `content:finalize-publish`. После успешного **`npm run content:finalize-publish`** запись в `data/` создаётся автоматически при `media-result` + `publish-verification` = ok.

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

То же под именем целевого сценария **«Вордпресс статьи»**:

```bash
npm run scenario:wordpress-articles
```

**Очередь Wordstat для «Вордпресс статьи»** (семена **ws_01…ws_16**, регион **225**, источник **wordstat_mcp_kv**): конфиг **`config/wordprais-wordstat-automation.json`**. **Правило антидублей:** один **нормализованный ключ** и один **канонический интент** (например всё семейство «SEO + продвижение сайта» в кластере **`c_seo_wp`**) соответствуют **не более одной** опубликованной статье на **`/blog/`**; при сомнении автоматизация должна уйти в **`semantic_refill` / `actionRequired` / пропуск**, а не во вторую статью с тем же интентом. Расписание **раз в 3 часа** означает **следующий publishable** ключ после фильтров — не параллельные дубли.

Скрипт **`npm run wp:wordstat-queue-next`** выводит JSON с **`taskRu`** и резервирует нормализованную фразу в **`artifacts/simple-keyword-queue.json`** (каталог `artifacts/` в `.gitignore`). Долговечный журнал уже опубликованных ключей и заблокированных интентов (в т.ч. посты **541 / 549 / 556** для **kw_0014–kw_0016**): **`data/wordstat-published-keywords.json`** — пополнять после каждой verified-публикации. Последний проход выбора (без секретов): **`data/wordstat-queue-last-selection.json`**. Проверка очереди: **`npm run wp:queue-audit`**. Дедуп строк **`keywordQueue`** в конфиге (exact normalized + canonical intent, лучший приоритет/показы остаётся **active**): **`npm run wp:mark-queue-duplicates`**.

При конфликте с **`artifacts/content-index.json`** очередь может вернуть режим пополнения семантики (**`semantic_refill`**) и **`taskRu`** про **[ЯДрышко](https://github.com/Horosheff/yadryshko-semantic-core-subagent)** (`npm run install:yadryshko-subagent` кладёт репозиторий в **`vendor/`**, не коммитится при записи в `.gitignore`). Антидубль **title / meta / slug** — skill **`duplicate-title-meta-guardian`**.

В Telegram: **`/schedule_queue_every 3h`** — каждые 3 часа новая тема из этой очереди (бот подставляет **`taskRu`** автоматически). Обычное **`/schedule_every`** повторяет один и тот же сохранённый текст и сбрасывает режим очереди.

**Cursor Automations** ([cursor.com/automations](https://cursor.com/automations)): автоматизацию нужно создать в аккаунте Cursor (веб-UI); в репозитории лежит готовый шаблон промпта и настройки триггера — **`.cursor/automations/wordpress-articles-wordstat-3h.md`** (обзор: **`.cursor/automations/README.md`**).

**Ветка для production:** активная автоматизация «Вордпресс статьи — Wordstat 3h» должна указывать на **`cursor/mcp-streamable-wp-publish-0243`**, пока соответствующие правки не смёржены в **`main`**. После merge переключите **Branch** в UI автоматизации на **`main`**, чтобы не зависеть от feature-ветки.

Проверка **публичного** URL поста без WordPress-секретов: **`npm run wp:verify-published -- '<https-URL-страницы>'`** (или переменная **`WP_VERIFY_PUBLISHED_URL`**).

Опционально: **`WORDSTAT_AUTOMATION_CONFIG`** — путь к своей копии JSON-конфига очереди; **`WORDSTAT_PUBLISHED_PATH`** — отдельный файл durable-ключей для второго сайта (см. **`.cursor/automations/bytmaster34-wordpress-articles-3h.md`**).

Уточнение по **`content:finalize-publish`**: run берётся из **`CONTENT_RUN_ID`**, затем из **`pipeline-state.json` → `contentRunId`** (проставляется **`seed:elementor`** / **`wp:publish-streamable`** при заданном **`CONTENT_RUN_ID`**), иначе — **самая новая** запись в **`content-index.json`** по полю **`createdAt`** (раньше ошибочно бралась самая старая).

Скрипт собирает проект, проверяет конфиги, вызывает **`wp:publish-streamable`** (если URL уже есть — пропуск без дубликата, см. **`WP_PUBLISH_FORCE=true`** для нового поста), затем **`content:finalize-publish`**: обновляет **`publish-result.json`**, **`indexnow-result.json`**, **`qa-report.json`** в каталоге запуска (см. выбор **runId** выше).

После того как в **`artifacts/pipeline-state.json`** уже есть текст и выполнен первичный **`wp:publish-streamable`**, можно прогнать **Nano 16:9 (обложка) + 21:9 (баннер)** и загрузку в медиатеку без повторного сидирования темы:

```bash
MCP_REQUEST_TIMEOUT_MS=900000 npm run scenario:wordpress-articles-with-nano
```

(цепочка: **`wp:publish-streamable`** → **`wp:nano-images-republish`** → **`content:finalize-publish`**). Отдельные команды: **`npm run wp:nano-images-republish`**, **`npm run content:finalize-publish`**.

Готовая нейтральная статья про Elementor (**`seed:elementor`**) и полная публикация с **генерацией обложки и баннера через MCP** (`nano_banana_pro` / `nano_banana_2`), загрузкой в медиатеку (**`wordpress_upload_media`**) и обновлением поста:

```bash
npm run scenario:elementor-full
```

Цепочка: **`build`** → **`seed:elementor`** → **`wp:publish-streamable`** → **`elementor:nano-republish`** → **`content:finalize-publish`**. При долгой генерации изображений задайте в `.env` больший **`MCP_REQUEST_TIMEOUT_MS`** (например `900000`).

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

Если в тексте есть слова вроде «статья», «ключи», «опубликовать», «SEO», «GEO», бот добавит блок про **director-content-factory**; упоминание mayai добавляет уточнение про два типа референсов; **wordprais.ru** / «вордпресс статьи» — блок **`wordpress-articles`** и ссылку на **`MASTER_PROMPT.md`**.

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
