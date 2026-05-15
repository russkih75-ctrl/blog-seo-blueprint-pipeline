import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface StyleTemplate {
  version: number;
  referenceUsage?: string;
  referenceSites?: unknown[];
  averageLengthPolicy?: string;
  notes?: string;
  requiredSections?: Array<{ id: string; role: string }>;
  tone?: { year?: number; voice?: string; avoid?: string[] };
}

export function loadStyleTemplate(repoRoot: string): StyleTemplate {
  const p = path.join(repoRoot, "config", "default-article-style.json");
  if (!existsSync(p)) {
    return {
      version: 1,
      referenceUsage: "structure_style_length_only",
    };
  }
  return JSON.parse(readFileSync(p, "utf-8")) as StyleTemplate;
}

export function styleTemplateToPromptChecklist(cfg: StyleTemplate): string {
  const lines: string[] = [];
  lines.push(`- referenceUsage: **${cfg.referenceUsage ?? "structure_style_length_only"}**`);
  if (cfg.averageLengthPolicy) lines.push(`- длина/плотность: ${cfg.averageLengthPolicy}`);
  if (cfg.notes) lines.push(`- примечание: ${cfg.notes}`);
  if (cfg.tone?.voice) lines.push(`- тон: ${cfg.tone.voice}`);
  if (cfg.requiredSections?.length) {
    lines.push("### Обязательные секции");
    for (const s of cfg.requiredSections) {
      lines.push(`- **${s.id}**: ${s.role}`);
    }
  }
  return lines.join("\n");
}
