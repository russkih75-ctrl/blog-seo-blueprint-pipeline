import type { PublishMode } from "./types.js";

export function getMetlaArtifactSummary(
  runId: string,
  publishMode: PublishMode,
): Record<string, unknown> {
  const requireMetla = process.env.METLA_REQUIRE?.trim() === "1";
  return {
    runId,
    publishMode,
    status: requireMetla ? "endpoint_required_if_configured" : "pass_through",
    note:
      "Метла: webhook опционален; при METLA_REQUIRE=1 без endpoint публикация блокируется на стороне процесса.",
  };
}
