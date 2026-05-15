import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

function maskKey(key: string): string {
  if (key.length <= 6) return "***";
  return `${key.slice(0, 2)}…${key.slice(-2)}`;
}

/** Маскирует имя файла-ключа в относительном пути для логов */
export function maskKeyFilenameInRelativePath(rel: string): string {
  return rel.replace(/([a-f0-9]{16,128})\.txt$/iu, "***.txt");
}

function readIndexNowEnv(): {
  key: string;
  keyLocation: string;
  host: string;
} {
  const key =
    process.env.INDEXNOW_KEY?.trim() ||
    process.env.YANDEX_INDEXNOW_VERIFICATION_KEY?.trim() ||
    process.env.YANDEX_INDEXNOW_KEY?.trim() ||
    "";
  const keyLocation =
    process.env.INDEXNOW_KEY_LOCATION?.trim() ||
    process.env.YANDEX_INDEXNOW_KEY_LOCATION?.trim() ||
    "";
  const host =
    process.env.SITE_HOST?.trim() ||
    (keyLocation ? new URL(keyLocation).hostname : "") ||
    "";
  return { key, keyLocation, host };
}

export interface IndexNowSubmitResult {
  ok: boolean;
  mode: string;
  httpStatus: number;
  status: string;
  detail: string;
  actionRequired?: string;
  localKeyFileRelative?: string;
  expectedPublicUrlMasked?: string;
  keyMasked?: string;
}

async function postIndexNow(
  host: string,
  key: string,
  keyLocation: string,
  urlList: string[],
): Promise<IndexNowSubmitResult> {
  const body = { host, key, keyLocation, urlList };
  const res = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  const httpStatus = res.status;
  if (httpStatus === 200 || httpStatus === 202) {
    return {
      ok: true,
      mode: "post",
      httpStatus,
      status: "submitted",
      detail: "IndexNow принял пакет URL.",
      keyMasked: maskKey(key),
    };
  }
  if (httpStatus === 403) {
    return {
      ok: false,
      mode: "post",
      httpStatus,
      status: "forbidden",
      detail: await res.text().catch(() => ""),
      actionRequired: "verify_key_file_on_origin",
      keyMasked: maskKey(key),
    };
  }
  if (httpStatus === 422) {
    return {
      ok: false,
      mode: "post",
      httpStatus,
      status: "validation_error",
      detail: await res.text().catch(() => ""),
      actionRequired: "fix_indexnow_payload",
    };
  }
  return {
    ok: false,
    mode: "post",
    httpStatus,
    status: "error",
    detail: (await res.text().catch(() => "")).slice(0, 500),
    actionRequired: "check_indexnow_api",
  };
}

export async function submitSingleUrlGet(
  url: string,
  _repoRoot: string,
): Promise<IndexNowSubmitResult> {
  const { key, keyLocation, host } = readIndexNowEnv();
  if (!key || !keyLocation) {
    return {
      ok: true,
      mode: "skip",
      httpStatus: 0,
      status: "skipped_pass_through",
      detail: "INDEXNOW_KEY или INDEXNOW_KEY_LOCATION не заданы.",
      actionRequired: "configure_indexnow_env",
    };
  }
  try {
    const u = new URL(url);
    const h = host || u.hostname;
    return await postIndexNow(h, key, keyLocation, [url]);
  } catch (e) {
    return {
      ok: false,
      mode: "skip",
      httpStatus: 0,
      status: "validation_error",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function submitUrlListPost(
  urls: string[],
  _repoRoot: string,
): Promise<IndexNowSubmitResult> {
  const { key, keyLocation, host } = readIndexNowEnv();
  if (!key || !keyLocation) {
    return {
      ok: true,
      mode: "skip",
      httpStatus: 0,
      status: "skipped_pass_through",
      detail: "INDEXNOW_KEY или INDEXNOW_KEY_LOCATION не заданы.",
      actionRequired: "configure_indexnow_env",
    };
  }
  let h = host;
  if (!h && urls[0]) {
    try {
      h = new URL(urls[0]!).hostname;
    } catch {
      h = "";
    }
  }
  if (!h) {
    return {
      ok: false,
      mode: "post",
      httpStatus: 0,
      status: "validation_error",
      detail: "Не удалось определить host для IndexNow.",
      actionRequired: "set_SITE_HOST",
    };
  }
  return postIndexNow(h, key, keyLocation, urls);
}

export function prepareVerificationKeyArtifact(
  repoRoot: string,
  siteHost: string,
): {
  localKeyFileRelative: string;
  expectedPublicUrlMasked: string;
  keyMasked: string;
} {
  const key = randomBytes(16).toString("hex");
  const dir = path.join(repoRoot, "artifacts", "indexnow");
  mkdirSync(dir, { recursive: true });
  const fname = `${key}.txt`;
  const full = path.join(dir, fname);
  writeFileSync(full, key, "utf-8");
  let origin: string;
  try {
    origin = new URL(siteHost.startsWith("http") ? siteHost : `https://${siteHost}`)
      .origin;
  } catch {
    origin = "https://example.com";
  }
  const expectedPublicUrl = `${origin}/${fname}`;
  return {
    localKeyFileRelative: path.relative(repoRoot, full),
    expectedPublicUrlMasked: expectedPublicUrl.replace(
      /^https:\/\/[^/]+/u,
      "https://***",
    ),
    keyMasked: maskKey(key),
  };
}
