# Автоматизация Cursor: «Вордпресс статьи» для **https://bytmaster34.ru/**

Отдельная цель публикации от **wordprais.ru**: те же регламенты HTML/качества (`prompts/wordpress-articles/*`), но свой **`config/wordpress-articles.json`**, своя очередь Wordstat и свой durable-журнал ключей.

---

## Безопасность (обязательно)

- Пароли и ключи **не** коммитить в git и **не** вставлять в промпт автоматизации целиком.
- Если доступы уже попадали в скриншоты/чат — **смените пароль приложения WordPress** и при необходимости пароль SSH/FTP в панели хостинга.
- В Cursor задайте секреты через **Repository Secrets / Environment** или локальный `.env` (в `.gitignore`).

---

## Два канала доступа (разное назначение)

| Способ | Зачем |
|--------|--------|
| **WordPress Application Password** + REST (`WORDPRESS_*`) | То, что нужно **mcp-kv** / скриптам публикации (`wordpress_*` tools). Вводится в секретах Cursor или `.env`. |
| **SSH/FTP** (логин, пароль, каталог `/bytmaster34.ru/`) | Типично **панель хостинга**: файлы, бэкапы, ручной деплой. **Не** заменяет MCP-публикацию постов; в пайплайн репозитория по умолчанию не подключён. |

Файл-пример переменных без значений: **`config/bytmaster34.env.example`**.

---

## Файлы в репозитории под этот сайт

| Файл | Назначение |
|------|------------|
| `config/wordpress-articles.bytmaster34.json` | Allowlist URL и политика ссылок для bytmaster34.ru |
| `config/bytmaster34-wordstat-automation.json` | Очередь Wordstat (сейчас **пустой** `keywordQueue` — наполните семантикой) |
| `data/wordstat-published-keywords.bytmaster34.json` | Durable «уже опубликовано» для антидубля по ключам |
| [wordpress-articles-wordstat-3h-automation.UNPACK.md](./wordpress-articles-wordstat-3h-automation.UNPACK.md) | Универсальный шаблон промпта: подставьте `{{TARGET_SITE_URL}}` = `https://bytmaster34.ru/` и медиа-референсы |

Переключить активный **`config/wordpress-articles.json`** на профиль bytmaster34:

```bash
npm run site:bytmaster34
```

Вернуть профиль wordprais из git:

```bash
npm run site:wordprais
```

В **`.env`** (или Secrets) для запусков по bytmaster34:

```bash
WORDSTAT_AUTOMATION_CONFIG=config/bytmaster34-wordstat-automation.json
WORDSTAT_PUBLISHED_PATH=data/wordstat-published-keywords.bytmaster34.json
WORDPRESS_BASE_URL=https://bytmaster34.ru
WORDPRESS_USERNAME=…
WORDPRESS_APPLICATION_PASSWORD=…
```

Пароль приложения WP удобно хранить **без пробелов** (как в REST-клиентах).

---

## Новая Automation в Cursor UI

1. **New automation** → название, например `Вордпресс статьи — bytmaster34 3h`.
2. **Branch** — та же рабочая ветка репозитория, что и для wordprais (или отдельная feature-ветка под bytmaster34).
3. **Cron** — например `0 */3 * * *`.
4. **Secrets**: `WORDPRESS_*`, `MCP_KV_*`, `WORDSTAT_AUTOMATION_CONFIG`, `WORDSTAT_PUBLISHED_PATH` (как выше).
5. **Instructions**: возьмите полный шаблон из **UNPACK §4**, заменив плейсхолдеры на bytmaster34 (сайт, бренд footer, пути конфигов, URL лиц для Nano — ваши постоянные референсы с медиатеки сайта).

Шаг **`npm run wp:queue-audit`** перед резервом ключа оставьте в промпте (антидубль).

---

## После наполнения очереди

1. Добавить ключи в `keywordQueue` или через YADryshko → обновить JSON.
2. `npm run wp:mark-queue-duplicates -- --write` при необходимости.
3. `npm run wp:queue-audit` — проверка следующего publishable.

Пока **`keywordQueue` пуст**, `wp:wordstat-queue-next` вернёт режим пополнения семантики — это ожидаемо.

---

## Один Telegram-бот и изоляция профилей

Можно использовать **тот же** `TELEGRAM_BOT_TOKEN`, что и для wordprais: в чате Telegram выполните **`/site_bytmaster34`** (вернуться: **`/site_wordprais`**), статус профиля — **`/site`**. Очередь, предпросмотр (`/queue_next`), подтверждённая публикация и **`/schedule_queue_every`** опираются на выбранный профиль; файлы состояния и конфиги второго сайта **не смешиваются** с wordprais.

Отдельное облачное задание Cursor «только bytmaster34» может держать в Secrets постоянно **`WORDSTAT_SITE_KEY=bytmaster34`** и при необходимости **`WORDPRESS_*_BYTMASTER34`** — карта полей в **`config/telegram-wordstat-sites.json`**.

---

## mcp-kv и второй сайт

В личном кабинете **mcp-kv** нужен профиль WordPress, указывающий на **https://bytmaster34.ru/** и те же учётные данные REST, что и в `WORDPRESS_*`. Не смешивайте с wordprais в одном запуске без смены секретов/профиля.

---

## Примечание про `MASTER_PROMPT.md`

В шапке файла может быть зафиксирован старый домен wordprais — это **общий регламент этапов**. Фактический сайт, allowlist ссылок и политика берутся из **`config/wordpress-articles.json`** (после `npm run site:bytmaster34`).
