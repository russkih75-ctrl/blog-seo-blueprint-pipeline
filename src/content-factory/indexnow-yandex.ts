import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface IndexNowSubmitResult {
  ok: boolean;
  mode: "get" | "post";
  httpStatus: number;
  status: string;
  detail?: string;
  actionRequired?: string;
  localKeyFileRelative?: string;
  expectedPublicUrlMasked?: string;
  keyMasked?: string;
}

function pickKey(): string {
  return (
    process.env.INDEXNOW_KEY?.trim() ||
    process.env.YANDEX_INDEXNOW_VERIFICATION_KEY?.trim() ||
    process.env.YANDEX_INDEXNOW_KEY?.trim() ||
    ""
  );
}

function pickKeyLocation(): string {
  return (
    process.env.INDEXNOW_KEY_LOCATION?.trim() ||
    process.env.YANDEX_INDEXNOW_KEY_LOCATION?.trim() ||
    ""
  );
}

function maskKey(k: string): string {
  if (k.length <= 6) return "***";
  return `${k.slice(0, 4)}***${k.slice(-2)}`;
}

export function maskKeyFilenameInRelativePath(rel: string): string {
  const segs = rel.split(/[/\\]/u);
  const last = segs[segs.length - 1] ?? "";
  if (/\.txt$/iu.test(last)) segs[segs.length - 1] = "<verification-key>.txt";
  return segs.join("/");
}

function hostnameOf(urlStr: string): string {
  const u = new URL(urlStr);
  return u.hostname;
}

export function prepareVerificationKeyArtifact(
  repoRoot: string,
  hostInput: string,
): {
  localKeyFileRelative: string;
  expectedPublicUrlMasked: string;
  keyMasked: string;
  key: string;
} {
  const hostUrl = hostInput.startsWith("http") ? hostInput : `https://${hostInput}`;
  const { hostname } = new URL(hostUrl);
  const key = randomBytes(16).toString("hex");
  const idxDir = path.join(repoRoot, "artifacts", "indexnow");
  mkdirSync(idxDir, { recursive: true });
  const fname = `${key}.txt`;
  const abs = path.join(idxDir, fname);
  writeFileSync(abs, key, "utf-8");
  const localKeyFileRelative = path.relative(repoRoot, abs).replace(/\\/gu, "/");
  return {
    localKeyFileRelative,
    expectedPublicUrlMasked: `https://${hostname}/<verification-key>.txt`,
    keyMasked: maskKey(key),
    key,
  };
}

async function postIndexNow(urlList: string[], repoRoot: string): Promise<IndexNowSubmitResult> {
  const key = pickKey();
  const keyLocation = pickKeyLocation();
  if (!key || !keyLocation) {
    return {
      ok: false,
      mode: "post",
      httpStatus: 0,
      status: "needs_key_file_upload",
      detail:
        "Задайте INDEXNOW_KEY и INDEXNOW_KEY_LOCATION (публичный verification key и HTTPS URL файла на origin).",
      actionRequired: "configure_indexnow_key_and_key_file",
      keyMasked: key ? maskKey(key) : undefined,
    };
  }

  const host = hostnameOf(urlList[0]!);
  const res = await fetch("https://api.indexnow.org/IndexNow", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host, key, keyLocation, urlList }),
  });
  const httpStatus = res.status;
  const ok = httpStatus === 200 || httpStatus === 202;
  let detail = await res.text().catch(() => "");
  if (detail.length > 500) detail = detail.slice(0, 500);
  const status = ok ? "submitted" : httpStatus === 403 ? "forbidden" : "validation_error";
  return {
    ok,
    mode: "post",
    httpStatus,
    status,
    detail: detail || res.statusText,
    actionRequired: ok ? undefined : "check_indexnow_key_file_on_origin",
    keyMasked: maskKey(key),
    expectedPublicUrlMasked: keyLocation.replace(/\/[^/]+$/u, "/<key>.txt"),
  };
}

export async function submitSingleUrlGet(
  url: string,
  repoRoot: string,
): Promise<IndexNowSubmitResult> {
  return postIndexNow([url], repoRoot);
}

export async function submitUrlListPost(
  urls: string[],
  repoRoot: string,
): Promise<IndexNowSubmitResult> {
  return postIndexNow(urls, repoRoot);
}
