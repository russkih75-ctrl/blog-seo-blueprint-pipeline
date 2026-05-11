/**
 * Одноразово вытаскивает тексты промптов из экспорта Make (blueprint .json).
 * Запись: все flow + вложенные routes[].flow рекурсивно.
 *
 * Usage: node scripts/extract-blueprint-prompts.mjs "C:\path\to\file.blueprint.json"
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const outDir = path.join(root, "prompts", "_extracted");
const [, , jsonArg] = process.argv;

if (!jsonArg) {
  console.error(
    'Usage: node scripts/extract-blueprint-prompts.mjs "C:\\path\\to\\blueprint.json"',
  );
  process.exit(1);
}

const srcPath = path.resolve(jsonArg);
const raw = JSON.parse(fs.readFileSync(srcPath, "utf-8"));

let counter = 0;

function safeName(moduleName, designerName, id) {
  const dn = designerName?.replace(/[/\\:?*"<>|]/g, "_") ?? "step";
  const mn = moduleName.replace(/[#:]/g, "_");
  return `${String(++counter).padStart(3, "0")}_${id}_${mn}_${dn}`.slice(0, 200);
}

function dumpText(baseName, chunks) {
  const body = chunks.filter(Boolean).join("\n\n---\n\n");
  fs.writeFileSync(path.join(outDir, `${baseName}.md`), body, "utf-8");
}

function visitFlow(flowArr, inheritedPath = []) {
  if (!Array.isArray(flowArr)) return;
  for (const node of flowArr) {
    const id = node.id;
    const mod = node.module ?? "unknown";
    const designer =
      node.metadata?.designer?.name ?? node.metadata?.designer?.label ?? "";
    const name = safeName(mod, designer || "unnamed", id);

    /** @type {string[]} */
    const parts = [];
    parts.push(`# Из blueprint: module \`${mod}\`, id=${id}`);
    parts.push(`designer: ${designer || "-"}`);
    if (inheritedPath.length)
      parts.push(`route_stack: ${inheritedPath.join(" > ")}`);

    const mapper = node.mapper ?? {};

    if (mapper.user_text) {
      parts.push("## mapper.user_text");
      parts.push(mapper.user_text.trimEnd());
    }
    if (mapper.developer_text) {
      parts.push("## mapper.developer_text");
      parts.push(mapper.developer_text.trimEnd());
    }
    if (mapper.prompt) {
      parts.push("## mapper.prompt");
      parts.push(mapper.prompt.trimEnd());
    }
    if (mod.startsWith("util:SetVariable") || mod.includes("SetVariables")) {
      const vars = mapper.variables ?? [];
      if (Array.isArray(vars) && vars.length) {
        parts.push("## SetVariables");
        for (const v of vars) {
          parts.push(`### ${v.name}`);
          parts.push(String(v.value ?? ""));
        }
      }
    }

    /** technical mappers **/
    const skipParts = [];
    for (const k of ["phrase1", "phrase2", "phrase3", "json_schema"]) {
      if (mapper[k] != null && !parts.some((s) => s.includes(mapper[k])))
        skipParts.push(`- **${k}**: ${String(mapper[k]).slice(0, 800)}`);
    }
    if (skipParts.length) {
      parts.push("## Технич. поля mapper");
      parts.push(skipParts.join("\n"));
    }

    fs.mkdirSync(outDir, { recursive: true });
    if (parts.length > 3)
      fs.writeFileSync(path.join(outDir, `${name}.md`), parts.join("\n\n"), "utf-8");

    if (node.routes?.length)
      for (let i = 0; i < node.routes.length; i++)
        visitFlow(node.routes[i].flow, [...inheritedPath, `routes[${i}]`]);
  }
}

fs.rmSync(outDir, { recursive: true, force: true });
visitFlow(raw.flow ?? []);
console.log(`Extracted Markdown prompt files → ${outDir}`);
console.log(`Total files written: counter=${counter}`);
