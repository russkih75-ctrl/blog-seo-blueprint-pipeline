/**
 * После публикации в WP: синхронизирует artifacts/content-runs/<run>/publish-result.json,
 * indexnow-result.json (если есть URL) и qa-report.json с данными из pipeline-state.json.
 *
 * RunId: CONTENT_RUN_ID → pipeline-state.contentRunId → самая новая запись в content-index (createdAt).
 */
import { config } from "dotenv";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ART = path.join(ROOT, "artifacts");

config({ path: path.join(ROOT, ".env") });
const mcpKvDotenvRel = process.env.MCP_KV_DOTENV_PATH?.trim();
if (mcpKvDotenvRel)
  config({ path: path.resolve(ROOT, mcpKvDotenvRel), override: true });

function pickRunId(state) {
  const envId = process.env.CONTENT_RUN_ID?.trim();
  if (envId) return envId;
  const fromState =
    typeof state.contentRunId === "string" ? state.contentRunId.trim() : "";
  if (fromState) return fromState;
  const indexPath = path.join(ART, "content-index.json");
  if (!existsSync(indexPath)) return null;
  const idx = JSON.parse(readFileSync(indexPath, "utf-8"));
  const entries = Array.isArray(idx.entries) ? idx.entries : [];
  if (!entries.length) return null;
  const sorted = [...entries].sort((a, b) => {
    const ta = Date.parse(a.createdAt ?? "") || 0;
    const tb = Date.parse(b.createdAt ?? "") || 0;
    return tb - ta;
  });
  return sorted[0]?.runId ?? null;
}

async function main() {
  mkdirSync(ART, { recursive: true });
  const statePath = path.join(ART, "pipeline-state.json");
  if (!existsSync(statePath))
    throw new Error("Нет artifacts/pipeline-state.json");

  const state = JSON.parse(readFileSync(statePath, "utf-8"));
  const pubUrl =
    typeof state.wordpressPublishedUrl === "string"
      ? state.wordpressPublishedUrl.trim()
      : "";
  const postId =
    typeof state.wordpressPostId === "number"
      ? state.wordpressPostId
      : typeof state.wordpressPostId === "string" &&
          /^\d+$/.test(state.wordpressPostId)
        ? Number(state.wordpressPostId)
        : undefined;

  const runId = pickRunId(state);
  if (!runId)
    throw new Error(
      "Не удалось определить runId: задайте CONTENT_RUN_ID или заполните artifacts/content-index.json",
    );

  const runDir = path.join(ART, "content-runs", runId);
  if (!existsSync(runDir))
    throw new Error(`Нет каталога запуска: ${path.relative(ROOT, runDir)}`);

  const publishResult = {
    runId,
    mode: "publish",
    status: pubUrl ? "published" : "pending",
    wordpressPublishedUrl: pubUrl || null,
    wordpressPostId: postId ?? null,
    syncedFrom: "artifacts/pipeline-state.json",
    rawSnippet:
      typeof state.wordpressPublishRaw === "string"
        ? state.wordpressPublishRaw.slice(0, 2000)
        : undefined,
    finalizedAt: new Date().toISOString(),
  };
  writeFileSync(
    path.join(runDir, "publish-result.json"),
    JSON.stringify(publishResult, null, 2),
    "utf-8",
  );

  let indexNowPayload = {
    runId,
    note:
      "IndexNow не вызывался (нет опубликованного URL или модуль недоступен).",
  };

  if (pubUrl) {
    try {
      const modUrl = pathToFileURL(
        path.join(ROOT, "dist/content-factory/indexnow-yandex.js"),
      ).href;
      const { submitSingleUrlGet } = await import(modUrl);
      const result = await submitSingleUrlGet(pubUrl, ROOT);
      indexNowPayload = {
        runId,
        ok: result.ok,
        httpStatus: result.httpStatus,
        status: result.status,
        detail: result.detail,
        actionRequired: result.actionRequired,
        localKeyFileRelative: result.localKeyFileRelative,
        expectedPublicUrlMasked: result.expectedPublicUrlMasked,
        keyMasked: result.keyMasked,
        finalizedAt: new Date().toISOString(),
      };
    } catch (e) {
      indexNowPayload = {
        runId,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        finalizedAt: new Date().toISOString(),
      };
    }
  }

  writeFileSync(
    path.join(runDir, "indexnow-result.json"),
    JSON.stringify(indexNowPayload, null, 2),
    "utf-8",
  );

  const qaPath = path.join(runDir, "qa-report.json");
  if (existsSync(qaPath)) {
    const qa = JSON.parse(readFileSync(qaPath, "utf-8"));
    const findings = Array.isArray(qa.findings) ? qa.findings : [];
    qa.pass = Boolean(pubUrl) && findings.length === 0;
    qa.publishFinalizeAt = new Date().toISOString();
    if (pubUrl) qa.wordpressPublishedUrl = pubUrl;
    writeFileSync(qaPath, JSON.stringify(qa, null, 2), "utf-8");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        runId,
        runDir: path.relative(ROOT, runDir),
        wordpressPublishedUrl: pubUrl || null,
        wordpressPostId: postId ?? null,
        indexNow: indexNowPayload.status ?? indexNowPayload.note ?? "n/a",
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
