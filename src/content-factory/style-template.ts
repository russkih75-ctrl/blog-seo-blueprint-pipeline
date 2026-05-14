import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { StyleTemplateConfig } from "./types.js";

export function loadStyleTemplate(repoRoot: string): StyleTemplateConfig {
  const p = path.join(repoRoot, "config", "default-article-style.json");
  if (!existsSync(p)) {
    return {
      version: 1,
      referenceUsage: "structure_style_length_only",
    };
  }
  return JSON.parse(readFileSync(p, "utf-8")) as StyleTemplateConfig;
}

export function styleTemplateToPromptChecklist(
  cfg: StyleTemplateConfig,
): string {
  const sections = (cfg.requiredSections ?? [])
    .map((s) => `- **${s.id}**: ${s.role}`)
    .join("\n");
  return [
    "## Шаблон стиля (default-article-style.json)",
    `- referenceUsage: \`${cfg.referenceUsage ?? "structure_style_length_only"}\``,
    cfg.averageLengthPolicy
      ? `- длина/плотность: ${cfg.averageLengthPolicy}`
      : "",
    cfg.notes ? `- заметки: ${cfg.notes}` : "",
    sections ? `\n### Обязательные секции\n${sections}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
