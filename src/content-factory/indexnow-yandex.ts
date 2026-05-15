import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import type { IndexNowResult } from "./types.js";

const INDEXNOW_ENDPOINT =
  process.env.INDEXNOW_API_URL?.trim() || "https://yandex.com/indexnow";

function loadEnvFromRoot(repoRoot: string): void {
  loadEnv({ path: path.join(repoRoot, ".env") });
  const rel = process.env.MCP_KV_DOTENV_PATH?.trim();
  if (rel) loadEnv({ path: path.resolve(repoRoot, rel), override: true });
}

function resolveKey(): string | undefined {
  return (
    process.env.INDEXNOW_KEY?.trim() ||
    process.env.YANDEX_INDEXNOW_VERIFICATION_KEY?.trim() ||
    process.env.YANDEX_INDEXNOW_KEY?.trim() ||
    undefined
  );
}

function resolveKeyLocation(): string | undefined {
  return (
    process.env.INDEXNOW_KEY_LOCATION?.trim() ||
    process.env.YANDEX_INDEXNOW_KEY_LOCATION?.trim() ||
    undefined
  );
}

function hostFromUrl(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

function maskKey(key: string): string {
  if (key.length <= 4) return "****";
  return `${key.slice(0, 2)}…${key.slice(-2)}`;
}

export function maskKeyFilenameInRelativePath(rel: string): string {
  const base = path.basename(rel);
  if (/^[a-f0-9]{16,64}\.txt$/iu.test(base)) {
    return rel.replace(base, `${base.slice(0, 4)}…${base.slice(-6)}`);
  }
  return rel;
}

export function prepareVerificationKeyArtifact(
  repoRoot: string,
  siteHost: string,
): {
  localKeyFileRelative: string;
  expectedPublicUrlMasked: string;
  keyMasked: string;
  key: string;
} {
  loadEnvFromRoot(repoRoot);
  const key = randomBytes(16).toString("hex");
  const idxDir = path.join(repoRoot, "artifacts", "indexnow");
  mkdirSync(idxDir, { recursive: true });
  const fname = `${key}.txt`;
  const abs = path.join(idxDir, fname);
  writeFileSync(abs, key, "utf-8");
  let host = siteHost.trim();
  if (!/^https?:\/\//iu.test(host)) host = `https://${host}`;
  const u = new URL(host);
  const origin = `${u.protocol}//${u.hostname}`;
  const expectedPublic = `${origin}/${fname}`;
  return {
    localKeyFileRelative: path.relative(repoRoot, abs),
    expectedPublicUrlMasked: `${origin}/${maskKey(fname)}`,
    keyMasked: maskKey(key),
    key,
  };
}

async function postIndexNow(
  repoRoot: string,
  urlList: string[],
): Promise<IndexNowResult> {
  loadEnvFromRoot(repoRoot);
  const key = resolveKey();
  const keyLocation = resolveKeyLocation();
  const first = urlList[0];
  const host = first ? hostFromUrl(first) : undefined;

  if (!key || !keyLocation || !host) {
    return {
      ok: true,
      mode: "skipped",
      httpStatus: 0,
      status: "skipped_pass_through",
      detail:
        "IndexNow: не заданы INDEXNOW_KEY и/или INDEXNOW_KEY_LOCATION — пропуск без ошибки.",
      actionRequired: "configure_indexnow_key_and_key_location",
    };
  }

  const body = {
    host,
    key,
    keyLocation,
    urlList,
  };

  try {
    const res = await fetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });
    const httpStatus = res.status;
    const ok = httpStatus === 200 || httpStatus === 202;
    let detail = `HTTP ${httpStatus}`;
    try {
      const t = await res.text();
      if (t) detail += ` — ${t.slice(0, 200)}`;
    } catch {
      /* ignore */
    }
    return {
      ok,
      mode: "post",
      httpStatus,
      status: ok ? "submitted" : "validation_error",
      detail,
      keyMasked: maskKey(key),
    };
  } catch (e) {
    return {
      ok: false,
      mode: "post",
      httpStatus: 0,
      status: "network_error",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function submitSingleUrlGet(
  url: string,
  repoRoot: string,
): Promise<IndexNowResult> {
  return postIndexNow(repoRoot, [url]);
}

export async function submitUrlListPost(
  urls: string[],
  repoRoot: string,
): Promise<IndexNowResult> {
  return postIndexNow(repoRoot, urls);
}
