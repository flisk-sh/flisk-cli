import { readFileSync, writeFileSync } from "node:fs";
const f = "src/utils/demo-stage/__tests__/frame.test.ts";
const lines = readFileSync(f, "utf8").split("\n");
const rows = lines.filter((l) => l.includes("Questions? Join us on Discord") && l.trim().startsWith('"'));
const width = rows[0].match(/^(\s*)" (.*)",$/);
const w = width ? width[2].length : 78;
let n = 0;
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^(\s*)" Like it\? A star helps: github\.com\/flisk-sh\/flisk-cli\s*",$/);
  if (m) { const body = lines[i].match(/" (.*)",$/)[1].replace(/\s+$/, ""); lines[i] = `${m[1]}" ${body.padEnd(w)}",`; n++; }
}
writeFileSync(f, lines.join("\n"));
console.log("rows", n, "width", w);
