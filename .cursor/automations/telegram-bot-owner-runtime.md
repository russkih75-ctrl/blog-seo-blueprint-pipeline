# Автоматизация Cursor: постоянный Telegram owner bot (runtime)

Используйте при создании автоматизации на **[cursor.com/automations](https://cursor.com/automations)** → **New automation**.

Цель: процесс **`npm run bot`** (или эквивалент) крутится в **окружении Cursor Cloud**, где секреты уже заданы в **Environment / Secrets** репозитория — **ничего не коммитьте** в GitHub и не дублируйте значения в файлах репозитория.

---

## Как узнать chat_id

1. Запустите бота (`npm run bot` локально или эта автоматизация / Cloud job).
2. В Telegram отправьте **`/whoami`** или нажмите **«Мой chat_id»** после **`/start`**.
3. Скопируйте **`chat_id`** из ответа в переменную **`TELEGRAM_ALLOWED_CHAT_IDS`** в **Cursor UI → Secrets / Environment** или в локальный **`.env`**.
4. Перезапустите процесс бота или это задание.

---

## Поля в интерфейсе Cursor

**Название (пример):** `Telegram owner bot — runtime`

**Триггер:** **Manual** (ручной запуск при необходимости) или **Scheduled** с длинным интервалом только если продукт Cursor поддерживает «долгоживущие» задания; иначе предпочтительнее **один долгий Cloud Agent session** по инструкции ниже.

**Репозиторий:** ваш подключённый репозиторий с этим проектом.

**Ветка:** рабочая ветка с актуальным кодом бота.

**Окружение (Environment / Secrets):** задайте в дашборде Cursor **имена** переменных (значения только в UI), минимум:

- `TELEGRAM_BOT_TOKEN`
- `CURSOR_API_KEY`
- `CURSOR_MODEL` (или опирайтесь на значение по умолчанию в коде бота)
- `TELEGRAM_ALLOWED_CHAT_IDS` — после первого `/whoami` в Telegram

Опционально (как у локального `.env`): `WORKSPACE_ROOT`, `BOT_TIMEZONE`, `MCP_KV_HTTP_URL`, `MCP_KV_HTTP_BEARER`, `MCP_KV_DOTENV_PATH`, `CONTEXT7_API_KEY`, ключи WordPress/MCP — см. `.env.example`.

**Инструменты:** при необходимости включите **MCP server** (mcp-kv), как в других автоматизациях проекта.

---

## Инструкции агенту (скопируйте в Instructions)

```text
Ты в репозитории blog-seo-blueprint-pipeline. Задача: поднять долгоживущий Telegram-бот владельца (локальный Cursor Agent SDK), используя секреты уже заданные в Environment Cursor для этого репо — не записывай секреты в файлы и не печатай их в лог.

1) Установи зависимости и собери проект:
   npm ci
   npm run build
   npm run typecheck
   npm run bot:env-check
   (TELEGRAM_BOT_TOKEN должен быть **задано**, чтобы бот запускался; CURSOR_API_KEY — **задано** для ответов агента на обычный текст; в выводе только «задано»/«пусто», без значений)

2) Запусти бота на переднем плане до завершения сессии Cloud Agent (чтобы процесс не оборвался преждевременно):
   npm run bot

Если политика среды требует фон и pid-файл в артефактах рабочей копии — после сборки можно:
   npm run bot:start
и мониторить только artifacts/telegram-bot.log (без вывода секретов).

3) Не коммить изменения в .env. Если TELEGRAM_ALLOWED_CHAT_IDS пуст — владелец в Telegram выполняет /whoami или нажимает «Мой chat_id», добавляет chat_id в Secrets Cursor или .env, затем перезапускает job.

4) В отчёте укажи: сборка ok/not ok, что показал bot:env-check (только задано/пусто), запущен ли процесс; не включай токены и ключи.

Функции бота для владельца (после allowlist): режимы /ask · /plan · /agent; публикация статьи из очереди только после явного /publish_article_confirm; /stop_automation выключает локальные расписания и напоминает выключить Cursor Cloud Automations вручную в UI (прямая ссылка приходит в Telegram).
```

---

## Локально без дублирования UI

На своей машине секреты из Cursor UI **автоматически не появляются** в `.env`. Для **`npm run bot`** локально нужен свой `.env` или переменные окружения оболочки. В облаке — только Secrets в Cursor.
