import { randomBytes } from "node:crypto";
import {
  mkdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const INDEXNOW_ENDPOINT = "https://api.indexnow.org/IndexNow";

function readKey(): string {
  return (
    process.env.INDEXNOW_KEY?.trim() ||
    process.env.YANDEX_INDEXNOW_VERIFICATION_KEY?.trim() ||
    process.env.YANDEX_INDEXNOW_KEY?.trim() ||
    ""
  );
}

function readKeyLocation(): string {
  return (
    process.env.INDEXNOW_KEY_LOCATION?.trim() ||
    process.env.YANDEX_INDEXNOW_KEY_LOCATION?.trim() ||
    ""
  );
}

function maskKey(key: string): string {
  if (key.length <= 6) return "***";
  return `${key.slice(0, 3)}…${key.slice(-2)}`;
}

/** Убрать имя ключа из относительного пути для логов */
export function maskKeyFilenameInRelativePath(rel: string): string {
  return rel.replace(/[a-f0-9]{16,}/gi, (m) => maskKey(m));
}

export interface IndexNowSubmitResult {
  ok: boolean;
  mode: "get" | "post" | "skipped";
  httpStatus: number;
  status: string;
  detail?: string;
  actionRequired?: string;
  localKeyFileRelative?: string;
  expectedPublicUrlMasked?: string;
  keyMasked?: string;
}

function parseHostFromUrl(urlStr: string): string | undefined {
  try {
    return new URL(urlStr).hostname;
  } catch {
    return undefined;
  }
}

export function prepareVerificationKeyArtifact(
  repoRoot: string,
  hostInput: string,
): {
  key: string;
  localKeyFileRelative: string;
  expectedPublicUrlMasked: string;
  keyMasked: string;
} {
  const key = randomBytes(16).toString("hex");
  const idxDir = path.join(repoRoot, "artifacts", "indexnow");
  mkdirSync(idxDir, { recursive: true });
  const fileName = `${key}.txt`;
  const abs = path.join(idxDir, fileName);
  writeFileSync(abs, key, "utf-8");
  const localKeyFileRelative = path.relative(repoRoot, abs).replace(/\\/g, "/");
  let origin = hostInput.trim();
  if (!/^https?:\/\//iu.test(origin)) origin = `https://${origin}`;
  let maskedOrigin: string;
  try {
    const u = new URL(origin);
    maskedOrigin = `${u.protocol}//${u.hostname}/`;
  } catch {
    maskedOrigin = "https://<host>/";
  }
  return {
    key,
    localKeyFileRelative,
    expectedPublicUrlMasked: `${maskedOrigin}${maskKey(key)}.txt`,
    keyMasked: maskKey(key),
  };
}

async function postIndexNow(
  host: string,
  key: string,
  keyLocation: string,
  urlList: string[],
): Promise<{ httpStatus: number; text: string }> {
  const body = JSON.stringify({ host, key, keyLocation, urlList });
  const res = await fetch(INDEXNOW_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body,
  });
  const text = await res.text().catch(() => "");
  return { httpStatus: res.status, text };
}

function buildResult(
  partial: Omit<IndexNowSubmitResult, "ok"> & { httpStatus: number },
): IndexNowSubmitResult {
  const ok =
    partial.httpStatus === 200 ||
    partial.httpStatus === 202 ||
    partial.status === "skipped_pass_through" ||
    partial.status === "needs_key_file_upload";
  return { ok, ...partial };
}

export async function submitSingleUrlGet(
  pageUrl: string,
  _repoRoot: string,
): Promise<IndexNowSubmitResult> {
  const key = readKey();
  const keyLocation = readKeyLocation();
  const keyMasked = key ? maskKey(key) : "";

  if (!key || !keyLocation) {
    return buildResult({
      mode: "get",
      httpStatus: 0,
      status: "skipped_pass_through",
      detail: "INDEXNOW_KEY или INDEXNOW_KEY_LOCATION не заданы",
      actionRequired: "configure_indexnow_key_and_key_location",
      keyMasked: keyMasked || undefined,
    });
  }

  const host = parseHostFromUrl(pageUrl) ?? parseHostFromUrl(keyLocation);
  if (!host) {
    return buildResult({
      mode: "post",
      httpStatus: 0,
      status: "validation_error",
      detail: "Не удалось определить host из URL",
      actionRequired: "fix_page_url_or_key_location",
      keyMasked,
    });
  }

  const { httpStatus, text } = await postIndexNow(host, key, keyLocation, [
    pageUrl,
  ]);
  const short = text.slice(0, 500);

  if (httpStatus === 200 || httpStatus === 202) {
    return buildResult({
      mode: "post",
      httpStatus,
      status: "submitted",
      detail: short || "accepted",
      keyMasked,
      expectedPublicUrlMasked: maskKeyFilenameInRelativePath(keyLocation),
    });
  }

  if (httpStatus === 403) {
    return buildResult({
      mode: "post",
      httpStatus,
      status: "forbidden",
      detail: short,
      actionRequired: "verify_key_file_on_origin",
      keyMasked,
    });
  }

  return buildResult({
    mode: "post",
    httpStatus,
    status: httpStatus === 429 ? "rate_limited" : "validation_error",
    detail: short,
    actionRequired: "review_indexnow_response",
    keyMasked,
  });
}

export async function submitUrlListPost(
  urls: string[],
  _repoRoot: string,
): Promise<IndexNowSubmitResult> {
  if (!urls.length) {
    return buildResult({
      mode: "post",
      httpStatus: 0,
      status: "validation_error",
      detail: "Пустой список URL",
    });
  }
  return submitSingleUrlGet(urls[0]!, _repoRoot);
}
