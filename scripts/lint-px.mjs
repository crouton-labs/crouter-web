#!/usr/bin/env node
// Regression ban for the px-soup that made the UI unreadable (see ux-rebuild-plan).
// Fails (exit 1) on any of:
//   - arbitrary Tailwind font size:     text-[14px]   -> use text-sm / the ramp
//   - arbitrary Tailwind spacing:       p-[7px] gap-[12px] mt-[10px] ...
//   - arbitrary Tailwind sizing:         h-[38px] size-[34px] min-w-[200px] ...
//                                        (so control heights can't drift back below 32/36px)
//   - inline font sizing in JSX:        style={{ fontSize: ... }}
//   - raw CSS font-size below the 12px floor
// Scope: src/client (**/*.{ts,tsx,css}). Wired to `npm run lint`.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "client");
const SPACING = "p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|space-x|space-y";
const SIZING = "h|w|size|min-h|min-w|max-h|max-w";

const RULES = [
  { id: "no-arbitrary-text-px", exts: [".ts", ".tsx"], re: /\btext-\[\s*\d+(?:\.\d+)?px\s*\]/g,
    hint: "use the type ramp (text-xs/text-sm/...) — never text-[Npx]" },
  { id: "no-arbitrary-spacing-px", exts: [".ts", ".tsx"], re: new RegExp(`\\b(?:${SPACING})-\\[\\s*\\d+(?:\\.\\d+)?px\\s*\\]`, "g"),
    hint: "snap to the 4px grid (p-2/p-3/gap-2) — never *-[Npx]" },
  { id: "no-arbitrary-size-px", exts: [".ts", ".tsx"], re: new RegExp(`\\b(?:${SIZING})-\\[\\s*\\d+(?:\\.\\d+)?px\\s*\\]`, "g"),
    hint: "use h-9/h-8/size-9 (≥32px controls) — never h-[Npx]/size-[Npx]" },
  { id: "no-inline-fontsize", exts: [".ts", ".tsx"], re: /fontSize\s*:/g,
    hint: "no inline style fontSize — use a className from the ramp" },
  { id: "no-sub-12-font", exts: [".css"], re: /font-size:\s*(\d+(?:\.\d+)?)px/g,
    test: (m) => parseFloat(m[1]) < 12, hint: "12px is the floor — raise it" },
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) { if (name !== "node_modules") walk(p, out); }
    else out.push(p);
  }
  return out;
}

const violations = [];
for (const file of walk(ROOT)) {
  const ext = extname(file);
  const rules = RULES.filter((r) => r.exts.includes(ext));
  if (!rules.length) continue;
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  for (const rule of rules) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(src))) {
      if (rule.test && !rule.test(m)) continue;
      const line = src.slice(0, m.index).split("\n").length;
      violations.push({ file: file.replace(ROOT + "/", ""), line, rule: rule.id, text: m[0].trim(), hint: rule.hint, src: lines[line - 1].trim() });
    }
  }
}

if (violations.length) {
  console.error(`\u2717 px-ban: ${violations.length} violation(s)\n`);
  for (const v of violations) {
    console.error(`  src/client/${v.file}:${v.line}  [${v.rule}]  ${v.text}`);
    console.error(`      ${v.hint}`);
  }
  console.error("");
  process.exit(1);
}
console.log("\u2713 px-ban: clean");
