#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUN_DATE = "2026-05-16";
const RUN_DIR = path.join(ROOT, "research", "semantic-core-runs", `wordprais-${RUN_DATE}`);
const CONFIG_PATH = path.join(ROOT, "config", "wordprais-wordstat-automation.json");

const meta = {
  regionCode: 225,
  regionLabel: "Россия",
  snapshotDate: RUN_DATE,
  source: "wordstat_mcp_kv",
  device: "all",
  notes:
    "Семантическое ядро собрано через YADryshko workflow и MCP-KV Wordstat. Брендовые/мусорные запросы исключены из публикационной очереди.",
};

const excludedBrandedQueries = [
  "seo продвижение сайтов seo fortuna",
  "seo продвижение сайтов novelit",
  "seo продвижение сайта seotica",
  "продвижение сайта в яндексе seojazz",
  "продвижение сайта в яндексе novelit",
  "результат seo аудита сайта evenbox",
  "результат seo аудита сайта evenbox ru",
  "сайт инфоурок для воспитателей заказать статью",
  "налоговый калькулятор на сайте фнс для ип",
  "dora ai нейросеть для создания сайтов",
];

const clusters = [
  {
    id: "c_wp_commercial",
    titleRu: "WordPress: разработка и заказ сайта",
    priority: 0,
    draftLandingUrl: "/uslugi/wordpress-razrabotka/",
    pageType: "service",
    businessValue: "high",
  },
  {
    id: "c_wp_setup",
    titleRu: "WordPress: установка, настройка и админка",
    priority: 1,
    draftLandingUrl: "/uslugi/nastrojka-wordpress/",
    pageType: "guide",
    businessValue: "medium",
  },
  {
    id: "c_wp_performance",
    titleRu: "WordPress: скорость, кэш и Core Web Vitals",
    priority: 1,
    draftLandingUrl: "/uslugi/uskorenie-wordpress/",
    pageType: "guide",
    businessValue: "medium",
  },
  {
    id: "c_wp_migration",
    titleRu: "WordPress: перенос, домен и хостинг",
    priority: 1,
    draftLandingUrl: "/uslugi/perenos-wordpress/",
    pageType: "guide",
    businessValue: "medium",
  },
  {
    id: "c_wp_security",
    titleRu: "WordPress: безопасность, вирусы и восстановление",
    priority: 0,
    draftLandingUrl: "/uslugi/wordpress-bezopasnost-vosstanovlenie/",
    pageType: "service",
    businessValue: "high",
  },
  {
    id: "c_wp_support",
    titleRu: "WordPress: поддержка и доработки",
    priority: 1,
    draftLandingUrl: "/uslugi/teh-podderzhka-wordpress/",
    pageType: "service",
    businessValue: "medium",
  },
  {
    id: "c_plugins_themes",
    titleRu: "WordPress: плагины, темы, Elementor",
    priority: 1,
    draftLandingUrl: "/uslugi/wordpress-plaginy-temy/",
    pageType: "guide",
    businessValue: "medium",
  },
  {
    id: "c_calculators",
    titleRu: "Калькуляторы и формы для сайта",
    priority: 0,
    draftLandingUrl: "/uslugi/kalkulyatory-dlya-sajta/",
    pageType: "service",
    businessValue: "high",
  },
  {
    id: "c_seo_wp",
    titleRu: "SEO-продвижение сайта",
    priority: 0,
    draftLandingUrl: "/prodvizhenie/seo/",
    pageType: "service",
    businessValue: "high",
  },
  {
    id: "c_yandex_seo",
    titleRu: "Продвижение в Яндексе",
    priority: 0,
    draftLandingUrl: "/prodvizhenie/yandex/",
    pageType: "service",
    businessValue: "high",
  },
  {
    id: "c_seo_audit",
    titleRu: "SEO-аудит и технический аудит сайта",
    priority: 0,
    draftLandingUrl: "/prodvizhenie/seo-audit/",
    pageType: "service",
    businessValue: "high",
  },
  {
    id: "c_geo_ai",
    titleRu: "GEO, AI-search и нейропоиск",
    priority: 1,
    draftLandingUrl: "/yandex/nejropoisk-geo/",
    pageType: "guide",
    businessValue: "medium",
  },
  {
    id: "c_content",
    titleRu: "Контент, статьи и наполнение сайта",
    priority: 1,
    draftLandingUrl: "/uslugi/kontent-dlya-sajta/",
    pageType: "service",
    businessValue: "medium",
  },
];

const seeds = [
  seed("ws_001", "разработка сайта на wordpress", "c_wp_commercial", [
    q("разработка сайта на wordpress", 137),
  ]),
  seed("ws_002", "создание сайта на wordpress", "c_wp_commercial", [
    q("создание сайта на wordpress", 470),
    q("создание сайта на wordpress elementor", 75),
    q("создания сайта на wordpress с нуля", 73),
    q("создание сайтов на основе wordpress", 41),
    q("создание сайта на теме wordpress", 13),
    q("нейросеть для создания сайта на wordpress", 12),
    q("инструкция создания сайта на wordpress", 12),
    q("создание сайта на wordpress пошаговая", 10),
    q("создание сайта на wordpress пошаговая инструкция", 10),
    q("создание сайтов на wordpress цена", 7),
    q("создание и продвижение сайтов на wordpress", 5),
  ]),
  seed("ws_003", "заказать сайт на wordpress", "c_wp_commercial", [
    q("заказать сайт на wordpress", 54),
    q("сайт под ключ", 5192, "similar"),
    q("сколько стоит сделать сайт", 1373, "similar"),
    q("сколько стоит создать сайт", 941, "similar"),
    q("вордпресс создание сайта", 468, "similar"),
  ]),
  seed("ws_004", "seo продвижение сайта", "c_seo_wp", [
    q("seo продвижение сайта", 8513),
    q("seo продвижение сайта москва", 874),
    q("seo продвижение сайта заказать", 667),
    q("seo оптимизация продвижение сайтов", 636),
    q("поисковое продвижение сайта seo", 616),
    q("seo продвижение сайтов цена", 487),
    q("сео продвижение сайтов seo", 287),
    q("seo система продвижение сайтов", 284),
    q("seo продвижение раскрутка сайта", 279),
    q("seo ru продвижение сайтов", 238),
    q("seo продвижение сайта россия", 234),
    q("seo продвижение сайта услуги", 229),
    q("seo продвижение сайта в яндекс", 220),
  ]),
  seed("ws_005", "продвижение сайта в яндексе", "c_yandex_seo", [
    q("продвижение сайта в яндексе", 1950),
    q("продвижение сайта в топ яндекса", 423),
    q("продвижение сайтов в яндексе москва", 300),
    q("seo продвижение сайта в яндекс", 220),
    q("продвижение сайтов в 10 яндекс", 191),
    q("продвижение сайта в яндекс директ", 189),
    q("продвижение сайта в яндексе цена", 166),
    q("продвижение сайта в топ 10 яндекса", 150),
    q("поисковое продвижение сайта в яндекс", 91),
    q("продвижение сайта в системе яндекс", 55),
    q("продвижение сайта в поисковой системе яндекс", 54),
    q("заказать продвижение сайта в яндекс", 53),
    q("сео продвижение сайта в яндекс", 50),
  ]),
  seed("ws_006", "seo аудит сайта", "c_seo_audit", [
    q("seo аудит сайта", 506),
    q("бесплатный seo аудит сайта", 262),
    q("seo анализ сайта аудит", 252),
    q("seo аудит сайта технического seo аудита", 54),
    q("seo аудит сайта онлайн", 33),
    q("провести seo аудит сайта", 19),
    q("seo аудит сайта онлайн бесплатно", 11),
    q("аудит seo продвижение сайта", 8),
    q("технический аудит сайта на своем сервере seo", 7),
  ]),
  seed("ws_007", "настройка wordpress", "c_wp_setup", [
    q("настройка wordpress", 658),
    q("настройка сайта wordpress", 116),
    q("настройки темы wordpress", 59),
    q("настройки плагинов wordpress", 57),
    q("страница настроек wordpress", 49),
    q("wordpress установка настройка", 48),
    q("wordpress настройка сервера", 30),
    q("настройка seo wordpress", 26),
    q("smtp wordpress настройки", 25),
    q("wordpress настройки базы", 22),
    q("настройка woocommerce wordpress", 22),
    q("wp mail smtp wordpress настройка", 21),
    q("настройка wordpress для новичков", 20),
    q("wordpress настройка php", 17),
    q("htaccess wordpress настройка", 14),
    q("wordpress почта настройка", 13),
  ]),
  seed("ws_008", "ускорение сайта wordpress", "c_wp_performance", [
    q("ускорение сайта на wordpress", 31),
    q("плагин для ускорения сайта на wordpress", 10),
  ]),
  seed("ws_009", "перенос сайта wordpress", "c_wp_migration", [
    q("перенос сайта на wordpress", 101),
    q("перенос сайта wordpress на другой", 46),
    q("перенос сайта wordpress на хостинг", 28),
    q("перенос сайта на wordpress на домен", 25),
    q("перенос сайт wordpress на другой домен", 22),
    q("wordpress перенос сайта на другой хостинг", 20),
  ]),
  seed("ws_010", "доработка сайта wordpress", "c_wp_support", [
    q("доработка сайта на wordpress", 45),
  ]),
  seed("ws_011", "поддержка сайта wordpress", "c_wp_support", [
    q("поддержка сайтов wordpress", 48),
    q("техническая поддержка сайта wordpress", 8),
  ]),
  seed("ws_012", "безопасность wordpress", "c_wp_security", [
    q("безопасность wordpress", 84),
    q("безопасность сайта wordpress", 21),
    q("безопасность wordpress плагины", 13),
    q("wordpress книга по безопасности", 6),
  ]),
  seed("ws_013", "wordpress вирусы", "c_wp_security", [
    q("wordpress вирусы", 30),
  ]),
  seed("ws_014", "калькулятор для сайта", "c_calculators", [
    q("калькулятор для сайта", 1908),
    q("онлайн калькулятор для сайта", 614),
    q("калькулятор для расчета сайта", 541),
    q("калькулятор стоимости для сайта", 525),
    q("калькуляторы для сайта бесплатно", 92),
    q("калькулятор для сайта скачать", 57),
    q("разработка калькулятора для сайта", 45),
    q("создать калькулятор для сайта", 44),
    q("калькулятор для расчета стоимости сайта", 29),
    q("создание калькуляторов для сайта", 27),
    q("код калькулятора для сайта", 26),
    q("конструктор калькуляторов для сайтов", 25),
    q("как сделать калькулятор для сайта", 23),
    q("калькулятор доставки для сайта", 22),
    q("калькулятор услуг для сайта", 21),
  ]),
  seed("ws_015", "разработка плагина wordpress", "c_plugins_themes", [
    q("wordpress плагины разработка", 26),
  ]),
  seed("ws_016", "нейросеть для создания сайта", "c_geo_ai", [
    q("нейросеть для создания сайтов", 3139),
    q("нейросеть для создания сайта бесплатно", 865),
    q("лучшая нейросеть для создания сайтов", 133),
    q("нейросеть для создания сайта на русском", 92),
    q("нейросеть для создания дизайна сайта", 90),
    q("ai нейросеть для создания сайта", 85),
    q("нейросеть для создания сайта с нуля", 78),
    q("нейросеть для создания сайтов с нуля бесплатно", 67),
    q("нейросеть для создания сайта онлайн", 52),
  ]),
  seed("ws_017", "оптимизация сайта под нейросети", "c_geo_ai", [
    q("оптимизация сайта под нейросети", 31),
  ]),
  seed("ws_018", "наполнение сайта контентом", "c_content", [
    q("наполнение сайта контентом", 293),
    q("наполнение сайта контентом работа", 33),
    q("контент менеджер наполнение сайта", 13),
    q("пошаговое наполнение сайта контентом", 6),
  ]),
  seed("ws_019", "статья для сайта заказать", "c_content", [
    q("заказать статью для сайта", 26),
  ]),
  seed("ws_020", "__semantic_refill__", "c_wp_commercial", [], {
    wordstatStatus: "meta",
    notes: "Сигнал завершения очереди: запустить YADryshko и обновить семантическое ядро.",
  }),
];

const blockedCanonicalTopicKeys = [
  "wordpress разработка сайта",
  "wordpress заказать сайт",
  "wordpress elementor",
];

function q(phrase, shows, kind = "top") {
  return { phrase, shows, kind };
}

function seed(id, phrase, clusterId, queries, extra = {}) {
  return {
    id,
    phrase,
    wordstatStatus: extra.wordstatStatus ?? (queries.length ? "ok" : "no_data"),
    clusterId,
    queries,
    ...(extra.notes ? { notes: extra.notes } : {}),
  };
}

function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\n\r;]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function writeCsv(file, headers, rows) {
  const body = [headers.join(",")]
    .concat(rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")))
    .join("\n");
  writeFileSync(path.join(RUN_DIR, file), `${body}\n`, "utf-8");
}

function normalize(text) {
  return String(text)
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalTopicKey(text) {
  const tokens = normalize(text).split(/\s+/).filter(Boolean);
  const set = new Set(tokens);
  if (set.has("wordpress") && set.has("заказать")) return "wordpress заказать сайт";
  if (set.has("wordpress") && (set.has("разработка") || set.has("создание"))) return "wordpress разработка сайта";
  if (set.has("wordpress") && set.has("elementor")) return "wordpress elementor";
  if (set.has("wordpress") && (set.has("вирусы") || set.has("безопасность"))) return "wordpress безопасность";
  return tokens.slice(0, 4).join(" ");
}

function clusterById(id) {
  return clusters.find((cluster) => cluster.id === id);
}

function includedQueries() {
  const excluded = new Set(excludedBrandedQueries.map(normalize));
  return seeds.flatMap((seedItem) =>
    seedItem.queries
      .filter((item) => !excluded.has(normalize(item.phrase)))
      .map((item) => ({
        seed: seedItem,
        query: item.phrase,
        shows: item.shows,
        kind: item.kind ?? "top",
        cluster: clusterById(seedItem.clusterId),
      })),
  );
}

function priorityFrom(cluster, frequency) {
  if (cluster.priority === 0 || frequency >= 500) return "P0";
  if (cluster.priority === 1 || frequency >= 50) return "P1";
  return "P2";
}

function createRunFiles() {
  mkdirSync(RUN_DIR, { recursive: true });
  const rows = includedQueries();

  writeFileSync(
    path.join(RUN_DIR, "00-brief.md"),
    `# Бриф\n\nСайт: https://wordprais.ru/\n\nНиша: WordPress-разработка, SEO/GEO, продвижение в Яндексе, техническая поддержка WordPress, безопасность, контент и автоматизация публикаций.\n\nРегион: Россия, Wordstat 225. Это принято по умолчанию, потому что пользователь не указал другой регион.\n\nДата сбора: ${RUN_DATE}.\n\nИсточник частот: MCP-KV Wordstat.\n`,
    "utf-8",
  );
  writeFileSync(
    path.join(RUN_DIR, "01-site-inventory.md"),
    `# Инвентаризация сайта\n\nПроверены текущие опубликованные материалы WordPrais через WordPress API и блог. Обнаружены уже опубликованные группы по WordPress-разработке, Elementor, региональной разработке сайтов и SEO. Для автоматизации добавлена защита: перед выбором нового ключа индекс синхронизируется с опубликованными WordPress-постами.\n`,
    "utf-8",
  );
  writeFileSync(
    path.join(RUN_DIR, "02-seed-map.md"),
    `# Карта seed-семейств\n\n${clusters
      .map((cluster) => `- ${cluster.id}: ${cluster.titleRu} -> ${cluster.draftLandingUrl}`)
      .join("\n")}\n`,
    "utf-8",
  );

  writeCsv(
    "03-wordstat-raw.csv",
    ["date_collected", "seed_phrase", "query", "raw_frequency", "region", "device", "source", "source_call", "notes"],
    rows.map((row) => ({
      date_collected: RUN_DATE,
      seed_phrase: row.seed.phrase,
      query: row.query,
      raw_frequency: row.shows,
      region: "225 Россия",
      device: "all",
      source: "wordstat_mcp_kv",
      source_call: row.kind,
      notes: "",
    })),
  );

  writeCsv(
    "04-keywords-clean.csv",
    [
      "query",
      "canonical_query",
      "source_sources",
      "frequency_region",
      "frequency_value",
      "intent_initial",
      "intent_confidence",
      "cluster_candidate",
      "include_status",
      "exclude_reason",
      "notes",
    ],
    rows.map((row) => ({
      query: row.query,
      canonical_query: normalize(row.query),
      source_sources: row.seed.phrase,
      frequency_region: "225",
      frequency_value: row.shows,
      intent_initial: row.cluster.pageType === "service" ? "commercial" : "mixed",
      intent_confidence: row.shows >= 50 ? "high" : "medium",
      cluster_candidate: row.cluster.id,
      include_status: "include",
      exclude_reason: "",
      notes: `canonicalTopicKey=${canonicalTopicKey(row.query)}`,
    })),
  );

  writeCsv(
    "05-clusters.csv",
    [
      "cluster_id",
      "cluster_name",
      "primary_query",
      "secondary_queries",
      "intent",
      "frequency_total",
      "region_note",
      "page_type",
      "priority",
      "business_value",
      "target_url",
      "url_status",
      "serp_engine",
      "serp_check_status",
      "top_competitors",
      "geo_questions",
      "content_status",
      "last_review",
      "notes",
    ],
    clusters.map((cluster) => {
      const clusterRows = rows.filter((row) => row.cluster.id === cluster.id);
      const sorted = [...clusterRows].sort((a, b) => b.shows - a.shows);
      const total = clusterRows.reduce((sum, row) => sum + row.shows, 0);
      return {
        cluster_id: cluster.id,
        cluster_name: cluster.titleRu,
        primary_query: sorted[0]?.query ?? "",
        secondary_queries: sorted.slice(1, 8).map((row) => row.query).join(" | "),
        intent: cluster.pageType === "service" ? "commercial/service" : "informational/commercial",
        frequency_total: total,
        region_note: "Россия 225",
        page_type: cluster.pageType,
        priority: priorityFrom(cluster, total),
        business_value: cluster.businessValue,
        target_url: cluster.draftLandingUrl,
        url_status: "create_or_update",
        serp_engine: "Yandex/Google",
        serp_check_status: "not_checked",
        top_competitors: "",
        geo_questions: "Добавить FAQ, AI-quotable blocks, schema FAQ/Article",
        content_status: "queued",
        last_review: RUN_DATE,
        notes: "",
      };
    }),
  );

  writeCsv(
    "06-url-map.csv",
    [
      "target_url",
      "url_status",
      "page_type",
      "cluster_ids",
      "primary_queries",
      "recommended_h1",
      "title_draft",
      "description_draft",
      "internal_links_from",
      "internal_links_to",
      "implementation_task",
      "owner_hint",
      "notes",
    ],
    clusters.map((cluster) => {
      const clusterRows = rows.filter((row) => row.cluster.id === cluster.id).sort((a, b) => b.shows - a.shows);
      const primary = clusterRows[0]?.query ?? cluster.titleRu;
      return {
        target_url: cluster.draftLandingUrl,
        url_status: "create_or_update",
        page_type: cluster.pageType,
        cluster_ids: cluster.id,
        primary_queries: primary,
        recommended_h1: cluster.titleRu,
        title_draft: `${cluster.titleRu}: структура, приёмка и польза для бизнеса`,
        description_draft: `Практический разбор по теме "${primary}": что проверить, как поставить задачу и где не потерять заявки.`,
        internal_links_from: "/blog/; /uslugi/wordpress-razrabotka/; /prodvizhenie/seo/",
        internal_links_to: cluster.draftLandingUrl,
        implementation_task: "Сделать статью или посадочную по кластеру, проверить дубли, добавить schema и внутренние ссылки.",
        owner_hint: "WordPrais automation",
        notes: "Не публиковать без обложки, баннера и verified publication.",
      };
    }),
  );

  writeFileSync(
    path.join(RUN_DIR, "07-content-briefs.md"),
    `# P0/P1 контент-брифы\n\n${clusters
      .filter((cluster) => cluster.priority <= 1)
      .map((cluster) => {
        const clusterRows = rows.filter((row) => row.cluster.id === cluster.id).sort((a, b) => b.shows - a.shows);
        return `## ${cluster.titleRu}\n\nОсновной ключ: ${clusterRows[0]?.query ?? cluster.titleRu}\n\nКуда вести: ${cluster.draftLandingUrl}\n\nОбязательные блоки: проблема, кому подходит, чек-лист требований, таблица решений, ошибки, FAQ, AI-quotable вывод, CTA "Остались вопросы или нужна помощь? Контакты в шапке профиля или пишите в комментариях."\n\nКлючи: ${clusterRows
          .slice(0, 10)
          .map((row) => row.query)
          .join("; ")}\n`;
      })
      .join("\n")}\n`,
    "utf-8",
  );

  writeFileSync(
    path.join(RUN_DIR, "08-serp-geo-notes.md"),
    `# SERP/GEO/AI notes\n\nSERP вручную не проверялся, статус в CSV: not_checked. Для GEO/AI-search в каждой статье нужны короткие определяющие блоки, FAQ, таблицы с критериями выбора, JSON-LD Article/FAQ и внутренние ссылки на услуги.\n\nВажно: не использовать частоты Wordstat как рыночную статистику в тексте статьи без контекста. Частоты нужны для очереди и приоритизации.\n`,
    "utf-8",
  );
  writeFileSync(
    path.join(RUN_DIR, "09-quality-report.md"),
    `# Отчёт качества\n\nWordstat-вызовов: 19. Сырых включённых ключей: ${rows.length}. Кластеров: ${clusters.length}.\n\nОграничения: SERP не проверялся вручную; частоты только регион 225, device all. Низкочастотные, но коммерчески важные темы WordPress security/support оставлены в ядре, потому что они полезны для услуг и доверия.\n\nИсключены брендовые/мусорные хвосты: ${excludedBrandedQueries.join("; ")}.\n`,
    "utf-8",
  );
  writeFileSync(
    path.join(RUN_DIR, "10-todo.md"),
    `# TODO\n\n1. Использовать обновлённый config/wordprais-wordstat-automation.json в 3-часовой автоматизации.\n2. Перед каждым запуском выполнять wp:sync-content-index.\n3. Не публиковать статьи без обложки и баннера.\n4. После verified publication закрывать ключ как processed.\n5. Раз в 2-4 недели повторять YADryshko и расширять ядро.\n`,
    "utf-8",
  );
  writeFileSync(
    path.join(RUN_DIR, "12-implementation-roadmap.md"),
    `# Roadmap\n\nP0: SEO-продвижение, Яндекс, SEO-аудит, калькуляторы, WordPress-безопасность, WordPress-заказ/создание.\n\nP1: настройка WordPress, перенос, ускорение, поддержка, AI/GEO, контент.\n\nP2: узкие хвосты по плагинам, темам и отдельным техническим задачам.\n`,
    "utf-8",
  );
  writeFileSync(
    path.join(RUN_DIR, "README.md"),
    `# WordPrais semantic core ${RUN_DATE}\n\nПакет собран по workflow YADryshko для https://wordprais.ru/.\n\nГлавные файлы: 04-keywords-clean.csv, 05-clusters.csv, 06-url-map.csv, 07-content-briefs.md.\n`,
    "utf-8",
  );

  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>WordPrais semantic core</title><style>body{font-family:Arial,sans-serif;line-height:1.5;max-width:1180px;margin:32px auto;padding:0 20px}table{border-collapse:collapse;width:100%;margin:20px 0}td,th{border:1px solid #ccc;padding:8px 10px;text-align:left}th{background:#f2f2f2}</style></head><body><h1>WordPrais semantic core ${RUN_DATE}</h1><p>Ключей: ${rows.length}. Кластеров: ${clusters.length}. Wordstat-вызовов: 19.</p><table><thead><tr><th>Кластер</th><th>URL</th><th>Приоритет</th><th>Частотность</th></tr></thead><tbody>${clusters
    .map((cluster) => {
      const total = rows.filter((row) => row.cluster.id === cluster.id).reduce((sum, row) => sum + row.shows, 0);
      return `<tr><td>${cluster.titleRu}</td><td>${cluster.draftLandingUrl}</td><td>P${cluster.priority}</td><td>${total}</td></tr>`;
    })
    .join("")}</tbody></table></body></html>`;
  writeFileSync(path.join(RUN_DIR, "index.html"), html, "utf-8");
  writeFileSync(
    path.join(RUN_DIR, "semantic-core.xlsx"),
    html,
    "utf-8",
  );
}

function updateAutomationConfig() {
  const cfg = {
    version: 2,
    targetSite: "https://wordprais.ru/",
    blockedCanonicalTopicKeys,
    meta,
    excludedBrandedQueries,
    clusters: clusters.map(({ id, titleRu, priority, draftLandingUrl }) => ({
      id,
      titleRu,
      priority,
      draftLandingUrl,
    })),
    seeds,
    semanticRefill: {
      repositoryUrl: "https://github.com/Horosheff/yadryshko-semantic-core-subagent",
      targetVendorPath: "vendor/yadryshko-semantic-core-subagent",
      flagRelativePath: "artifacts/wordstat-queue-need-refill.flag",
    },
  };
  writeFileSync(CONFIG_PATH, `${JSON.stringify(cfg, null, 2)}\n`, "utf-8");
}

createRunFiles();
updateAutomationConfig();

const required = [
  "index.html",
  "semantic-core.xlsx",
  "README.md",
  "00-brief.md",
  "01-site-inventory.md",
  "02-seed-map.md",
  "03-wordstat-raw.csv",
  "04-keywords-clean.csv",
  "05-clusters.csv",
  "06-url-map.csv",
  "07-content-briefs.md",
  "08-serp-geo-notes.md",
  "09-quality-report.md",
  "10-todo.md",
  "12-implementation-roadmap.md",
];

const missing = required.filter((file) => !existsSync(path.join(RUN_DIR, file)));
console.log(
  JSON.stringify(
    {
      ok: missing.length === 0,
      runDir: path.relative(ROOT, RUN_DIR),
      rawKeywordCount: includedQueries().length,
      clusterCount: clusters.length,
      seedCount: seeds.length,
      missing,
      configPath: path.relative(ROOT, CONFIG_PATH),
    },
    null,
    2,
  ),
);
if (missing.length) process.exit(1);
