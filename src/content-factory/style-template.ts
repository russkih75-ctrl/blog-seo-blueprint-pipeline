import { readFileSync } from "node:fs";
import path from "node:path";

export interface StyleTemplate {
  version?: number;
  referenceUsage?: string;
  requiredSections?: Array<{ id: string; role: string }>;
  notes?: string;
  tone?: { year?: number; voice?: string; avoid?: string[] };
}

export function loadStyleTemplate(repoRoot: string): StyleTemplate {
  const p = path.join(repoRoot, "config", "default-article-style.json");
  return JSON.parse(readFileSync(p, "utf-8")) as StyleTemplate;
}

export function styleTemplateToPromptChecklist(cfg: StyleTemplate): string {
  const parts: string[] = [];
  if (cfg.referenceUsage)
    parts.push(`Политика референса: **${cfg.referenceUsage}**.`);
  if (cfg.tone?.voice) parts.push(`Тон: ${cfg.tone.voice}`);
  if (Array.isArray(cfg.requiredSections)) {
    parts.push("Обязательные секции:");
    for (const s of cfg.requiredSections)
      parts.push(`- **${s.id}**: ${s.role}`);
  }
  if (cfg.notes) parts.push(cfg.notes);
  return parts.join("\n\n");
}
