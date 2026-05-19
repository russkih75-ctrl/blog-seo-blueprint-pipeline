import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface IndexNowResult {
  ok: boolean;
  mode: "get" | "post" | "prepare";
  httpStatus: number;
  status:
    | "submitted"
    | "accepted_pending_verification"
    | "needs_key_file_upload"
    | "skipped_pass_through"
    | "forbidden"
    | "validation_error"
    | "rate_limited"
    | "error";
  detail?: string;
  actionRequired?: string;
  localKeyFileRelative?: string;
  expectedPublicUrlMasked?: string;
  keyMasked?: string;
}

function getSiteHost(): string {
  return process.env.SITE_HOST?.trim() || "https://wordprais.ru";
}

function getIndexNowKey(): string | undefined {
  return process.env.INDEXNOW_KEY?.trim() || undefined;
}

function maskKey(key?: string): string | undefined {
  if (!key) return undefined;
  if (key.length <= 8) return "***";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

function keyLocation(siteHost: string, key: string): string {
  const explicit = process.env.INDEXNOW_KEY_LOCATION?.trim();
  if (explicit) return explicit;
  return `${siteHost.replace(/\/+$/u, "")}/${encodeURIComponent(key)}.txt`;
}

function statusFromHttp(httpStatus: number): IndexNowResult["status"] {
  if (httpStatus === 200 || httpStatus === 202) return "submitted";
  if (httpStatus === 202) return "accepted_pending_verification";
  if (httpStatus === 403) return "forbidden";
  if (httpStatus === 422) return "validation_error";
  if (httpStatus === 429) return "rate_limited";
  return "error";
}

export function maskKeyFilenameInRelativePath(relativePath: string): string {
  return relativePath.replace(/[^/\\]+\.txt$/u, "***.txt");
}

export function prepareVerificationKeyArtifact(repoRoot: string, host: string) {
  const key = getIndexNowKey();
  if (!key) {
    throw new Error("INDEXNOW_KEY is not configured");
  }
  const indexNowDir = path.join(repoRoot, "artifacts", "indexnow");
  mkdirSync(indexNowDir, { recursive: true });
  const localKeyFileRelative = path.join("artifacts", "indexnow", `${key}.txt`);
  writeFileSync(path.join(repoRoot, localKeyFileRelative), key, "utf-8");
  return {
    localKeyFileRelative,
    expectedPublicUrlMasked: `${host.replace(/\/+$/u, "")}/${maskKey(key)}.txt`,
    keyMasked: maskKey(key),
  };
}

export async function submitSingleUrlGet(
  url: string,
  repoRoot: string,
): Promise<IndexNowResult> {
  const key = getIndexNowKey();
  if (!key) {
    return {
      ok: false,
      mode: "get",
      httpStatus: 0,
      status: "needs_key_file_upload",
      detail: "INDEXNOW_KEY is not configured",
      actionRequired: "set INDEXNOW_KEY and upload the public verification file",
    };
  }

  const siteHost = getSiteHost();
  const endpoint = new URL("https://yandex.com/indexnow");
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("key", key);
  endpoint.searchParams.set("keyLocation", keyLocation(siteHost, key));

  try {
    const response = await fetch(endpoint);
    const status = statusFromHttp(response.status);
    return {
      ok: response.ok,
      mode: "get",
      httpStatus: response.status,
      status,
      detail: response.statusText,
      ...prepareVerificationKeyArtifact(repoRoot, siteHost),
    };
  } catch (error) {
    return {
      ok: false,
      mode: "get",
      httpStatus: 0,
      status: "error",
      detail: error instanceof Error ? error.message : String(error),
      keyMasked: maskKey(key),
    };
  }
}

export async function submitUrlListPost(
  urls: string[],
  repoRoot: string,
): Promise<IndexNowResult> {
  const key = getIndexNowKey();
  if (!key) {
    return {
      ok: false,
      mode: "post",
      httpStatus: 0,
      status: "needs_key_file_upload",
      detail: "INDEXNOW_KEY is not configured",
      actionRequired: "set INDEXNOW_KEY and upload the public verification file",
    };
  }

  const siteHost = getSiteHost();
  try {
    const response = await fetch("https://yandex.com/indexnow", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        host: new URL(siteHost).host,
        key,
        keyLocation: keyLocation(siteHost, key),
        urlList: urls,
      }),
    });
    return {
      ok: response.ok,
      mode: "post",
      httpStatus: response.status,
      status: statusFromHttp(response.status),
      detail: response.statusText,
      ...prepareVerificationKeyArtifact(repoRoot, siteHost),
    };
  } catch (error) {
    return {
      ok: false,
      mode: "post",
      httpStatus: 0,
      status: "error",
      detail: error instanceof Error ? error.message : String(error),
      keyMasked: maskKey(key),
    };
  }
}
