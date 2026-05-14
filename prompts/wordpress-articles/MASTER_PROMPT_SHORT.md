# MASTER PROMPT — краткая шпаргалка (меньше токенов)

Полная версия: **`MASTER_PROMPT.md`**. Цель: **wordprais.ru**, структура как blueprint / mayai-каркас — **без** копирования чужих текстов и промо.

**A** Intake → тема, ключи, референс статьи (*structure-only*), при необходимости лицо (*identity_lock*).  
**B** Ключи `k1,k2,k3` → `keywords.json`.  
**C** Research → факты с источниками; сверка терминов с URL из `config/wordpress-articles.json`; антидубль / при необходимости MCP `wordpress_search_posts`.  
**D** `seo.json` — title, meta, slug, место под баннер **21:9**.  
**E** MCP: `nano_banana_*` обложка **16:9**, баннер **21:9** → **`wordpress_upload_media`** → постоянные URL на домене → `featured_media`. Скрипт: `npm run wp:nano-images-republish`.  
**F** Текст по **`HTML_STRUCTURE_WORDPRAIS.md`** + humanizer + запреты из промпта **012**.  
**G** Чеклист HTML (нет `<h1>`, таблица с **видимыми границами** по шаблону в `HTML_STRUCTURE_WORDPRAIS.md`, figure-баннер, FAQ, ресурсы только с allowlist).  
**H** duplicate-guardian; опционально Метла.  
**I** `wordpress_create_post` / `update`; state в `artifacts/pipeline-state.json`; задайте **`CONTENT_RUN_ID`** или **`contentRunId`** в state для финализации.  
**J** `npm run content:finalize-publish` (+ IndexNow при ключе).

Быстрые npm: **`scenario:wordpress-articles`**, **`scenario:wordpress-articles-with-nano`**. Таймауты MCP: **`MCP_REQUEST_TIMEOUT_MS`**.
