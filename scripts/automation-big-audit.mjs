#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ART = path.join(ROOT, "artifacts");

function readText(rel, fallback = "") {
  const file = path.join(ROOT, rel);
  return existsSync(file) ? readFileSync(file, "utf-8") : fallback;
}

function readJson(rel, fallback = null) {
  try {
    const raw = readText(rel);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function runCheck(name, cmd, args) {
  const startedAt = Date.now();
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    shell: process.platform === "win32",
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  return {
    name,
    ok: res.status === 0,
    status: res.status,
    durationMs: Date.now() - startedAt,
    stdoutTail: String(res.stdout ?? "").slice(-1200),
    stderrTail: String(res.stderr ?? "").slice(-1200),
  };
}

function check(condition, code, severity, detail) {
  return condition ? null : { code, severity, detail };
}

const pkg = readJson("package.json", {});
const cfg = readJson("config/agent-orchestration.json", {});
const queue = readJson("artifacts/wordstat-queue-cursor.json", {});
const last = readJson("artifacts/wordstat-queue-last.json", {});
const contentIndex = readJson("artifacts/content-index.json", { entries: [] });
const cloud = readText("src/run-workflow-cloud.ts");
const publish = readText("scripts/wp-publish-streamable.mjs");
const queueScript = readText("scripts/wp-wordstat-queue-next.mjs");

const localChecks = [
  runCheck("node_check_workflow_wordstat_next", "node", ["--check", "scripts/workflow-wordstat-next.mjs"]),
  runCheck("node_check_wp_publish_streamable", "node", ["--check", "scripts/wp-publish-streamable.mjs"]),
  runCheck("typecheck", "npm.cmd", ["run", "typecheck"]),
  runCheck("build", "npm.cmd", ["run", "build"]),
  runCheck("automation_audit", "npm.cmd", ["run", "automation:audit"]),
];

const findings = [
  check(Boolean(pkg.scripts?.["workflow:wordstat-next"]), "missing_wordstat_next_entrypoint", "blocker", "package.json"),
  check(Boolean(pkg.scripts?.["automation:big-audit"]), "missing_big_audit_script", "blocker", "package.json"),
  check((cfg.subagentSystem?.subagents ?? []).length >= 13, "subagent_system_too_small", "blocker", cfg.subagentSystem?.subagents?.length ?? 0),
  check(cfg.requiredSupervisor?.id === "content-structure-director", "director_not_configured", "blocker", cfg.requiredSupervisor ?? null),
  check(Number(cfg.hardGates?.minimumFinalHtmlCharacters ?? 0) >= 12000, "min_depth_too_low", "blocker", cfg.hardGates?.minimumFinalHtmlCharacters),
  check(Number(cfg.hardGates?.minimumInternalLinks ?? 0) >= 4, "min_internal_links_too_low", "blocker", cfg.hardGates?.minimumInternalLinks),
  check(Number(cfg.hardGates?.minimumJsonLdScripts ?? 0) >= 1, "json_ld_not_required", "blocker", cfg.hardGates?.minimumJsonLdScripts),
  check(cfg.hardGates?.mediaRequiredForPublish === true, "media_not_required", "blocker", cfg.hardGates?.mediaRequiredForPublish),
  check(cloud.includes("keywordCoverageOk") && publish.includes("keywordCoverageOk"), "keyword_coverage_gate_missing", "blocker", "cloud+publish"),
  check(cloud.includes("duplicateParagraphs") && publish.includes("duplicateParagraphs"), "duplicate_paragraph_gate_missing", "blocker", "cloud+publish"),
  check(queueScript.includes("canonicalTopicKey"), "canonical_topic_key_missing", "blocker", "scripts/wp-wordstat-queue-next.mjs"),
  check(Array.isArray(queue.pendingPhrasesNorm), "queue_pending_state_missing", "warning", "artifacts/wordstat-queue-cursor.json"),
  check(last.mode === "topic" || last.mode === "semantic_refill" || last.mode === undefined, "unexpected_last_queue_mode", "warning", last.mode),
  check(Array.isArray(contentIndex.entries), "content_index_entries_missing", "warning", "artifacts/content-index.json"),
  ...localChecks.map((item) =>
    check(item.ok, `local_check_failed_${item.name}`, "blocker", {
      status: item.status,
      stdoutTail: item.stdoutTail,
      stderrTail: item.stderrTail,
    }),
  ),
].filter(Boolean);

const result = {
  ok: findings.every((finding) => finding.severity !== "blocker"),
  checkedAt: new Date().toISOString(),
  localChecks,
  queue: {
    lastMode: last.mode ?? null,
    lastPhrase: last.phrase ?? null,
    pendingCount: Array.isArray(queue.pendingPhrasesNorm) ? queue.pendingPhrasesNorm.length : null,
  },
  subagentCount: (cfg.subagentSystem?.subagents ?? []).length,
  contentIndexEntries: Array.isArray(contentIndex.entries) ? contentIndex.entries.length : null,
  findings,
};

mkdirSync(ART, { recursive: true });
writeFileSync(path.join(ART, "automation-big-audit.json"), JSON.stringify(result, null, 2), "utf-8");
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ok) process.exit(1);
