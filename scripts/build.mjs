#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "--check")) {
  console.error("Usage: node scripts/build.mjs [--check]");
  process.exit(2);
}
const check = args[0] === "--check";
const repo = new URL("../", import.meta.url);
const coreFiles = ["index.js", "GUIDE.md", "tidy.md"];
const outputs = [];
for (const adapter of ["pi-memory", "dsh-memory"]) {
  for (const name of coreFiles) {
    outputs.push([`packages/core/${name}`, `packages/${adapter}/lib/core/${name}`]);
  }
  outputs.push(["LICENSE", `packages/${adapter}/LICENSE`]);
}

// Keep the prompt files used by the pre-core DSH module generation readable
// until that running Host restarts. New packages only read lib/core resources.
for (const name of ["GUIDE.md", "tidy.md"]) {
  outputs.push([`packages/core/${name}`, `packages/dsh-memory/${name}`]);
}

let changed = 0;
for (const [sourcePath, targetPath] of outputs) {
  const source = await readFile(new URL(sourcePath, repo));
  const target = new URL(targetPath, repo);
  let current;
  try {
    current = await readFile(target);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (current?.equals(source)) continue;
  changed++;
  if (check) {
    console.error(`Build output is stale: ${targetPath}`);
  } else {
    await mkdir(new URL("./", target), { recursive: true });
    await writeFile(target, source);
    console.log(`Built ${targetPath}`);
  }
}
if (check && changed) {
  console.error("Run npm run build from the Memora repository root.");
  process.exitCode = 1;
} else if (!changed) {
  console.log("Both adapters contain the current shared core and prompts.");
}
