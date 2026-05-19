# Развёртывание автоматизации «Вордпресс статьи — Wordstat 3h» в другой нише

Этот файл — **единая точка входа для агента/человека**: как перенести действующую автоматизацию Cursor (Composer / Cloud Agent + MCP + cron) на **другой сайт, семантику и медиа-референсы**, ничего не потеряв.

Связанные артефакты в репозитории:

| Файл | Зачем |
|------|--------|
| [wordpress-articles-wordstat-3h.md](./wordpress-articles-wordstat-3h.md) | Человекочитаемый туториал по полям UI Automations |
| [bytmaster34-wordpress-articles-3h.md](./bytmaster34-wordpress-articles-3h.md) | Пример второго сайта в том же репо: переменные окружения и файлы конфигов |
| [wordpress-articles-wordstat-3h-automation.template.json](./wordpress-articles-wordstat-3h-automation.template.json) | Каркас ключей JSON с плейсхолдерами (не вставлять в UI с ключом `_comment`) |

---

## 1. Карта полей экспорта Cursor Automation (не пропустить)

При создании **New automation** в [Automations](https://cursor.com/automations) или при импорте из JSON проверьте:

| Поле / блок | Обязательно | Что менять в новой нише |
|-------------|-------------|-------------------------|
| `name` | да | Человекочитаемое имя автоматизации |
| `prompts[0].prompt` | да | Весь регламент ниже (§4), с подстановкой переменных |
| `model` | да | Slug модели в вашем аккаунте (например `composer-2`) |
| `triggers[0].cron.cron` | да | Расписание; типично `0 */3 * * *` для «каждые 3 часа» |
| `actions[]` / MCP | да | Сервер **mcp-kv** (или ваш); **`id` сервера** взять из дашборда Cursor — **не копировать вслепую** из примера |
| `gitConfig.repo` | да | URL репозитория с пайплайном |
| `gitConfig.branch` | да | Production-ветка (до merge — feature-ветка, после — `main`) |
| `gitConfig.repos` | да | Обычно тот же repo один раз в массиве |
| `agentOptions.skipInstall` | опционально | `true` если зависимости уже в образе; иначе убрать или `false` |
| `memoryEnabled` | опционально | Память вкладок между запусками |

**Не коммитить в git:** токены, `.env`, raw MCP URL с bearer, Telegram secrets, пароли WP. В промпте автоматизации — **не вставлять** секреты; они задаются в Environment репозитория в Cursor.

---

## 2. Переменные для подстановки в промпт (глоссарий)

Перед копированием §4 замените:

| Плейсхолдер | Пример (wordprais) | Назначение |
|-------------|-------------------|------------|
| `{{GIT_BRANCH_PRODUCTION}}` | `cursor/mcp-streamable-wp-publish-0243` | Ветка в UI Automation |
| `{{TARGET_REPO}}` | `russkih75-ctrl/blog-seo-blueprint-pipeline` | Репозиторий пайплайна |
| `{{TARGET_SITE_URL}}` | `https://wordprais.ru/` | Целевой сайт статей |
| `{{SITE_BRAND_FOOTER}}` | `wordprais.ru` или «Андрей Русских» | Нейтральный footer на обложке вместо чужих @ |
| `{{WORDSTAT_AUTOMATION_JSON}}` | `config/wordprais-wordstat-automation.json` | Путь к очереди Wordstat (или свой конфиг + env `WORDSTAT_AUTOMATION_CONFIG`) |
| `{{NICHE_HINT}}` | WordPress, SEO/GEO, безопасность, восстановление… | Куда «гнуть» сцены и термины в медиа-промптах |
| `{{BLUEPRINT_PATH_HINT}}` | Путь к `.blueprint.json` на машине агента или артефакт в репо | Источник логики Make «Обложка» / «баннер» |
| `{{FACE_URL_PRIMARY}}` | URL эталона лица 16:9/21:9 | Главный `image_input`, `identity_lock=true` |
| `{{FACE_URL_EXTRA_1}}`, `{{FACE_URL_EXTRA_2}}` | доп. референсы | Face-consistency |
| `{{CRON_HUMAN}}` | каждые 3 часа | Фраза для промпта (соответствует cron `0 */3 * * *`) |

---

## 3. Чеклист инженерных файлов репозитория (после смены нише/домена)

Агент после адаптации промпта должен проверить в **коде/конфиге**, а не только в UI:

1. **Очередь Wordstat** — `{{WORDSTAT_AUTOMATION_JSON}}`: семена, кластеры, `keywordQueue`, при необходимости `npm run wp:mark-queue-duplicates`.
2. **Durable опубликованные ключи** — `data/wordstat-published-keywords.json` (и при необходимости `npm run wp:queue-reconcile-published`).
3. **Антидубль** — `npm run wp:queue-audit`; правило: один нормализованный ключ / один канонический интент ≈ одна статья (см. README и `scripts/wordstat-queue-core.mjs`).
4. **Регламент статей** — `prompts/wordpress-articles/MASTER_PROMPT.md`, `HTML_STRUCTURE_WORDPRAIS.md`, `config/wordpress-articles.json`.
5. **Стадии качества** — в промпте зафиксированы: seo-content-writer → humanizer → content-structure-director; не выкидывать при переносе.
6. **Сценарии npm** — `npm run wp:wordstat-queue-next`, `scenario:wordpress-articles-with-nano` и т.д. из корневого README.

---

## 4. Полный шаблон промпта (вставить в поле Instructions)

Скопируйте блок ниже в **`prompts[0].prompt`** после замены всех `{{…}}`.

```text
Ты работаешь в репозитории {{TARGET_REPO}} как Composer 2 / Cursor Agent.

Ветка Git: сейчас production-ветка этой Automation в UI — {{GIT_BRANCH_PRODUCTION}}. Пока PR не смержен, работай и запускай проверки в этой ветке. После merge в main можно переключить Branch в UI на main.

Твоя задача: каждые {{CRON_HUMAN}} запускать автоматизацию публикации статей WordPress так, чтобы конечный результат был стабильным: опубликованная, публично доступная, непустая статья с проверенным URL.

Главная цель: не “сделать вид”, что статья опубликована, а реально довести задачу до результата. Обязателен content-structure-director: перед публикацией он проверяет mayai-like структуру, наполненность, логику, пользу, SEO/GEO/нейропоиск, таблицу, FAQ, useful resources, next steps, обложку и баннер. Если директор не поставил pass, публикацию блокировать. Если что-то ломается, ты сам диагностируешь, исправляешь код/конфиг/артефакты в рамках проекта, повторяешь проверки и только потом завершаешь запуск. К человеку обращайся только при настоящем блокере: нет секрета/доступа, внешний сервис недоступен, требуется платное действие, необратимое удаление или Cursor SDK не может сам починить проблему.

Ограничения безопасности:
- Не печатай .env, токены, endpoint MCP, Telegram token, WordPress password, API keys.
- Не добавляй .env в git.
- Не делай commit/push без отдельного разрешения владельца.
- Не удаляй ключевое слово/seed/задачу из очереди, пока статья не прошла verified publication.

Verified publication = есть postId + public URL + HTTP 2xx + страница не 404 + title/body не содержат “Страница не найдена”, “Oops”, “not found”, “error-404” + на странице есть осмысленный контент статьи.

Рабочий цикл одного запуска:

1. Проверь окружение и здоровье:
   - npm install/npm ci только если нужно.
   - npm run build.
   - npm run typecheck.
   - проверь Telegram-бот: artifacts/telegram-bot.pid, telegram-bot.log без 409/getUpdates/env/Cursor errors (не логируй секреты).
   - проверь MCP tools/list без вывода endpoint/секретов.

2. Возьми следующую тему/ключ из очереди Wordstat:
   - npm run wp:queue-audit (антидубль: следующий publishable ключ).
   - npm run wp:wordstat-queue-next
   - распарсь mode, taskRu, phrase, seedId, clusterId.
   - если очередь пустая или semantic_refill — выполни инструкцию пополнения очереди (конфиг {{WORDSTAT_AUTOMATION_JSON}}), но не имитируй публикацию.

3. Подготовь статью:
   - следуй prompts/wordpress-articles/MASTER_PROMPT.md для сайта {{TARGET_SITE_URL}}.
   - соблюдай HTML_STRUCTURE_WORDPRAIS.md.
   - референсы mayai/другие статьи использовать только как структуру/стиль/длину, не как источник фактов и не как источник изображений.
   - факты проверять отдельно, не выдумывать статистику.
   - включить SEO/GEO/AI-search: title, meta, slug, H1-H3, FAQ, schema, AI-quotable blocks, internal links.
   - пройти humanizer stage: убрать AI-slop, канцелярит, шаблонные тройки, пустой пафос.

4. Проверка дублей:
   - проверить title/meta/slug/primary keyword/artifacts/content-index.json и durable data/wordstat-published-keywords.json.
   - если similarity > 0.82 — блокировать публикацию и создать новый angle.
   - если 0.65-0.82 — переписать angle и повторить проверку.

5. Медиа fallback chain:
   - сначала пробуй Nano Banana Pro.
   - если Nano Banana Pro недоступен/ошибка/плохой результат — пробуй GPT Image 2.
   - если GPT Image 2 недоступен/ошибка — пробуй Nano Banana 2.
   - если и это не сработало — используй любую другую доступную MCP-модель генерации/редактирования изображений.
   - если нет рабочей обложки 16:9 и баннера 21:9, загруженных в WordPress/media CDN с permanent URL, публикацию БЛОКИРОВАТЬ; ключ оставить pending; записать media-result.json и actionRequired; без обложки и баннера не публиковать.
   - если пользователь дал face reference, identity_lock=true: лицо/идентичность не менять.

6. Публикация:
   - использовать существующий pipeline/MCP/WordPress tools.
   - после получения postId/public URL обязательно выполнить public verification.
   - если URL 404/пустой/не статья: status=verification_failed, keyword НЕ считать обработанным, очередь откатить/оставить pending, создать recovery artifact.
   - если verified OK: только тогда пометить keyword/seed как обработанный и при необходимости обновить durable state (без секретов в коммите).

7. IndexNow:
   - запускать только после verified publication.
   - INDEXNOW_KEY — публичный verification key, не секрет.
   - если key/site host не настроены — не блокировать публикацию, но записать actionRequired.

8. Логирование:
   - вести короткий лог в artifacts/automation-runs/<timestamp>/run.log.
   - не логировать секреты.
   - писать publish-result.json, publish-verification.json, qa-report.json, media-result.json, indexnow-result.json.

9. Telegram-уведомления:
   - при старте: коротко “Автоматизация запущена”.
   - при успехе: URL, postId, статус verified.
   - при поломке, которую удалось починить: кратко что было и что исправлено.
   - если Cursor SDK не смог сам починить: отправить понятный blocker/actionRequired без секретов.
   - не спамить, только важные события.

10. Контент-директор и качество:
    - обязательно выполнить стадии seo-content-writer -> draft -> russian-humanizer -> content-structure-director.
    - финальный HTML: минимум 12000 полезных символов, минимум 8 содержательных H2/H3, оглавление, лид, callouts, таблица exactly like HTML_STRUCTURE_WORDPRAIS.md, FAQ details, полезные ресурсы, что делать дальше.
    - короткая, пустая, слабо структурированная статья блокируется.
    - факты не выдумывать; если фактуры не хватает, вернуть needs_more_research/actionRequired, а не публиковать.
    - qa-report.json должен содержать pass=true только после проверки директора.

11. Экономия токенов:
    - не перечитывай весь репозиторий без необходимости.
    - используй существующие артефакты, если они актуальны.
    - не генерируй статью заново, если можно безопасно продолжить с последнего валидного шага.
    - не открывай внешние источники без необходимости.
    - но качество статьи, проверки дублей и verified publication важнее экономии.

Финальный отчёт каждого запуска:
- опубликовано: да/нет;
- postId и public URL, если есть;
- verified publication: pass/fail;
- какой keyword/seed обработан или оставлен pending;
- какие медиа-модели использовались и какой fallback сработал;
- IndexNow: sent/skipped/actionRequired;
- Telegram-бот: ok/error;
- путь к artifacts;
- если не получилось: конкретный actionRequired.

Если что-то сломалось, не завершай запуск сразу. Сначала диагностируй, исправь, повтори build/typecheck и релевантный smoke-test. Завершай только когда результат проверен или есть внешний blocker.

ВАЖНО: МЕДИА-ПРОМПТЫ ИЗ MAKE BLUEPRINT
Источник: {{BLUEPRINT_PATH_HINT}}. Для изображений НЕ придумывай нейтральные промпты. Используй стиль и логику модулей Make: "Обложка" и "баннер".

USER FACE / IDENTITY REFERENCE:
{{FACE_URL_PRIMARY}}
Это первый и главный image_input для обложки и баннера. identity_lock=true: лицо, очки, узнаваемость, возраст и основные черты не менять. Можно менять одежду, позу, эмоцию и сцену под тему. Запрещено: кепка, капюшон, пластиковая кожа, мультяшность, 3D, латиница/английский текст на изображении.

ОБЛОЖКА 16:9:
Базовый Make-промпт: "Create a HYPER-REALISTIC ACTION SELFIE photo cover for an article. Theme: {{40.content}}. Photorealistic wide-angle selfie shot of the main hero from reference, 24mm wide-angle lens, real candid moment, ultra-sharp face, visible skin texture, realistic eye reflections, stylish glasses, NO cap, NO hood. Background is a vivid dynamic scene relevant to the article theme. Russian Cyrillic headline, shortened title only, beautiful title plaque like the references. 8k/raw photo quality, realistic rich colors, no sepia, subtle ISO grain, sharp face and slightly softer but readable background. Negative: drawing, painting, illustration, 3d render, cartoon, anime, sketch, plastic skin, smooth skin, doll-like, blurry face, bad eyes, distorted hands, watermark, latin letters, english text."

Адаптация под нишу: {{40.content}} = финальный SEO-title статьи для {{TARGET_SITE_URL}}. Сцену подбирай под тему статьи и {{NICHE_HINT}}; если усиливает метафору — можно историческую/эпохальную, иначе кинематографичную сцену вокруг экспертизы сайта. Чужой footer @maya_pro не использовать; если нужен footer — нейтрально: {{SITE_BRAND_FOOTER}}.

БАННЕР 21:9:
Базовый Make-промпт: "Сделать дизайнерский ФОТОРЕАЛИСТИЧНЫЙ баннер. Фон однотонный или аккуратный градиент, придерживаться референса. Главный герой — первое reference image. Меняй одежду, положение и выражение лица под образ. НЕ одевай кепку или капюшон. Герой должен выглядеть стильно и в очках. Делай смешным/прикольным, используй красивые русские шрифты."

Адаптация под нишу: баннер поддерживает экспертизу и тему статьи для {{TARGET_SITE_URL}} / {{NICHE_HINT}}. Не писать чужие бренды, если статья не про них. Текст на баннере только русский, короткий, крупный.

MEDIA FALLBACK CHAIN:
1) nano_banana_pro с image_input=[USER FACE REFERENCE] и этими Make-промптами.
2) Если ошибка/таймаут/плохой результат — gpt_image_2 с тем же смыслом и тем же reference, если image-to-image доступен.
3) Если не сработало — nano_banana_2.
4) Если всё недоступно — любая доступная MCP image model.
5) Если ни одна модель не сработала — публикацию блокировать: keyword/задачу оставить pending, ничего не удалять из очереди, записать media-result.json с warning и Telegram/actionRequired.

Дополнительные face-consistency refs (все как image_input, первый URL — главный якорь идентичности):
1) {{FACE_URL_PRIMARY}}
2) {{FACE_URL_EXTRA_1}}
3) {{FACE_URL_EXTRA_2}}

durable wordstat state after verified publication or duplicate pass: commit and push safe state files only (например data/wordstat-published-keywords.json и правки content-index), никогда не коммитить env, токены, endpoints, chat ids, логи или приватные файлы; если push запрещён — actionRequired, иначе очередь повторит ключ.

NO DUPES KEYWORD RULE: один нормализованный ключ и один канонический интент = одна статья; каждый запуск — npm run wp:queue-audit; пропускать exact duplicates, canonical duplicates, durable published keywords; duplicate не публиковать.
```

---

## 5. Быстрая инструкция агенту «распакуй в новую нишу»

1. Прочитать этот файл и `wordpress-articles-wordstat-3h-automation.reference.example.json`.
2. Заполнить глоссарий §2 и заменить плейсхолдеры в §4.
3. В UI Cursor создать/обновить automation: вставить промпт, cron, repo, branch, MCP (**свой** server id).
4. В репозитории: скорректировать `{{WORDSTAT_AUTOMATION_JSON}}`, при необходимости `config/wordpress-articles.json`, пути в README.
5. Прогнать `npm run build`, `npm run typecheck`, `npm run bot:sanity`, `npm run wp:queue-audit`.

После merge основной ветки не забудьте переключить **`gitConfig.branch`** в UI на `main` (или актуальную production-ветку).

---

## 6. Где хранить «как в проде» экспорт из Cursor UI

Экспорт JSON целиком из настроек автоматизации удобно держать **локально** или во внутреннем wiki (он может содержать **id MCP-сервера** из вашего аккаунта — не обязательно публиковать в открытом репо).

В git мы держим **UNPACK + template.json**: это канонический способ не потерять ни медиа-цепочку Make/Nano, ни verified publication, ни антидубль Wordstat. При переносе ниши агент подставляет переменные §2 и проверяет чеклист §3.

Пример лицевых референсов с отдельного сайта (например хостинг изображений для `identity_lock`) подставляются в `{{FACE_URL_PRIMARY}}` / `{{FACE_URL_EXTRA_*}}` — не привязывайте шаблон к одному домену в коде репозитория.
