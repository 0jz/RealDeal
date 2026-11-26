// Checks the static export (run after `npm run build:pages`): every page is marked static and uses relative
// paths, every list/scan referenced by the index is exported, and every source ref in the exported engine
// output resolves in the exported source maps (so every number's drawer works on GitHub Pages).
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { check } from "./test-helpers.js";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "pages-site");
const J = (p) => JSON.parse(readFileSync(join(OUT, "data", p), "utf8"));
const failures = [];
if (!existsSync(join(OUT, "data", "index.json"))) { console.error("pages-site/ not built: run npm run build:pages"); process.exit(1); }
const idx = J("index.json"), meta = J("meta.json"), summary = J("summary.json"), global = J("sources/global.json");
const html = readdirSync(OUT).filter((f) => f.endsWith(".html"));
check(existsSync(join(OUT, ".nojekyll")), ".nojekyll present", failures);
check(html.every((f) => readFileSync(join(OUT, f), "utf8").includes('name="bfc-static"')), `all ${html.length} pages are marked static`, failures);
const abs = html.flatMap((f) => [...readFileSync(join(OUT, f), "utf8").matchAll(/(?:href|src)="\/(?!\/)[^"]*"/g)].map((m) => `${f}: ${m[0]}`));
check(abs.length === 0, `no root-absolute paths (works under /<repo>/)${abs.length ? ": " + abs.join(", ") : ""}`, failures);
check(meta.lists.every((l) => existsSync(join(OUT, "data", "runs", `${idx.lists[l.id]}.json`))), "every shopping list has an exported run", failures);
check(meta.products.every((p) => idx.scans[p.id] && existsSync(join(OUT, "data", "scans", `${idx.scans[p.id]}.json`))), `every product (${meta.products.length}) has an exported scan`, failures);
check(JSON.stringify(J(`runs/${summary.reference.runId}.json`).headline) === JSON.stringify(summary.reference.headline), "landing headline === exported reference run headline", failures);
const refs = (o, out = []) => { if (o && typeof o === "object") { if (Array.isArray(o.src) && "v" in o) out.push(...o.src); Object.values(o).forEach((v) => refs(v, out)); } return out; };
let missing = [];
const files = [["summary.json", summary.reference.runId], ...Object.values(idx.lists).flatMap((id) => [[`runs/${id}.json`, id], [`runs/${id}.next-page.json`, `${id}.next-page`]]), ...Object.values(idx.scans).flatMap((id) => [[`scans/${id}.json`, id]])];
let total = 0;
for (const [f, key] of files) {
  const run = existsSync(join(OUT, "data", "sources", `run-${key}.json`)) ? J(`sources/run-${key}.json`) : {};
  for (const r of new Set(refs(J(f)))) { total++; if (!global[r] && !run[r]) missing.push(`${f}: ${r}`); }
}
check(missing.length === 0, `all ${total} source refs in the exported output resolve${missing.length ? ": " + missing.slice(0, 5).join(", ") : ""}`, failures);
console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nAll checks passed");
process.exit(failures.length ? 1 : 0);
