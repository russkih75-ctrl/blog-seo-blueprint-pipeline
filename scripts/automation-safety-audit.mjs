#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ART = path.join(ROOT, "artifacts");

function readText(rel) {
  return readFileSync(path.join(ROOT, rel), "utf-8");
}

function readJson(rel) {
  return JSON.parse(readText(rel));
}

function check(condition, code, severity, detail) {
  return condition ? null : { code, severity, detail };
}

const pkg = readJson("package.json");
const cfg = readJson("config/agent-orchestration.json");
const cloud = readText("src/run-workflow-cloud.ts");
const publish = readText("scripts/wp-publish-streamable.mjs");
const nano = readText("prompts/wordpress-articles/NANO_WORDPRESS_STUDIO.md");

const requiredScripts = [
  "build",
  "typecheck",
  "workflow:cloud",
  "wp:publish-streamable",
  "wp:wordstat-queue-next",
  "mcp:tools-check",
  "automation:audit",
];
const requiredSubagents = [
  "queue-keyword-guardian",
  "duplicate-title-meta-guardian",
  "seo-content-writer",
  "geo-ai-search-optimizer",
  "russian-humanizer",
  "media-director",
  "wordpress-publish-guardian",
  "verification-guardian",
  "recovery-notifier",
];
const subagentIds = new Set(
  (cfg.subagentSystem?.subagents ?? []).map((agent) => String(agent.id)),
);

const findings = [
  ...requiredScripts.map((name) =>
    check(Boolean(pkg.scripts?.[name]), "missing_package_script", "blocker", name),
  ),
  check(
    cfg.requiredSupervisor?.id === "content-structure-director" &&
      cfg.requiredSupervisor?.requiredBeforePublish === true,
    "director_not_required_before_publish",
    "blocker",
    cfg.requiredSupervisor ?? null,
  ),
  ...requiredSubagents.map((id) =>
    check(subagentIds.has(id), "missing_subagent", "blocker", id),
  ),
  check(
    Number(cfg.hardGates?.minimumFinalHtmlCharacters ?? 0) >= 12000,
    "minimum_article_depth_too_low",
    "blocker",
    cfg.hardGates?.minimumFinalHtmlCharacters,
  ),
  check(
    Number(cfg.hardGates?.minimumContentHeadingsH2H3 ?? 0) >= 8,
    "minimum_heading_count_too_low",
    "blocker",
    cfg.hardGates?.minimumContentHeadingsH2H3,
  ),
  check(
    cfg.hardGates?.mediaRequiredForPublish === true,
    "media_not_required_for_publish",
    "blocker",
    cfg.hardGates?.mediaRequiredForPublish,
  ),
  check(
    cloud.includes("function computeQualityGates("),
    "cloud_quality_gates_not_computed",
    "blocker",
    "src/run-workflow-cloud.ts",
  ),
  check(
    !/state\.qualityGates\s*=\s*{\s*seoContentWriterPassed:\s*true/s.test(cloud),
    "cloud_stage_autopass_detected",
    "blocker",
    "Do not mark subordinate stages true without measurable checks.",
  ),
  check(
    cloud.includes("geoAiSearchOptimizerPassed") &&
      cloud.includes("mediaDirectorPassed"),
    "cloud_missing_geo_or_media_director_gate",
    "blocker",
    "Expected geoAiSearchOptimizerPassed and mediaDirectorPassed.",
  ),
  check(
    publish.includes("forbidden_html_marker") &&
      publish.includes("humanizer_slop_markers_too_many") &&
      publish.includes("duplicate_h2_h3_heading"),
    "publish_script_missing_secondary_quality_gates",
    "blocker",
    "scripts/wp-publish-streamable.mjs",
  ),
  check(
    cloud.includes("duplicate_h2_h3_heading") &&
      cloud.includes("Остались вопросы") &&
      cloud.includes("пишите в комментариях"),
    "cloud_missing_heading_or_cta_gate",
    "blocker",
    "Expected duplicate heading gate and natural CTA gate.",
  ),
  check(
    readText("scripts/wp-wordstat-queue-next.mjs").includes("canonicalTopicKey"),
    "queue_missing_canonical_topic_guard",
    "blocker",
    "Wordstat queue must block reused base topic keys, not only exact phrases.",
  ),
  check(
    nano.includes("module `5`") &&
      nano.includes("module `9`") &&
      nano.includes("identity_lock=true"),
    "nano_make_blueprint_rules_missing",
    "blocker",
    "prompts/wordpress-articles/NANO_WORDPRESS_STUDIO.md",
  ),
  check(
    [
      "1776706200543-lxk48gqcs3c",
      "1776707366899-9kshlushgiv",
      "1776710984257-8p4bnpwivq9",
    ].every((ref) => nano.includes(ref)),
    "nano_face_refs_missing",
    "blocker",
    "All user face refs must be present in Nano prompt rules.",
  ),
].filter(Boolean);

const blockers = findings.filter((item) => item.severity === "blocker");
const result = {
  ok: blockers.length === 0,
  checkedAt: new Date().toISOString(),
  director: cfg.requiredSupervisor?.id ?? null,
  subagentCount: subagentIds.size,
  findings,
};

mkdirSync(ART, { recursive: true });
writeFileSync(
  path.join(ART, "automation-safety-audit.json"),
  JSON.stringify(result, null, 2),
  "utf-8",
);

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ok) process.exit(1);
