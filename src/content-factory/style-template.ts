import { readFileSync } from "node:fs";
import path from "node:path";

export interface ArticleStyleTemplate {
  referenceUsage?: string;
  averageLengthPolicy?: string;
  notes?: string;
  requiredSections?: Array<{ id: string; role: string }>;
  tone?: Record<string, unknown>;
}

export function loadStyleTemplate(repoRoot: string): ArticleStyleTemplate {
  const filePath = path.join(repoRoot, "config", "default-article-style.json");
  return JSON.parse(readFileSync(filePath, "utf-8")) as ArticleStyleTemplate;
}

export function styleTemplateToPromptChecklist(
  template: ArticleStyleTemplate,
): string {
  const sections = template.requiredSections ?? [];
  const lines = [
    `Reference usage: ${template.referenceUsage ?? "structure_style_length_only"}`,
    template.averageLengthPolicy ? `Length policy: ${template.averageLengthPolicy}` : "",
    template.notes ? `Notes: ${template.notes}` : "",
    "Required sections:",
    ...sections.map((section) => `- ${section.id}: ${section.role}`),
  ].filter(Boolean);
  return lines.join("\n");
}
