import type { PublishMode } from "./types.js";

export interface MetlaArtifactSummary {
  runId: string;
  publishMode: PublishMode;
  mode: "pass_through" | "webhook" | "blocked";
  detail: string;
}

/**
 * Метла (cleanerai): без webhook — pass-through; METLA_REQUIRE=true блокирует publish.
 */
export function getMetlaArtifactSummary(
  runId: string,
  publishMode: PublishMode,
): MetlaArtifactSummary {
  const url =
    process.env.METLA_WEBHOOK_URL?.trim() || process.env.METLA_ENDPOINT?.trim();
  const requireMetla = /^true$/iu.test(process.env.METLA_REQUIRE?.trim() ?? "");

  if (!url) {
    if (requireMetla && publishMode === "publish") {
      return {
        runId,
        publishMode,
        mode: "blocked",
        detail:
          "METLA_REQUIRE=true, но METLA_WEBHOOK_URL / METLA_ENDPOINT не заданы — публикация должна быть заблокирована на стадии publisher.",
      };
    }
    return {
      runId,
      publishMode,
      mode: "pass_through",
      detail: "Webhook Метлы не настроен — изображения без пост-очистки.",
    };
  }

  return {
    runId,
    publishMode,
    mode: "webhook",
    detail: "Настроен METLA webhook; вызов выполняется на стадии медиа/publisher агентом.",
  };
}
