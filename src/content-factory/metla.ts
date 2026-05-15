import type { PublishMode } from "./types.js";

export interface MetlaArtifactSummary {
  runId: string;
  publishMode: PublishMode;
  status: "pass_through" | "required_missing" | "n/a";
  detail: string;
}

export function getMetlaArtifactSummary(
  runId: string,
  publishMode: PublishMode,
): MetlaArtifactSummary {
  const require =
    String(process.env.METLA_REQUIRE ?? "").trim().toLowerCase() === "true";
  const endpoint =
    process.env.METLA_WEBHOOK_URL?.trim() ||
    process.env.METLA_ENDPOINT?.trim() ||
    "";
  if (require && !endpoint) {
    return {
      runId,
      publishMode,
      status: "required_missing",
      detail:
        "METLA_REQUIRE=true, но webhook не задан — публикация должна быть заблокирована на стадии publisher.",
    };
  }
  if (!endpoint) {
    return {
      runId,
      publishMode,
      status: "pass_through",
      detail: "Webhook Метлы не задан — pass-through исходных URL изображений.",
    };
  }
  return {
    runId,
    publishMode,
    status: "n/a",
    detail: "METLA endpoint задан — обработка на стороне агента/publisher.",
  };
}
