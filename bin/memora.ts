#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { resolveProject } from "../src/project";
import { resolveMemoryRoot } from "../src/root";
import { syncIndexes } from "../src/sync";

const usage = "Usage: memora sync [--root <dir>]\n       memora resolve [dir] [--json] [--root <dir>]";

try {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "sync": {
      const { values } = parseArgs({ args, options: { root: { type: "string" } } });
      syncIndexes(resolveMemoryRoot(values.root));
      break;
    }
    case "resolve": {
      const { values, positionals } = parseArgs({
        args,
        options: { root: { type: "string" }, json: { type: "boolean" } },
        allowPositionals: true,
      });
      if (positionals.length > 1) throw new Error("resolve accepts at most one directory");
      const result = resolveProject(resolveMemoryRoot(values.root), positionals[0]);
      if (values.json) console.log(JSON.stringify(result));
      else if (result.folder !== null) console.log(result.folder);
      break;
    }
    default:
      throw new Error(usage);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
