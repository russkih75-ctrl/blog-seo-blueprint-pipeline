import { readdirSync } from "node:fs";
import { join } from "node:path";

export function findExtractedMarkdown(
  extractedDir: string,
  moduleId: number,
): string {
  const list = readdirSync(extractedDir).filter((f) => f.endsWith(".md"));
  const needle = `_${moduleId}_`;
  const hit = list.find((f) => f.includes(needle));
  if (!hit) {
    throw new Error(`Не найден .md для module id=${moduleId} в ${extractedDir}`);
  }
  return join(extractedDir, hit);
}
