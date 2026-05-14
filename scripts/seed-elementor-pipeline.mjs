/**
 * Заполняет artifacts/pipeline-state.json статьёй про Elementor (нейтральный текст, без промо-ссылок).
 * Опционально: CONTENT_RUN_ID — обновит seo.json в каталоге content-runs.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ART = path.join(ROOT, "artifacts");
const BODY_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "data",
  "elementor-article-body.html",
);

const COVER_URL =
  "https://images.unsplash.com/photo-1467232004584-a241de8bcf5d?w=1600&q=80";
const MID_BANNER_URL =
  "https://images.unsplash.com/photo-1547658719-da9b46aea9e8?w=1400&q=80";

let articleHtml = readFileSync(BODY_PATH, "utf-8");
articleHtml = articleHtml.replace(/MID_IMG_URL_PLACEHOLDER/g, MID_BANNER_URL);

const seoTitle =
  "Elementor для WordPress: конструктор страниц, обложка и баннер без лишнего кода";
const metaDescription =
  "Разбираем Elementor как конструктор страниц для WordPress: бесплатная база и платное расширение Pro, сетка, типичные ошибки, производительность. С иллюстрацией-баннером в тексте.";

const runIdEnv = process.env.CONTENT_RUN_ID?.trim() ?? null;

const state = {
  topic:
    "Elementor — визуальный конструктор страниц и записей для WordPress: сетка, виджеты, темизация",
  seoTitle,
  metaDescription,
  articleHtml,
  research:
    "Нейтральный обзор без цитирования персон и без рекламных URL. Цифры тарифов уточнять на официальной странице продукта на момент публикации.",
  coverNanoPublicUrl: COVER_URL,
  bannerNanoPublicUrl: MID_BANNER_URL,
  midArticleBannerSrcUrl: MID_BANNER_URL,
  contentRunId: runIdEnv,
  imagePack: {
    filename: "elementor_cover",
    title: seoTitle.slice(0, 120),
    alt: "Работа с визуальным конструктором страниц WordPress",
    caption: seoTitle.slice(0, 160),
    info: metaDescription.slice(0, 240),
  },
};

mkdirSync(ART, { recursive: true });
writeFileSync(
  path.join(ART, "pipeline-state.json"),
  JSON.stringify(state, null, 2),
  "utf-8",
);

const runId = process.env.CONTENT_RUN_ID?.trim();
if (runId) {
  const runDir = path.join(ART, "content-runs", runId);
  if (existsSync(runDir)) {
    const seoPath = path.join(runDir, "seo.json");
    if (existsSync(seoPath)) {
      const seo = JSON.parse(readFileSync(seoPath, "utf-8"));
      seo.title = seoTitle;
      seo.metaDescription = metaDescription;
      seo.slug = "elementor-wordpress-konstruktor-stranic-oblozhka";
      seo.h1 = seoTitle;
      writeFileSync(seoPath, JSON.stringify(seo, null, 2), "utf-8");
    }
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      pipelineState: "artifacts/pipeline-state.json",
      chars: articleHtml.length,
      contentRunId: runId || null,
    },
    null,
    2,
  ),
);
