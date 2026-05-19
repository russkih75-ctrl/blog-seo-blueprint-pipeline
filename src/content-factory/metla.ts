import type { PublishMode } from "./types.js";

export function getMetlaArtifactSummary(runId: string, publishMode: PublishMode) {
  const endpointConfigured = Boolean(process.env.METLA_WEBHOOK_URL?.trim());
  const requireMetla = process.env.METLA_REQUIRE?.trim() === "1";
  return {
    runId,
    publishMode,
    endpointConfigured,
    requireMetla,
    status: endpointConfigured ? "ready" : requireMetla ? "blocked" : "skipped_pass_through",
    actionRequired:
      !endpointConfigured && requireMetla
        ? "configure METLA_WEBHOOK_URL or unset METLA_REQUIRE"
        : undefined,
  };
}
