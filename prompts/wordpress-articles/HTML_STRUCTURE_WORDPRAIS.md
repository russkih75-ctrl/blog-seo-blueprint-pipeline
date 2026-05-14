# HTML-структура статей под wordprais.ru (каркас как в blueprint / эталон раскладки)

Цель: визуально и семантически близкий к материалам вида **mayai.ru** слой блоков, но **контент, факты и ссылки** — только свои (Research + **wordprais.ru**).

## Обязательные правила разметки

- Вывод **без** `<html>`, `<body>`, **без** `<h1>` (заголовок записи задаётся в WordPress).
- Иерархия: после лида — только **`##`** по смыслу через `<h2>`, подразделы `<h3>`.
- Списки: допускай `<ul><li>` там, где перечисления улучшают GEO (как в эталоне со списками в середине статьи).
- Таблица: минимум **одна** — не «голый» `<table>` без оформления (на сайте выглядит как текст без рамок). Нужен **вид как полноценная таблица в записи**: обёртка **`article-table-scroll`** + **`figure.wp-block-table`**, у **`table`** — **`border-collapse`**, общая **`border`**, у каждого **`th`/`td`** — **`border`** и **`padding`**, у шапки фон; чередование фона строк в **`tbody`** по желанию; **`caption`** сверху, выравнивание смысловое; у заголовков колонок **`scope="col"`**. Полный образец:

```html
<div class="article-table-scroll" style="overflow-x:auto;margin:1.75rem 0;-webkit-overflow-scrolling:touch">
<figure class="wp-block-table" style="margin:0">
<table style="width:100%;min-width:520px;border-collapse:collapse;border:1px solid #d0d0d0;font-size:0.95rem;line-height:1.45;background:#fff;box-sizing:border-box">
<caption style="caption-side:top;text-align:left;font-weight:600;padding:0 4px 12px 4px;color:#1a1a1a">Подпись к таблице</caption>
<thead>
<tr style="background:#f0f4f8">
<th scope="col" style="border:1px solid #d0d0d0;padding:11px 14px;text-align:left;font-weight:600">Колонка A</th>
<th scope="col" style="border:1px solid #d0d0d0;padding:11px 14px;text-align:left;font-weight:600">Колонка B</th>
</tr>
</thead>
<tbody>
<tr>
<td style="border:1px solid #d0d0d0;padding:11px 14px;vertical-align:top">…</td>
<td style="border:1px solid #d0d0d0;padding:11px 14px;vertical-align:top">…</td>
</tr>
<tr style="background:#fafbfc">
<td style="border:1px solid #d0d0d0;padding:11px 14px;vertical-align:top">…</td>
<td style="border:1px solid #d0d0d0;padding:11px 14px;vertical-align:top">…</td>
</tr>
</tbody>
</table>
</figure>
</div>
```

- Иллюстрация в теле: один блок **до или после первого крупного раздела** (как «горизонтальный баннер» blueprint):

```html
<figure class="article-banner" style="margin:2rem 0">
  <img src="BANNER_WP_MEDIA_URL" alt="Краткий нейтральный alt по теме статьи" width="1200" height="514" loading="lazy" decoding="async" />
  <figcaption class="article-banner-caption" style="font-size:0.9em;margin-top:0.5rem">Краткая подпись к иллюстрации (1 строка).</figcaption>
</figure>
```

`BANNER_WP_MEDIA_URL` подставляется **после** загрузки в медиатеку (не оставлять только временный домен генератора).

## Опциональные «врезки» (имитация боковых подсказок эталона)

Используй 0–4 блока по смыслу, не подряд подряд:

```html
<div class="article-callout article-callout--tip" role="note">
  <strong>SEO</strong>
  <p>Короткий практический совет без воды.</p>
</div>
```

Варианты `article-callout--tip | article-callout--warn | article-callout--step | article-callout--insight` — на усмотрение редактора.

## Лид и основная часть

1. **Прямой ответ** в первом `<p>` (до ~50 слов) — формула из GEO-регламента.
2. **Hook**: 1–2 абзаца контекста.
3. **Основная часть**: 5–8 логических секций `<h2>`; внутри при необходимости `<h3>`.
4. Вставь минимум один абзац вида **«Рекомендация:»** или **«На практике лучше…»** (`<p><strong>Рекомендация:</strong> …</p>`).

## FAQ

### Блок 1 — основной  

`<h2>Частые вопросы</h2>` затем **5–7** пар:

```html
<details>
  <summary><strong>Вопрос в формулировке пользователя?</strong></summary>
  <p>Ответ 2–5 предложений, конкретика.</p>
</details>
```

### Блок 2 — расширенный (если уместно по объёму ключей)

`<h2>Часто задаваемые вопросы по теме</h2>` + ещё **3–5** `<details>` с другими формулировками (без дословного дубля блока 1).

## Завершение

1. `<h2>Полезные ресурсы</h2>` — только ссылки из **`config/wordpress-articles.json` → targetSite.publicProfileUrls** (можно не все сразу, но только этот пул + текущая статья при внутренней перелинковке).
2. `<h2>Что делать дальше</h2>` — три и менее пути, каждый: один абзац + одна ссылка на wordprais.ru (раздел блога, услуги WordPress, Яндекс/Google по теме материала).

## Антидубль и стабильность

- Не повторять длинными цепочками один и тот же абзац в FAQ и основном тексте.
- Не вставлять сырой markdown — только HTML.
- Не использовать эмодзи в теле статьи.
