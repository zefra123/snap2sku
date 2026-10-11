import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../../..");
const sourcePath = resolve(repositoryRoot, "apps/web/app/assets/css/tokens.css");
const outputPath = resolve(repositoryRoot, "apps/mp/src/styles/tokens.wxss");
const source = await readFile(sourcePath, "utf8");
const rootRule = source.match(/:root\s*\{[^}]*\}/)?.[0];

if (!rootRule) {
  console.error(`Could not find a :root rule in ${sourcePath}`);
  process.exit(1);
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, rootRule.replace(/^:root/, "page"), "utf8");
