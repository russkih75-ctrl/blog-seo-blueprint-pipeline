# Автоматизация Cursor: «Вордпресс статьи» по очереди Wordstat (каждые 3 часа)

Используйте этот файл при создании автоматизации на **[cursor.com/automations](https://cursor.com/automations)** → **New automation**.

---

## Поля в интерфейсе Cursor

**Название (пример):** `Вордпресс статьи — Wordstat 3h`

**Триггер:** Scheduled → интервал **Every 3 hours**  
*(или cron `0 */3 * * *` — см. подсказку по часовому поясу в UI Cursor)*

**Репозиторий:** `russkih75-ctrl/blog-seo-blueprint-pipeline`  
**Ветка:** рабочая ветка с актуальными скриптами (например `main` или ваша feature-ветка после merge).

**Окружение (Environment):** включите установку зависимостей для этого репозитория (**enabled** в настройках Cloud Agent для репо), чтобы выполнялись `npm ci` / сборка. Секреты (**MCP_KV_HTTP_URL**, ключи WordPress через MCP, при необходимости **CURSOR_**/Cloud — только то, что вы уже задаёте в [Cloud Agents setup](https://cursor.com/docs/cloud-agent/setup)) добавьте в дашборде Cursor для этого репозитория; в промпт их не вставляйте.

**Инструменты (Tools):** включите **MCP server**, подключённый к вашему **mcp-kv** (WordPress + nano_*), как в локальной работе. При необходимости включите **Memories**, если хотите, чтобы автоматизация помнила последний опубликованный URL между запусками (опционально).

---

## Промпт автоматизации (скопируйте целиком в поле Instructions)

```text
Ты работаешь в репозитории blog-seo-blueprint-pipeline как Cloud Agent. Задача одного запуска: по очереди Wordstat взять следующую тему и довести до опубликованной статьи на wordprais.ru по регламенту «Вордпресс статьи».

ОБЯЗАТЕЛЬНО:

1) Установи зависимости и собери проект при необходимости:
   npm ci
   npm run build

2) Получи ТЗ очереди Wordstat (JSON в stdout):
   npm run wp:wordstat-queue-next
   Распарсь JSON: поля mode, taskRu, phrase, seedId, clusterId.

3) Если mode === "semantic_refill":
   Выполни инструкции из taskRu (ЯДрышко / расширение config/wordprais-wordstat-automation.json, npm run install:yadryshko-subagent при необходимости). Открой PR или зафиксируй изменения по правилам репозитория. Публикацию статьи в этом запуске не делай, если очередь не пополнена.

4) Если mode === "topic":
   Используй taskRu как основное ТЗ пользователя. Дальше строго следуй цепочке в prompts/wordpress-articles/MASTER_PROMPT.md (фазы A–J) и prompts/wordpress-articles/HTML_STRUCTURE_WORDPRAIS.md, config/wordpress-articles.json.
   Перед финальной фиксацией SEO выполни отдельный проход по skill duplicate-title-meta-guardian (уникальность seoTitle, meta description, slug относительно artifacts/content-index.json и при доступности — wordpress_search_posts). Затем duplicate-guardian по тексту статьи.
   Сгенерируй обложку 16:9 и баннер 21:9 через MCP nano_* и залей в WordPress (wordpress_upload_media / featured), как в NANO_WORDPRESS_STUDIO.md.
   Заполни artifacts/pipeline-state.json (seoTitle, metaDescription, articleHtml, метаданные изображений при наличии).

5) Публикация npm-цепочкой после готового pipeline-state:
   npm run scenario:wordpress-articles-with-nano
   Если по политике нужна только публикация без nano — npm run scenario:wordpress-articles.
   При уже опубликованном URL и блокировке дубликата см. WP_PUBLISH_FORCE в README (не включай без причины).

6) В конце кратко отчитайся: seedId, phrase, режим mode, ссылка на пост если есть, ошибки MCP/npm.

Не выводи в лог секреты и полные URL MCP с токенами. Соблюдай allowlist ссылок только на wordprais.ru для исходящих ссылок в тексте.
```

---

## После сохранения

Включите автоматизацию (**Enable**) и проверьте первый запуск вручную из списка Automations.

Если расписание «раз в 3 часа» должно совпадать с локальной TZ — уточните часовой пояс в UI триггера (Cursor документирует возможную задержку старта).
