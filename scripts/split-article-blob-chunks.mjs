#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const fullPath = path.join(
  ROOT,
  "artifacts/automation-runs/auto-20260515-ws03/article-body.html",
);
const outDir = path.join(
  ROOT,
  "artifacts/automation-runs/auto-20260515-ws03/mcp-chunks",
);

const full = readFileSync(fullPath, "utf-8");
const max = Number(process.argv[2] ?? 1800);
const markers = ["</p>", "</nav>", "</div>", "</script>", "</figure>", "</tbody>"];

function findCut(s, limit) {
  const slice = s.slice(0, limit);
  let best = -1;
  for (const m of markers) {
    const idx = slice.lastIndexOf(m);
    if (idx !== -1) best = Math.max(best, idx + m.length);
  }
  return best;
}

const chunks = [];
let rest = full;
while (rest.length) {
  if (rest.length <= max) {
    chunks.push(rest);
    break;
  }
  const cut = findCut(rest, max);
  if (cut <= 0) {
    const hard = Math.min(max, rest.length);
    chunks.push(rest.slice(0, hard));
    rest = rest.slice(hard);
    continue;
  }
  chunks.push(rest.slice(0, cut));
  rest = rest.slice(cut);
}

mkdirSync(outDir, { recursive: true });
chunks.forEach((chunk, i) => {
  const isFirst = i === 0;
  const isLast = i === chunks.length - 1;
  const o = isFirst
    ? { reset: true, chunk, finalize: false }
    : { chunk, finalize: isLast };
  writeFileSync(
    path.join(outDir, `part-${String(i).padStart(2, "0")}.json`),
    JSON.stringify(o),
    "utf-8",
  );
  console.log(
    i,
    "chunkChars",
    chunk.length,
    "jsonBytes",
    Buffer.byteLength(JSON.stringify(o), "utf-8"),
    isLast ? "LAST" : "",
  );
});
console.log("chunks", chunks.length);
