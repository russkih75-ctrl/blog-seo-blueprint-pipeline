import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface StyleTemplate {
  version: number;
  referenceUsage?: string;
  referenceSites?: string[];
  requiredSections?: Array<{ id: string; role: string }>;
  tone?: Record<string, unknown>;
  notes?: string;
  [k: string]: unknown;
}

export function loadStyleTemplate(repoRoot: string): StyleTemplate {
  const p = path.join(repoRoot, "config", "default-article-style.json");
  if (!existsSync(p))
    throw new Error(`Отсутствует ${path.relative(repoRoot, p)}`);
  return JSON.parse(readFileSync(p, "utf-8")) as StyleTemplate;
}

export function styleTemplateToPromptChecklist(cfg: StyleTemplate): string {
  const lines: string[] = [];
  lines.push(`- referenceUsage: ${String(cfg.referenceUsage ?? "n/a")}`);
  if (cfg.notes) lines.push(`- notes: ${cfg.notes}`);
  if (Array.isArray(cfg.requiredSections)) {
    for (const s of cfg.requiredSections)
      lines.push(`- **${s.id}**: ${s.role}`);
  }
  if (cfg.tone && typeof cfg.tone === "object") {
    lines.push(`- tone: ${JSON.stringify(cfg.tone)}`);
  }
  return lines.join("\n");
}
