# Cursor Automations — шаблоны для этого репозитория

Автоматизации Cursor создаются **в аккаунте**, не через коммит в GitHub: [Automations](https://cursor.com/automations) → **New automation**.

Файлы здесь — это **готовые тексты** для копирования в форму (триггер, репозиторий, ветка, инструменты, промпт).

| Файл | Назначение |
|------|------------|
| [telegram-bot-owner-runtime.md](./telegram-bot-owner-runtime.md) | Постоянный Telegram owner bot: секреты только из Cursor UI Environment/Secrets |
| [wordpress-articles-wordstat-3h.md](./wordpress-articles-wordstat-3h.md) | Раз в 3 часа: очередь Wordstat → статья wordprais.ru → публикация через MCP |

Сейчас production automation в аккаунте обычно на **`cursor/mcp-streamable-wp-publish-0243`** (после merge в `main` — переключить Branch в UI); подробнее в начале `wordpress-articles-wordstat-3h.md` и в корневом **README**.

Документация продукта: [Cursor Automations](https://cursor.com/docs/cloud-agent/automations).
