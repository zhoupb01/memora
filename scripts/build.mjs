#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "--check")) {
  console.error("Usage: node scripts/build.mjs [--check]");
  process.exit(2);
}
const check = args[0] === "--check";
const repo = new URL("../", import.meta.url);
const adapters = ["pi-memory", "dsh-memory", "agy-memory"];

async function bundleEntry(entryRel) {
  const result = await esbuild.build({
    entryPoints: [fileURLToPath(new URL(entryRel, repo))],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    packages: "bundle",
    banner: {
      js: 'import { createRequire as __memoraReq } from "node:module"; const require = __memoraReq(import.meta.url);',
    },
    write: false,
    logLevel: "silent",
  });
  return Buffer.from(result.outputFiles[0].contents);
}

const dreamCliShim = Buffer.from(
  '#!/usr/bin/env node\nimport { runDreamCLI } from "./index.js";\n\nprocess.exitCode = runDreamCLI();\n',
);

const [coreBundle, contractBytes, dreamGuideBytes, licenseBytes] = await Promise.all([
  bundleEntry("packages/core/src/index.js"),
  readFile(new URL("CONTRACT.md", repo)),
  readFile(new URL("DREAM.md", repo)),
  readFile(new URL("LICENSE", repo)),
]);

const outputs = [];
for (const adapter of adapters) {
  outputs.push([`packages/${adapter}/lib/core/index.js`, coreBundle]);
  outputs.push([`packages/${adapter}/lib/core/dream-cli.js`, dreamCliShim]);
  outputs.push([`packages/${adapter}/lib/core/CONTRACT.md`, contractBytes]);
  outputs.push([`packages/${adapter}/lib/core/DREAM.md`, dreamGuideBytes]);
  outputs.push([`packages/${adapter}/LICENSE`, licenseBytes]);
}

let changed = 0;
for (const [targetPath, content] of outputs) {
  const target = new URL(targetPath, repo);
  let current;
  try {
    current = await readFile(target);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (current?.equals(content)) continue;
  changed++;
  if (check) {
    console.error(`Build output is stale: ${targetPath}`);
  } else {
    await mkdir(new URL("./", target), { recursive: true });
    await writeFile(target, content);
    console.log(`Built ${targetPath}`);
  }
}

if (check && changed) {
  console.error("Run npm run build from the Memora repository root.");
  process.exit(1);
}

if (check) {
  const agyCheck = spawnSync("agy", ["plugin", "validate", "--strict", fileURLToPath(new URL("packages/agy-memory", repo))], {
    encoding: "utf8",
  });
  if (!agyCheck.error && agyCheck.status !== 0) {
    console.error(agyCheck.stdout || agyCheck.stderr);
    process.exit(1);
  }
}

if (!changed) {
  console.log("All three adapters contain the current shared core and prompts.");
}
