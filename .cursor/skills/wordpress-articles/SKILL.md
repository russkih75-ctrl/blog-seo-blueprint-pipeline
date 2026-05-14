---
name: wordpress-articles
description: Автоматизация «Вордпресс статьи» для wordprais.ru — структура как blueprint/mayai-каркас, HTML, Nano 16:9/21:9 через MCP, WordPress upload/publish.
---

# Вордпресс статьи

## Когда применять

Запросы на статьи **для публикации на wordprais.ru**, «как в blueprint», «как на mayai по структуре», WordPress + MCP kv, обложка/баннер заданных пропорций.

## Источник истины по шагам

Выполняй регламент из **`prompts/wordpress-articles/MASTER_PROMPT.md`** (фазы A–J), без пропуска обязательных проверок.

## Конфигурация цели

- **`config/wordpress-articles.json`** — домен, Allowlist ссылок, соотношения Nano, pipeline загрузки.
- **`prompts/wordpress-articles/HTML_STRUCTURE_WORDPRAIS.md`** — точная схема HTML-блоков под тему сайта.

## Связь с Content Factory

Оркестрация стадий по-прежнему **`config/agent-orchestration.json`** и навык **`director-content-factory`**. Для режима «Вордпресс статьи» дополнительно:

- В **`handoff.json`** укажи целевой сайт и запрет внешних промо-ссылок с чужих статей-образцов.
- Статья-образец (mayai и т.д.) — **structure-only** (см. `structureReference` в JSON).

## MCP

- Генерация: **`nano_banana_pro`** / **`nano_banana_2`** (`aspect_ratio` **16:9** и **21:9**).
- Загрузка: **`wordpress_upload_media`** (предпочтительно), затем **`featured_media`** / **`wordpress_set_featured_image`**.
- Диагностика инструментов: **`npm run mcp:tools-check`**.

## NPM-сценарии

- **`npm run scenario:wordpress-articles`** — публикация из `artifacts/pipeline-state.json` + финализация.
- **`npm run wp:nano-images-republish`** — повторная генерация изображений и привязка к уже созданному посту.

Увеличивай **`MCP_REQUEST_TIMEOUT_MS`** при долгой генерации изображений.
