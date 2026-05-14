import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { config as loadEnv } from "dotenv";

export interface IndexNowResult {
  ok: boolean;
  mode: "get" | "post";
  httpStatus: number;
  status: string;
  detail: string;
  actionRequired?: string;
  localKeyFileRelative?: string;
  expectedPublicUrlMasked?: string;
  keyMasked?: string;
}

function loadDotenv(repoRoot: string): void {
  loadEnv({ path: path.join(repoRoot, ".env") });
}

function maskKey(k: string): string {
  if (k.length <= 8) return "***";
  return `${k.slice(0, 4)}…${k.slice(-4)}`;
}

export function maskKeyFilenameInRelativePath(rel: string): string {
  return rel.replace(
    /([a-f0-9]{16,64})(\.txt)?$/iu,
    (_m, hex: string) => `${maskKey(hex)}$2`,
  );
}

export function prepareVerificationKeyArtifact(
  repoRoot: string,
  siteHost: string,
): {
  localKeyFileRelative: string;
  expectedPublicUrlMasked: string;
  keyMasked: string;
} {
  loadDotenv(repoRoot);
  const key = randomBytes(16).toString("hex");
  const fileName = `${key}.txt`;
  const idxDir = path.join(repoRoot, "artifacts", "indexnow");
  mkdirSync(idxDir, { recursive: true });
  const abs = path.join(idxDir, fileName);
  writeFileSync(abs, key, "utf-8");
  const host = new URL(siteHost.startsWith("http") ? siteHost : `https://${siteHost}`);
  const origin = `${host.protocol}//${host.host}`;
  return {
    localKeyFileRelative: path.relative(repoRoot, abs),
    expectedPublicUrlMasked: `${origin}/${maskKey(fileName)}`,
    keyMasked: maskKey(key),
  };
}

function readIndexNowKey(repoRoot: string): string | undefined {
  loadDotenv(repoRoot);
  const k = process.env.INDEXNOW_KEY?.trim();
  return k || undefined;
}

function hostFromUrl(urlStr: string): string | undefined {
  try {
    const u = new URL(urlStr);
    return u.host;
  } catch {
    return undefined;
  }
}

export async function submitSingleUrlGet(
  urlStr: string,
  repoRoot: string,
): Promise<IndexNowResult> {
  const key = readIndexNowKey(repoRoot);
  const host = hostFromUrl(urlStr);
  if (!key || !host) {
    return {
      ok: true,
      mode: "get",
      httpStatus: 0,
      status: "skipped_pass_through",
      detail:
        "INDEXNOW_KEY или хост из URL не настроены — публикация не блокируется.",
      actionRequired: "configure_indexnow_key_and_key_file_on_origin",
      keyMasked: key ? maskKey(key) : undefined,
    };
  }

  const endpoint = `https://api.indexnow.org/indexnow?url=${encodeURIComponent(urlStr)}&key=${encodeURIComponent(key)}&keyLocation=${encodeURIComponent(
    process.env.INDEXNOW_KEY_LOCATION?.trim() ||
      `https://${host}/${key}.txt`,
  )}`;

  try {
    const res = await fetch(endpoint, { method: "GET", redirect: "follow" });
    const text = await res.text().catch(() => "");
    const ok = res.status >= 200 && res.status < 300;
    return {
      ok,
      mode: "get",
      httpStatus: res.status,
      status: ok ? "submitted" : "validation_error",
      detail: text.slice(0, 500) || res.statusText,
      keyMasked: maskKey(key),
      actionRequired: ok ? undefined : "check_key_file_on_origin",
    };
  } catch (e) {
    return {
      ok: false,
      mode: "get",
      httpStatus: 0,
      status: "network_error",
      detail: e instanceof Error ? e.message : String(e),
      keyMasked: maskKey(key),
    };
  }
}

export async function submitUrlListPost(
  urls: string[],
  repoRoot: string,
): Promise<IndexNowResult> {
  const key = readIndexNowKey(repoRoot);
  const firstHost = urls[0] ? hostFromUrl(urls[0]!) : undefined;
  if (!key || !firstHost) {
    return {
      ok: true,
      mode: "post",
      httpStatus: 0,
      status: "skipped_pass_through",
      detail: "INDEXNOW_KEY или URL не заданы.",
      actionRequired: "configure_indexnow",
    };
  }

  const keyLocation =
    process.env.INDEXNOW_KEY_LOCATION?.trim() ||
    `https://${firstHost}/${key}.txt`;

  const body = {
    host: firstHost,
    key,
    keyLocation,
    urlList: urls,
  };

  try {
    const res = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });
    const text = await res.text().catch(() => "");
    const ok = res.status >= 200 && res.status < 300;
    return {
      ok,
      mode: "post",
      httpStatus: res.status,
      status: ok ? "submitted" : "validation_error",
      detail: text.slice(0, 500),
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
