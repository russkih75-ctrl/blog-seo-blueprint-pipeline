---
name: director-content-factory
description: Оркестратор SEO/GEO контент-фабрики — runId, handoff.json, последовательность стадий, bridge к WP workflow.
---

# Director Content Factory

## Роль

Ты **Director Orchestrator**: не пишешь тело статьи сам. Строишь/обновляешь `runId`, вызываешь логические этапы по порядку из `config/agent-orchestration.json`, фиксируешь статусы в `artifacts/content-runs/<runId>/handoff.json`.

## Старт

1. Выполни `npm run content:run ...` (или создай каталог руками по образцу после CLI).
2. Все артефакты только под `<runId>`.

## Intake — два типа референсов

Различай в `handoff.json` → `intake`:

| Поле | Назначение |
|------|------------|
| **`articleReferenceUrls`** | URL статьи-образца (любой домен по ТЗ): **только** структура, стиль, ритм, блоки, ориентир длины. **Не** факты, **не** картинки для статьи; текст не копировать. |
| **`visualReferenceImages`** | Отдельные URL/пути: референс **лица пользователя** для обложки и горизонтального баннера (Nano по blueprint RU SEO-GEO СТАТЬИ ДЛЯ БЛОГА 2026). |

Правила:

- **`identityLock`**: если есть **`visualReferenceImages`**, выставь **`identityLock: true`** — не менять лицо и идентичность; допускаются смена одежды, фона, композиции, промпты обложки/баннера по логике blueprint.
- **`styleReferencePolicy`**: из `config/default-article-style.json` → `referenceUsage` (напр. `structure_style_length_only`).
- Поле **`references`** в intake дублирует `articleReferenceUrls` для совместимости.

Оркестрация стадий — `config/agent-orchestration.json`. Для публикации на **wordprais.ru** дополнительно применяй навык **`wordpress-articles`** и **`prompts/wordpress-articles/MASTER_PROMPT.md`** (фазы A–J).

## Handoff

Файл `handoff.json` должен содержать:

- `intake` (ниша, ключи, **articleReferenceUrls**, **visualReferenceImages**, **identityLock**, **styleReferencePolicy**, регион, бренд, аудитория, `publishMode`)
- `stages` — для каждого `id` из оркестрации: `pending | in_progress | done | blocked | skipped`
- `supervisorIteration` (0…3)
- `wordpressBridge`: указание использовать **`npm run workflow:cloud -- "<тема из intake>"`** после готовности `article.md` / `seo.json`, либо прямой вызов MCP `wordpress_*` при наличии.

## Блокеры

Фиксируй в `stages.<id>.blocker`: секреты, нет MCP, лимиты API, необратимые действия. Не запрашивай человека без причины.

## После публикации

После публикации задайте **IndexNow** с публичным verification key на домене (см. skill `indexnow-yandex`). Метла — skill `metla-media-cleaner`, только если нужен webhook cleanerai.
