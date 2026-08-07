import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const source = resolve(root, "src");
const jsDir = resolve(source, "js");
const app = await readFile(resolve(source, "app.js"), "utf8");
const sections = app.split(/(?=\/\* ═+ [^*]+ ═+ \*\/)/g).filter(section => section.trim());

await rm(jsDir, { recursive: true, force: true });
await mkdir(jsDir, { recursive: true });

for (let index = 0; index < sections.length; index += 1) {
  const section = sections[index];
  const heading = section.match(/\/\* ═+ ([^*]+?) ═+ \*\//)?.[1] || "bootstrap";
  const name = heading.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const filename = `${String(index + 1).padStart(2, "0")}-${name || "section"}.js`;
  await writeFile(resolve(jsDir, filename), section.trim() + "\n");
}

console.log(`Split app.js into ${sections.length} focused JavaScript modules.`);
