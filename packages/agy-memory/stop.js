import { readFileSync } from "node:fs";
import { resolveMemoryRoot, syncIndexes } from "./lib/core/index.js";

readFileSync(0, "utf8");
syncIndexes(resolveMemoryRoot(), { quiet: true });
process.stdout.write('{"decision":"allow"}\n');
