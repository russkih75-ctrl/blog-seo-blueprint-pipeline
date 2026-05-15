/**
 * CLI оркестратора content-factory: каркас артефактов + антидубль + IndexNow.
 * Реальную генерацию статей выполняет Cursor Agent по skills/handoff.
 */
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import type { AgentOrchestrationConfig } from "./types.js";
import type { ContentIndex, HandoffDocument, PublishMode } from "./types.js";
import { evaluateDuplicate } from "./duplicate-guardian.js";
import {
  submitSingleUrlGet,
  submitUrlListPost,
  prepareVerificationKeyArtifact,
  maskKeyFilenameInRelativePath,
} from "./indexnow-yandex.js";
import { loadStyleTemplate, styleTemplateToPromptChecklist } from "./style-template.js";
import { HUMANIZER_RULES_MARKDOWN } from "./humanizer-rules.js";
import { getMetlaArtifactSummary } from "./metla.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
loadEnv({ path: path.join(REPO_ROOT, ".env") });

const ARTIFACTS = path.join(REPO_ROOT, "artifacts");
const CONTENT_INDEX_PATH = path.join(ARTIFACTS, "content-index.json");

interface CliArgs {
  niche: string;
  keywords: string[];
  references: string[];
  visualReferenceImages: string[];
  region?: string;
  brand?: string;
  targetAudience?: string;
  forceDryRun: boolean;
  publishFlag: boolean;
  checkOnly: boolean;
  indexnowOnly: boolean;
  indexNowUrls: string[];
  prepareKey: boolean;
  indexNowHost?: string;
}

function parseArgv(argv: string[]): CliArgs {
  const out: CliArgs = {
    niche: "",
    keywords: [],
    references: [],
    visualReferenceImages: [],
    forceDryRun: false,
    publishFlag: false,
    checkOnly: false,
    indexnowOnly: false,
    indexNowUrls: [],
    prepareKey: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => {
      const v = argv[++i];
      if (!v) throw new Error(`Ожидалось значение после ${a}`);
      return v;
    };
    switch (a) {
      case "--niche":
        out.niche = next();
        break;
      case "--keywords":
        out.keywords.push(
          ...next()
            .split(/[,;|]/u)
            .map((x) => x.trim())
            .filter(Boolean),
        );
        break;
      case "--reference":
        out.references.push(next());
        break;
      case "--visual-reference":
      case "--face-reference":
        out.visualReferenceImages.push(next());
        break;
      case "--region":
        out.region = next();
        break;
      case "--brand":
        out.brand = next();
        break;
      case "--target-audience":
        out.targetAudience = next();
        break;
      case "--dry-run":
        out.forceDryRun = true;
        break;
      case "--publish":
        out.publishFlag = true;
        break;
      case "--check-only":
        out.checkOnly = true;
        break;
      case "--indexnow-only":
        out.indexnowOnly = true;
        break;
      case "--prepare-key":
        out.prepareKey = true;
        break;
      case "--host":
        out.indexNowHost = next();
        break;
      case "--urls":
        out.indexNowUrls.push(
          ...next()
            .split(/[,;\s]+/u)
            .map((x) => x.trim())
            .filter(Boolean),
        );
        break;
      default:
        if (out.indexnowOnly && /^https?:\/\//iu.test(a))
          out.indexNowUrls.push(a);
        break;
    }
  }
  return out;
}

function resolvePublishMode(args: CliArgs): PublishMode {
  if (args.forceDryRun) return "dry-run";
  if (args.publishFlag) return "publish";
  const env = process.env.CONTENT_PUBLISH_MODE?.trim().toLowerCase();
  if (env === "publish") return "publish";
  if (env === "draft") return "draft";
  return "dry-run";
}

function loadOrchestration(): AgentOrchestrationConfig {
  const p = path.join(REPO_ROOT, "config", "agent-orchestration.json");
  return JSON.parse(readFileSync(p, "utf-8")) as AgentOrchestrationConfig;
}

function ensureContentIndex(): ContentIndex {
  mkdirSync(ARTIFACTS, { recursive: true });
  if (!existsSync(CONTENT_INDEX_PATH)) {
    const fresh: ContentIndex = { version: 1, entries: [] };
    writeFileSync(CONTENT_INDEX_PATH, JSON.stringify(fresh, null, 2), "utf-8");
    return fresh;
  }
  return JSON.parse(readFileSync(CONTENT_INDEX_PATH, "utf-8")) as ContentIndex;
}

function slugifyPrimary(text: string): string {
  const s = text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .slice(0, 96);
  return s || "topic";
}

function newRunId(): string {
  const iso = new Date().toISOString().replace(/[:.]/gu, "-");
  const rnd = randomBytes(3).toString("hex");
  return `run_${iso}_${rnd}`;
}

function validateConfigs(): void {
  const paths = [
    path.join(REPO_ROOT, "config", "agent-orchestration.json"),
    path.join(REPO_ROOT, "config", "default-article-style.json"),
    path.join(REPO_ROOT, "config", "content-pipeline.schema.json"),
  ];
  for (const p of paths) {
    if (!existsSync(p)) throw new Error(`Отсутствует конфиг: ${p}`);
    JSON.parse(readFileSync(p, "utf-8"));
  }
  const orch = loadOrchestration();
  const ids = orch.stages.map((s: { id: string }) => s.id);
  if (new Set(ids).size !== ids.length)
    throw new Error("Дубликаты id в agent-orchestration.json");
  loadStyleTemplate(REPO_ROOT);
}

function buildStageMap(
  orch: AgentOrchestrationConfig,
): HandoffDocument["stages"] {
  const stages: HandoffDocument["stages"] = {};
  const now = new Date().toISOString();
  for (const s of [...orch.stages].sort((a, b) => a.order - b.order)) {
    stages[s.id] = {
      status: s.id === "director" ? "in_progress" : "pending",
      updatedAt: now,
    };
  }
  return stages;
}

function supervisorChecklist(): string[] {
  return [
    "Intake: articleReferenceUrls (стиль статьи) отдельно от visualReferenceImages (лицо); identityLock при лице",
    "Стиль: mayai-подобная структура без копипасты; референс статьи не источник фактов и не источник картинок тела статьи",
    "Keywords: primary/secondary, intent, GEO, AI-фразы",
    "Research: без выдуманной статистики",
    "SEO: title/meta/slug/H-карта/FAQ/schema hints",
    "Writer → Humanizer обязателен",
    "Duplicate guardian: pass или исправления angle",
    "Метла: webhook опционален; без него pass-through; METLA_REQUIRE блокирует publish без endpoint",
    "Publisher: WP через MCP или npm run workflow:cloud",
    "IndexNow после URL: публичный verification key + файл на домене (не API-token)",
    "Supervisor ≤3 цикла",
  ];
}

function writeOrchestratorPrompt(
  runDir: string,
  handoff: HandoffDocument,
  styleMd: string,
): void {
  const i = handoff.intake;
  const intakeBlock = `## Intake — политика референсов (handoff.json)

- **articleReferenceUrls** (${i.articleReferenceUrls.length}): только структура, стиль, ритм, блоки, ориентир длины — **не** факты, **не** иллюстрации тела статьи; текст референса не копировать.
- **visualReferenceImages** (${i.visualReferenceImages.length}): отдельный референс **лица** для обложки и баннера (Nano, blueprint RU SEO-GEO 2026).
- **identityLock**: ${String(i.identityLock)} — при true не менять лицо/идентичность.
- **styleReferencePolicy**: \`${i.styleReferencePolicy}\`
- Поле **references** дублирует articleReferenceUrls для совместимости.
`;

  const body = `# Content Factory — run ${handoff.runId}

## Режим публикации
${handoff.publishMode}

## Director
Ты ведёшь стадии по \`config/agent-orchestration.json\`. Обновляй \`handoff.json\` после каждого этапа.

${intakeBlock}

## WordPress bridge (наследие)
Для полного Make-пайплайна Wordstat/Nano используй существующий скрипт:
\`npm run workflow:cloud -- "<тема из intake>"\`
Источник: \`${handoff.wordpressBridge.scriptPath}\`
Тему сформируй из ниши и primary keyword (без вставки секретов в файлы).

## Humanizer
${HUMANIZER_RULES_MARKDOWN}

## Стиль статьи
${styleMd}

## Артефакты в этом каталоге
- handoff.json (истина по статусам)
- article-draft.md → article.md после humanizer
- seo.json, keywords.json, research.md
- duplicate-report.json (обязательно до publish)
- qa-report.json (supervisor)
- indexnow-result.json, media-metla.json — по необходимости
`;
  writeFileSync(path.join(runDir, "ORCHESTRATOR_PROMPT.md"), body, "utf-8");
}

async function runIndexNowCli(
  urls: string[],
  repoRoot: string,
): Promise<void> {
  if (!urls.length) {
    console.error("Укажите --urls или URL-аргументы после флагов.");
    process.exitCode = 1;
    return;
  }
  const result =
    urls.length === 1
      ? await submitSingleUrlGet(urls[0]!, repoRoot)
      : await submitUrlListPost(urls, repoRoot);
  const payload = {
    ok: result.ok,
    mode: result.mode,
    httpStatus: result.httpStatus,
    status: result.status,
    detail: result.detail,
    actionRequired: result.actionRequired,
    localKeyFileRelative: result.localKeyFileRelative
      ? maskKeyFilenameInRelativePath(result.localKeyFileRelative)
      : undefined,
    expectedPublicUrlMasked: result.expectedPublicUrlMasked,
    keyMasked: result.keyMasked,
  };
  console.log(JSON.stringify(payload, null, 2));
  const nonFatal =
    result.status === "needs_key_file_upload" ||
    result.status === "skipped_pass_through" ||
    result.status === "submitted" ||
    result.status === "accepted_pending_verification" ||
    result.status === "forbidden" ||
    result.status === "validation_error" ||
    result.status === "rate_limited";
  if (!result.ok && !nonFatal) process.exitCode = 1;
}

async function main(): Promise<void> {
  const argv = parseArgv(process.argv.slice(2));

  if (argv.checkOnly) {
    validateConfigs();
    console.log("content:check OK");
    return;
  }

  if (argv.indexnowOnly) {
    if (argv.prepareKey) {
      const host =
        argv.indexNowHost?.trim() || process.env.SITE_HOST?.trim();
      if (!host)
        throw new Error(
          "Для --prepare-key укажите --host https://example.com или SITE_HOST в .env",
        );
      const prep = prepareVerificationKeyArtifact(REPO_ROOT, host);
      const idxDir = path.join(ARTIFACTS, "indexnow");
      mkdirSync(idxDir, { recursive: true });
      const report = {
        ok: true,
        mode: "prepare",
        httpStatus: 0,
        status: "verification_key_file_created",
        detail:
          "Файл публичного verification key создан локально. Разместите его на origin и задайте INDEXNOW_KEY + INDEXNOW_KEY_LOCATION.",
        actionRequired: "upload_key_file_to_origin" as const,
        localKeyFileRelative: maskKeyFilenameInRelativePath(prep.localKeyFileRelative),
        expectedPublicUrlMasked: prep.expectedPublicUrlMasked,
        keyMasked: prep.keyMasked,
      };
      writeFileSync(
        path.join(idxDir, "prepare-report.json"),
        JSON.stringify(report, null, 2),
        "utf-8",
      );
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    const urls =
      argv.indexNowUrls.length > 0
        ? argv.indexNowUrls
        : process.argv.slice(2).filter((x) => /^https?:\/\//iu.test(x));
    await runIndexNowCli(urls, REPO_ROOT);
    return;
  }

  validateConfigs();
  const orch = loadOrchestration();
  const publishMode = resolvePublishMode(argv);

  if (!argv.niche.trim())
    throw new Error("Укажите --niche \"...\"");
  if (!argv.keywords.length)
    throw new Error("Укажите --keywords \"...\"");

  const primaryKw = argv.keywords[0]!;
  const styleCfg = loadStyleTemplate(REPO_ROOT);
  const stylePolicy =
    styleCfg.referenceUsage ?? "structure_style_length_only";

  const assumptions: string[] = [];
  if (!argv.region) assumptions.push("Регион не указан — по умолчанию РФ при GEO.");
  if (!argv.brand) assumptions.push("Бренд не указан — нейтральный экспертный текст.");
  if (!argv.targetAudience)
    assumptions.push("Аудитория не указана — B2B/B2C смешанная по нише.");

  const articleRefs = [...argv.references];
  const visualRefs = [...argv.visualReferenceImages];
  if (articleRefs.length > 0)
    assumptions.push(
      "Article reference URL: только структура/стиль/длина — не источник фактов и не источник изображений для тела статьи.",
    );
  if (visualRefs.length > 0)
    assumptions.push(
      "Задан отдельный визуальный референс лица: для обложки/баннера identity_lock=true, лицо не менять.",
    );

  const runId = newRunId();
  const runDir = path.join(ARTIFACTS, "content-runs", runId);
  mkdirSync(runDir, { recursive: true });

  const intake = {
    niche: argv.niche.trim(),
    keywords: argv.keywords,
    references: articleRefs,
    articleReferenceUrls: articleRefs,
    visualReferenceImages: visualRefs,
    identityLock: visualRefs.length > 0,
    styleReferencePolicy: stylePolicy,
    region: argv.region,
    brand: argv.brand,
    targetAudience: argv.targetAudience,
    publishMode,
    assumptions,
  };

  const handoff: HandoffDocument = {
    runId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    publishMode,
    intake,
    stages: buildStageMap(orch),
    supervisorIteration: 0,
    wordpressBridge: {
      mode: "legacy_workflow_cloud",
      workflowTopicTemplate: `${intake.niche}: ${primaryKw}`,
      readmePath: "README.md",
      scriptPath: "src/run-workflow-cloud.ts",
    },
    supervisorChecklist: supervisorChecklist(),
  };

  writeFileSync(
    path.join(runDir, "handoff.json"),
    JSON.stringify(handoff, null, 2),
    "utf-8",
  );

  const styleMd = styleTemplateToPromptChecklist(styleCfg);
  writeOrchestratorPrompt(runDir, handoff, styleMd);

  const provisionalSlug = slugifyPrimary(primaryKw);
  const provisionalBody = `${intake.niche}\n${intake.keywords.join(", ")}\n${intake.articleReferenceUrls.join("\n")}`;
  const index = ensureContentIndex();
  const dup = evaluateDuplicate(index, {
    runId,
    primaryKeyword: primaryKw,
    slug: provisionalSlug,
    title: primaryKw,
    bodyText: provisionalBody,
  });
  writeFileSync(
    path.join(runDir, "duplicate-report.json"),
    JSON.stringify(dup, null, 2),
    "utf-8",
  );

  writeFileSync(
    path.join(runDir, "seo.json"),
    JSON.stringify(
      {
        title: "",
        metaDescription: "",
        slug: provisionalSlug,
        h1: "",
        outline: [],
        faq: [],
        schemaHints: [],
        openGraph: {},
        aiCitationBlocks: [],
      },
      null,
      2,
    ),
    "utf-8",
  );

  writeFileSync(
    path.join(runDir, "keywords.json"),
    JSON.stringify(
      {
        primary: primaryKw,
        secondary: argv.keywords.slice(1),
        intent: "",
        entities: [],
        geoQueries: [],
        aiAnswerPhrases: [],
      },
      null,
      2,
    ),
    "utf-8",
  );

  writeFileSync(
    path.join(runDir, "research.md"),
    "_Заполнить Research Agent: только проверяемые факты._\n",
    "utf-8",
  );

  writeFileSync(
    path.join(runDir, "article-draft.md"),
    "_Черновик Content Writer — затем humanizer → article.md._\n",
    "utf-8",
  );

  writeFileSync(
    path.join(runDir, "article.md"),
    publishMode === "dry-run"
      ? `<!-- dry-run каркас ${runId}: заполнить после стадий writer/humanizer -->\n`
      : "_Заполнить после humanizer._\n",
    "utf-8",
  );

  writeFileSync(
    path.join(runDir, "qa-report.json"),
    JSON.stringify(
      {
        runId,
        iteration: 0,
        checklist: handoff.supervisorChecklist,
        findings: [],
        pass: false,
      },
      null,
      2,
    ),
    "utf-8",
  );

  const metla = getMetlaArtifactSummary(runId, publishMode);
  writeFileSync(
    path.join(runDir, "media-metla.json"),
    JSON.stringify(metla, null, 2),
    "utf-8",
  );

  writeFileSync(
    path.join(runDir, "indexnow-result.json"),
    JSON.stringify(
      {
        runId,
        note:
          "После publisher: IndexNow с публичным verification key (INDEXNOW_KEY + файл на домене). См. npm run content:indexnow.",
      },
      null,
      2,
    ),
    "utf-8",
  );

  writeFileSync(
    path.join(runDir, "publish-result.json"),
    JSON.stringify(
      {
        runId,
        mode: publishMode,
        note:
          publishMode === "dry-run"
            ? "Публикация отключена (dry-run)."
            : "Выполнить Publisher Agent (MCP wordpress_* или npm run workflow:cloud).",
      },
      null,
      2,
    ),
    "utf-8",
  );

  console.log(
    JSON.stringify(
      {
        runId,
        runDir: path.relative(REPO_ROOT, runDir),
        publishMode,
        duplicateDecision: dup.decision,
        contentIndex: path.relative(REPO_ROOT, CONTENT_INDEX_PATH),
      },
      null,
      2,
    ),
  );

  if (dup.decision === "blocked") {
    console.error(
      "duplicate-report: blocked — исправьте angle или проверьте индекс перед продолжением.",
    );
    process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
