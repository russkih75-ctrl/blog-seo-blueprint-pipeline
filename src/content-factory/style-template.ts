import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { DefaultArticleStyleConfig } from "./types.js";

export function loadStyleTemplate(repoRoot: string): DefaultArticleStyleConfig {
  const p = path.join(repoRoot, "config", "default-article-style.json");
  if (!existsSync(p)) {
    return {
      version: 1,
      referenceUsage: "structure_style_length_only",
      requiredSections: [],
    };
  }
  return JSON.parse(readFileSync(p, "utf-8")) as DefaultArticleStyleConfig;
}

export function styleTemplateToPromptChecklist(
  cfg: DefaultArticleStyleConfig,
): string {
  const lines: string[] = [];
  lines.push(`Политика референса: **${cfg.referenceUsage ?? "structure_style_length_only"}**`);
  if (cfg.notes) lines.push(cfg.notes);
  const secs = cfg.requiredSections ?? [];
  for (const s of secs) {
    lines.push(`- **${s.id}**: ${s.role}`);
  }
  if (cfg.tone?.voice) lines.push(`Тон: ${cfg.tone.voice}`);
  return lines.join("\n\n");
}
