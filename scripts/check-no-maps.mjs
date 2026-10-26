// Falla el build si quedan source maps en el output público (CLAUDE.md §13).
// Corre como "postbuild", así también protege el build de Vercel (donde sí hay token de Sentry).
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = ".next/static";
const found = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith(".map")) found.push(p);
  }
}

try {
  walk(root);
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}

if (found.length > 0) {
  console.error(`Se encontraron ${found.length} source maps públicos en ${root}:`);
  found.slice(0, 10).forEach((f) => console.error(" - " + f));
  process.exit(1);
}
console.log("OK: sin source maps públicos en .next/static");
