import { cp, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const source = resolve(root, "src");
const output = root;

await cp(resolve(source, "index.html"), resolve(output, "index.html"));
await cp(resolve(source, "styles.css"), resolve(output, "styles.css"));
const modules = (await readdir(resolve(source, "js")))
  .filter(file => file.endsWith(".js"))
  .sort();
await writeFile(
  resolve(output, "app.js"),
  (await Promise.all(modules.map(file => readFile(resolve(source, "js", file), "utf8")))).join("\n")
);

const html = await readFile(resolve(output, "index.html"), "utf8");
if (!html.includes('src="app.js"') || !html.includes('href="styles.css"')) {
  throw new Error("Source index.html must reference the extracted assets");
}

await writeFile(resolve(output, ".nojekyll"), "");
console.log("Built static site in the repository root.");
