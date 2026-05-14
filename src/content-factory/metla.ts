import type { PublishMode } from "./types.js";

export interface MetlaArtifactSummary {
  runId: string;
  mode: PublishMode;
  status: "pass_through" | "required_missing" | "pending";
  detail: string;
}

/**
 * Метла (cleanerai): без webhook — pass-through; METLA_REQUIRE=true без endpoint — блок publish.
 */
export function getMetlaArtifactSummary(
  runId: string,
  publishMode: PublishMode,
): MetlaArtifactSummary {
  const url =
    process.env.METLA_WEBHOOK_URL?.trim() ||
    process.env.METLA_ENDPOINT?.trim() ||
    "";
  const requireMetla = process.env.METLA_REQUIRE === "true";

  if (!url && requireMetla && publishMode === "publish") {
    return {
      runId,
      mode: publishMode,
      status: "required_missing",
      detail:
        "METLA_REQUIRE=true, но METLA_WEBHOOK_URL / METLA_ENDPOINT не заданы.",
    };
  }
  if (!url) {
    return {
      runId,
      mode: publishMode,
      status: "pass_through",
      detail: "Webhook Метлы не настроен — изображения без пост-очистки.",
    };
  }
  return {
    runId,
    mode: publishMode,
    status: "pending",
    detail: "Webhook задан; очистку выполняет отдельный этап при наличии URL.",
  };
}
