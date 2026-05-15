import type { PublishMode } from "./types.js";

export interface MetlaSummary {
  runId: string;
  mode: PublishMode;
  status: "pass_through" | "webhook_configured" | "blocked";
  detail: string;
}

export function getMetlaArtifactSummary(
  runId: string,
  publishMode: PublishMode,
): MetlaSummary {
  const endpoint =
    process.env.METLA_WEBHOOK_URL?.trim() || process.env.METLA_ENDPOINT?.trim();
  const require = process.env.METLA_REQUIRE === "true";
  if (require && !endpoint) {
    return {
      runId,
      mode: publishMode,
      status: "blocked",
      detail:
        "METLA_REQUIRE=true, но METLA_WEBHOOK_URL/METLA_ENDPOINT не задан — публикация должна быть остановлена до настройки Метлы.",
    };
  }
  return {
    runId,
    mode: publishMode,
    status: endpoint ? "webhook_configured" : "pass_through",
    detail: endpoint
      ? "Метла: endpoint задан, пост-обработка изображений возможна."
      : "Метла: endpoint не задан — pass-through исходных URL изображений.",
  };
}
