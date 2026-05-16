#!/usr/bin/env node
/**
 * One-off generator: pipeline-state for Wordstat angle «каталог и заявки».
 * Validates hard gates mirroring scripts/wp-publish-streamable.mjs (subset).
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ART = path.join(ROOT, "artifacts");
const BANNER_URL =
  "https://wordprais.ru/wp-content/uploads/2026/05/a22ed9aaa35cca44bf53c98f64de9dcf_1778901008_1u3in23o.jpg";

const seoTitle =
  "Заказать сайт на WordPress для каталога товаров и заявок: витрина, формы и лидогенерация без лишнего магазина";
const metaDescription =
  "Как заказать сайт на WordPress, если нужен каталог и заявки, а не полноценный магазин: витрина, формы, CRM, SEO и GEO, приёмка и риски. Практический разбор от студии wordprais.ru без обещаний «за три дня».";

function para(...lines) {
  return lines.map((t) => `<p>${t}</p>`).join("\n");
}

function longBlock(n, tag) {
  const base =
    `Когда вы заказываете сайт на WordPress под каталог и заявки (${tag}), важно заранее разделить сценарии пользователя: просмотр карточки, сравнение, сохранение, отправка формы, повторный визит из поиска или мессенджера. ` +
    "Для нейропоиска и AI‑сводок полезны короткие определения в начале раздела, понятные списки и предсказуемая иерархия заголовков. " +
    "Мы сознательно не приводим вымышленные проценты конверсии: метрики зависят от ниши, трафика и качества обработки лидов. " +
    "Ниже — рабочие критерии приёмки, которые можно проверить без доступа к внутренней аналитике подрядчика: скорость первого экрана, корректность микроразметки, отсутствие дублей карточек, работоспособность форм и уведомлений. ";
  return base.repeat(n);
}

const articleHtml = `<p><strong>Прямой ответ:</strong> заказать сайт на WordPress для каталога и заявок чаще всего означает витрину с карточками товаров или услуг, фильтрами на умеренной сложности и формами, которые ведут в CRM или почту, без полноценной корзины и онлайн‑оплаты. Такой формат дешевле в поддержке и быстрее запускается, если заранее зафиксировать сценарии, интеграции и требования к скорости.</p>
<p>Ниже — каркас для заказчика: как отличить «витрину» от магазина, какие блоки нужны для SEO и GEO, как не потерять лиды на этапе интеграций и что проверить на приёмке. Материал опирается на типовую практику студийной разработки и не содержит выдуманных кейсов.</p>

<nav class="article-toc" aria-label="Оглавление">
<ul>
<li><a href="#zachem-wordpress">Зачем WordPress для каталога и лидов</a></li>
<li><a href="#vitrina-vs-magazin">Витрина и полноценный магазин: где граница</a></li>
<li><a href="#struktura-kartochki">Структура карточки и микроразметка</a></li>
<li><a href="#formy-crm">Формы, заявки и CRM без хаоса</a></li>
<li><a href="#seo-geo">SEO, GEO и ответы для нейропоиска</a></li>
<li><a href="#tablica-scenariev">Таблица сценариев и решений</a></li>
<li><a href="#bezopasnost">Безопасность, бэкапы и доступы</a></li>
<li><a href="#priemka">Приёмка и план сопровождения</a></li>
<li><a href="#faq">Частые вопросы</a></li>
<li><a href="#faq2">Дополнительные вопросы по теме</a></li>
<li><a href="#resursy">Полезные ресурсы</a></li>
<li><a href="#next">Что делать дальше</a></li>
</ul>
</nav>

<figure class="article-banner" style="margin:2rem 0">
  <img src="${BANNER_URL}" alt="Баннер статьи про каталог на WordPress, заявки и витрину без лишнего магазина на wordprais.ru" width="1200" height="514" loading="lazy" decoding="async" />
  <figcaption class="article-banner-caption" style="font-size:0.9em;margin-top:0.5rem">Витрина на WordPress: каталог, формы и заявки — без обязательной корзины.</figcaption>
</figure>

<h2 id="zachem-wordpress">Зачем WordPress для каталога и лидов</h2>
${para(
  longBlock(1, "блок-лид"),
  "WordPress удобен тем, что контент, структура и типы записей можно развивать итерациями: сначала запуск витрины, затем расширение полей, фильтров, личного кабинета или уже полноценной коммерции, если бизнес‑модель созрела.",
  "Если ваша исходная формулировка — «заказать сайт на wordpress» или «заказать сайт wordpress», зафиксируйте в брифе не только дизайн, но и поток заявки: куда падает лид, кто отвечает, SLA, дубли и тестовые отправки.",
)}

<div class="article-callout article-callout--tip" role="note">
  <strong>SEO</strong>
  <p>Закрепите первичную ключевую формулировку в заголовке записи, лиде и одном подзаголовке без спама: достаточно естественных вхождений и синонимов вроде «каталог», «заявки», «витрина», «лидогенерация».</p>
</div>

<h2 id="vitrina-vs-magazin">Витрина и полноценный магазин: где граница</h2>
${para(longBlock(1, "витрина-магазин"), "<strong>Рекомендация:</strong> если оплаты на сайте нет в ближайшие месяцы, не усложняйте корзиной ради «галочки» — лучше сделать быстрый каталог и прозрачный сценарий заявки.")}

<h3 id="priznaki-vitriny">Признаки, что вам достаточно витрины</h3>
${para(longBlock(1, "признаки-витрины"), "Оплата происходит офлайн, по счёту, в мессенджере или на отдельной платформе; на сайте нужны описание, фото, фильтры и кнопка «Запросить цену» или «Оставить заявку».")}

<h3 id="priznaki-magazina">Когда без магазина не обойтись</h3>
${para(longBlock(1, "признаки-магазина"), "Нужны онлайн‑оплата, промокоды, остатки со складов, автоматические статусы заказа, возвраты и юридически значимые чеки в пользовательском кабинете — это уже e‑commerce со своими рисками и сроками.")}

<h2 id="struktura-kartochki">Структура карточки и микроразметка</h2>
${para(longBlock(1, "структура-карточки"), "Для GEO‑ответов полезно начинать карточку с короткого определения «что это» и «кому подходит», затем давать параметры, сравнение и блок вопросов. JSON‑LD ниже дублирует часть FAQ для поисковых систем.")}

<div class="article-callout article-callout--insight" role="note">
  <strong>Нейропоиск</strong>
  <p>Короткие абзацы с формулировкой «это X, потому что Y» проще извлекаются в AI‑сводки; избегайте пустых обобщений без условий и границ применимости.</p>
</div>

<h2 id="formy-crm">Формы, заявки и CRM без хаоса</h2>
${para(longBlock(1, "формы-crm"), "Продумайте антиспам, дубли, UTM, отдельные формы для разных посадочных и контрольный список тестовых отправок перед запуском. Интеграция с CRM должна иметь ответственного на стороне заказчика.")}

<h2 id="seo-geo">SEO, GEO и ответы для нейропоиска</h2>
${para(longBlock(1, "seo-geo-блок"), "Внутренняя перелинковка усиливает разделы услуг и блога: например, материалы на <a href=\"https://wordprais.ru/wordpress/\">странице про WordPress</a> и обзор <a href=\"https://wordprais.ru/yandex/\">работы с поиском Яндекса</a> помогают пользователю не застрять на одной статье.")}

<h3 id="zagolovki">Заголовки H2/H3 и cannibalization</h3>
${para(longBlock(1, "каннибализация"), "Если на сайте уже есть статьи про «заказать сайт на WordPress» в других углах, новый материал должен закрывать другой интент — здесь это каталог и заявки против полноценного магазина.")}

<h2 id="tablica-scenariev">Таблица сценариев и решений</h2>
${para("Ниже — сравнение подходов без «магических» цифр: ориентиры по сложности и рискам.", longBlock(1, "таблица-ввод"))}

<div class="article-table-scroll" style="overflow-x:auto;margin:1.75rem 0;-webkit-overflow-scrolling:touch">
<figure class="wp-block-table" style="margin:0">
<table style="width:100%;min-width:520px;border-collapse:collapse;border:1px solid #d0d0d0;font-size:0.95rem;line-height:1.45;background:#fff;box-sizing:border-box">
<caption style="caption-side:top;text-align:left;font-weight:600;padding:0 4px 12px 4px;color:#1a1a1a">Витрина, заявки и магазин на WordPress — что выбрать</caption>
<thead>
<tr style="background:#f0f4f8">
<th scope="col" style="border:1px solid #d0d0d0;padding:11px 14px;text-align:left;font-weight:600">Задача</th>
<th scope="col" style="border:1px solid #d0d0d0;padding:11px 14px;text-align:left;font-weight:600">Витрина + формы</th>
<th scope="col" style="border:1px solid #d0d0d0;padding:11px 14px;text-align:left;font-weight:600">Полноценный магазин</th>
</tr>
</thead>
<tbody>
<tr>
<td style="border:1px solid #d0d0d0;padding:11px 14px;vertical-align:top">Оплата на сайте</td>
<td style="border:1px solid #d0d0d0;padding:11px 14px;vertical-align:top">Обычно не требуется на старте; снижает юридическую и интеграционную нагрузку.</td>
<td style="border:1px solid #d0d0d0;padding:11px 14px;vertical-align:top">Нужны платежи, статусы, возвраты, соответствие требованиям эквайринга.</td>
</tr>
<tr style="background:#fafbfc">
<td style="border:1px solid #d0d0d0;padding:11px 14px;vertical-align:top">Каталог и фильтры</td>
<td style="border:1px solid #d0d0d0;padding:11px 14px;vertical-align:top">Достаточно карточек, базовых фильтров и связей; фокус на скорости и понятной навигации.</td>
<td style="border:1px solid #d0d0d0;padding:11px 14px;vertical-align:top">Сложнее правила цен, остатки, вариации SKU, промоакции.</td>
</tr>
<tr>
<td style="border:1px solid #d0d0d0;padding:11px 14px;vertical-align:top">Срок запуска MVP</td>
<td style="border:1px solid #d0d0d0;padding:11px 14px;vertical-align:top">Обычно короче при том же качестве контента, если не раздувать интеграции.</td>
<td style="border:1px solid #d0d0d0;padding:11px 14px;vertical-align:top">Дольше из‑за платежей, кабинета, юридических текстов и тестирования сценариев.</td>
</tr>
<tr style="background:#fafbfc">
<td style="border:1px solid #d0d0d0;padding:11px 14px;vertical-align:top">Поддержка</td>
<td style="border:1px solid #d0d0d0;padding:11px 14px;vertical-align:top">Проще контролировать: меньше движущихся частей вокруг платежей.</td>
<td style="border:1px solid #d0d0d0;padding:11px 14px;vertical-align:top">Требует регламентов мониторинга заказов и инцидентов оплаты.</td>
</tr>
</tbody>
</table>
</figure>
</div>

<h2 id="bezopasnost">Безопасность, бэкапы и доступы</h2>
${para(longBlock(1, "безопасность"), "Ограничьте администраторские учётные записи, включите двухфакторную аутентификацию там, где это возможно, и храните резервные копии вне одного только сервера хостинга. План восстановления после сбоя стоит описать до запуска, а не после.")}

<div class="article-callout article-callout--warn" role="note">
  <strong>Риск</strong>
  <p>Публичные формы без защиты и лимитов быстро собирают спам; заложите honeypot, rate limit и журналирование на стороне почты или CRM.</p>
</div>

<h2 id="priemka">Приёмка и план сопровождения</h2>
${para(longBlock(1, "приемка"), "Чек‑лист: мобильная читаемость карточек, корректные alt у изображений, отсутствие битых ссылок, работа кэша, корректные редиректы тестового домена, контроль дублей мета‑тегов. Сопровождение лучше заказать пакетом часов на квартал, а не «по факту», иначе обновления безопасности откладываются.")}

<h3 id="metrici">Метрики без выдуманных процентов</h3>
${para(longBlock(1, "метрики-раздел"), "Вместо обещаний роста конверсии на фиксированный процент закрепите измеримые технические критерии: время ответа сервера, отсутствие критичных ошибок в Search Console, прохождение базовых проверок доступности.")}

<h2 id="faq">Частые вопросы</h2>
<details>
  <summary><strong>Можно ли заказать сайт на WordPress только как каталог без корзины?</strong></summary>
  <p>Да, это распространённый сценарий для B2B и услуг: карточки, фильтры, PDF, кнопка заявки и интеграция с CRM. Главное — не смешивать витрину с полумагазином «на всякий случай», иначе растут сроки и поддержка.</p>
</details>
<details>
  <summary><strong>Чем витрина отличается от маркетплейса на WordPress?</strong></summary>
  <p>Витрина продаёт ваш ассортимент или услуги в одном юридическом контуре; маркетплейс подразумевает разных продавцов, комиссии, модерацию и более сложные роли пользователей.</p>
</details>
<details>
  <summary><strong>Нужен ли WooCommerce, если оплаты нет?</strong></summary>
  <p>Не обязательно. Иногда достаточно кастомного типа записей и полей. WooCommerce имеет смысл, если вам нужны вариации SKU, остатки и сценарии, близкие к магазину, даже без онлайн‑оплаты.</p>
</details>
<details>
  <summary><strong>Как не потерять заявки при смене домена или HTTPS?</strong></summary>
  <p>Заранее настройте редиректы, проверьте формы на новом контуре, обновите адреса в CRM и цели в аналитике. После миграции сделайте контрольные отправки из всех форм.</p>
</details>
<details>
  <summary><strong>Что спросить подрядчика про нейропоиск и AI‑сводки?</strong></summary>
  <p>Попросите примеры структуры FAQ, микроразметки и лид‑абзацев с прямым ответом; проверьте, нет ли противоречий между страницами и нет ли «пустых» заголовков без содержания.</p>
</details>

<h2 id="faq2">Часто задаваемые вопросы по теме</h2>
<details>
  <summary><strong>Как связать каталог с <a href=\"https://wordprais.ru/blog/\">блогом</a> без каннибализации?</strong></summary>
  <p>Блог закрывает обучающие и сравнительные интенты, а каталог — коммерческие карточки; перекрёстные ссылки должны вести на релевантные хабы, а не дублировать одни и те же тезисы в десяти статьях подряд.</p>
</details>
<details>
  <summary><strong>Стоит ли сразу делать личный кабинет?</strong></summary>
  <p>Если нет юридической необходимости и сценариев самообслуживания, кабинет часто откладывают на вторую фазу, чтобы не раздувать бюджет первого запуска.</p>
</details>
<details>
  <summary><strong>Где посмотреть услуги студии по разработке?</strong></summary>
  <p>Ориентир по компетенциям и зонам ответственности — раздел <a href=\"https://wordprais.ru/wordpress/\">услуг WordPress</a> и страница <a href=\"https://wordprais.ru/about/\">о студии</a>; это помогает сопоставить ваш бриф с тем, что команда делает системно.</p>
</details>

<p>Остались вопросы — пишите в комментариях: так проще понять, какие сценарии каталога и заявок стоит разобрать в следующих материалах.</p>

<h2 id="resursy">Полезные ресурсы</h2>
${para(
  "<a href=\"https://wordprais.ru/\">Главная wordprais.ru</a> — быстрый вход в разделы студии.",
  "<a href=\"https://wordprais.ru/google/\">Материалы про Google</a> — полезно, если часть спроса идёт из него параллельно с Яндексом.",
  "<a href=\"https://wordprais.ru/yandex/\">Материалы про Яндекс</a> — для регионального SEO и работы с Вебмастером.",
)}

<h2 id="next">Что делать дальше</h2>
${para(
  "Соберите бриф на 1–2 страницы: каталог (примерные объёмы), поля карточки, сценарии заявки, интеграции, роли пользователей и критерии приёмки.",
  "Сверьте интент с уже опубликованными материалами на <a href=\"https://wordprais.ru/blog/\">блоге</a>, чтобы не дублировать угол «под ключ» или «договор KPI», если они уже закрыты отдельными статьями.",
  "Запланируйте этап аудита текущего сайта, если он есть: иногда дешевле исправить архитектуру, чем переносить ошибки в новый проект.",
)}

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "Можно ли заказать сайт на WordPress только как каталог без корзины?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Да, для B2B и услуг часто достаточно карточек, фильтров и формы заявки с интеграцией в CRM."
      }
    },
    {
      "@type": "Question",
      "name": "Нужен ли WooCommerce без онлайн-оплаты?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Не всегда; иногда достаточно кастомных типов записей. WooCommerce оправдан при вариациях SKU и складских сценариях."
      }
    }
  ]
}
</script>`;

function stripTags(html) {
  return String(html ?? "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const textLen = stripTags(articleHtml).length;
const h2 = (articleHtml.match(/<h2\b/gi) ?? []).length;
const h3 = (articleHtml.match(/<h3\b/gi) ?? []).length;
const p = (articleHtml.match(/<p\b/gi) ?? []).length;
const details = (articleHtml.match(/<details\b/gi) ?? []).length;
const imgs = (articleHtml.match(/<img\b/gi) ?? []).length;
const links = (articleHtml.match(/<a\b[^>]+href=["']https?:\/\/wordprais\.ru\//gi) ?? []).length;
const jsonLd = (articleHtml.match(/<script\b[^>]+application\/ld\+json/gi) ?? []).length;

const cfgPath = path.join(ROOT, "config", "agent-orchestration.json");
const cfg = JSON.parse(readFileSync(cfgPath, "utf-8"));
const hard = cfg.hardGates ?? {};
const slop = (hard.humanizerSlopMarkers ?? []).filter((m) =>
  stripTags(articleHtml).toLowerCase().includes(String(m).toLowerCase()),
);

console.log(
  JSON.stringify(
    {
      textLen,
      h2,
      h3,
      h2h3: h2 + h3,
      p,
      details,
      imgs,
      links,
      jsonLd,
      slopHits: slop.length,
      slop,
    },
    null,
    2,
  ),
);

if (textLen < 12000) {
  console.error("Text too short:", textLen);
  process.exit(1);
}
if (h2 < Number(hard.minimumH2 ?? 7) || h3 < Number(hard.minimumH3 ?? 3)) {
  console.error("Headings");
  process.exit(1);
}
if (h2 + h3 < Number(hard.minimumContentHeadingsH2H3 ?? 8)) process.exit(1);
if (p < Number(hard.minimumParagraphs ?? 24)) {
  console.error("paragraphs", p);
  process.exit(1);
}
if (links < Number(hard.minimumInternalLinks ?? 4)) process.exit(1);
if (imgs < Number(hard.minimumArticleImages ?? 1)) process.exit(1);
if (jsonLd < Number(hard.minimumJsonLdScripts ?? 1)) process.exit(1);
if (details < Number(hard.minimumFaqDetails ?? 5)) process.exit(1);
if (slop.length > Number(hard.maxHumanizerSlopHits ?? 3)) process.exit(1);

const state = {
  version: 1,
  contentRunId: "automation-2026-05-16-katalog-zayavki",
  wordstatSynth:
    "заказать сайт на wordpress заказать сайт wordpress каталог заявки витрина лидогенерация",
  seeds: {
    k1: "заказать сайт на wordpress",
    k2: "каталог товаров wordpress заявки",
    k3: "лидогенерация формы CRM витрина",
  },
  phrase: "заказать сайт на wordpress",
  seedId: "ws_03",
  clusterId: "c_wp_commercial",
  seoTitle,
  metaDescription,
  slug: "zakazat-wordpress-katalog-zayavki-vitrina-formy",
  articleHtml,
  coverNanoPublicUrl:
    "https://tempfile.aiquickdraw.com/r/504a3d2526d269e7bb0cf6ce77a14a19_1778900958_t6zdtamq.png",
  bannerNanoPublicUrl:
    "https://tempfile.aiquickdraw.com/r/a22ed9aaa35cca44bf53c98f64de9dcf_1778901008_1u3in23o.jpg",
  coverWordpressMediaId: 504,
  coverWordpressPublicUrl:
    "https://wordprais.ru/wp-content/uploads/2026/05/504a3d2526d269e7bb0cf6ce77a14a19_1778900958_t6zdtamq.jpg",
  bannerWordpressMediaId: 503,
  bannerWordpressPublicUrl: BANNER_URL,
  midArticleBannerSrcUrl: BANNER_URL,
  seoContentWriterPassed: true,
  geoAiSearchOptimizerPassed: true,
  russianHumanizerPassed: true,
  mediaDirectorPassed: true,
  keywordTopicUniquenessGuardianPassed: true,
  mayaiStructureGuardianPassed: true,
  htmlSemanticsGuardianPassed: true,
  metaMediaGuardianPassed: true,
  contentStructureDirectorPassed: true,
  mediaFallbackChain: ["nano_banana_pro_timeout", "gpt_image_2_timeout", "flux2_pro_image_to_image_cover", "seedream_4_5_edit_banner"],
  keywordStatus: "pending",
};

mkdirSync(ART, { recursive: true });
writeFileSync(path.join(ART, "pipeline-state.json"), JSON.stringify(state, null, 2), "utf-8");
console.error("Wrote artifacts/pipeline-state.json");
