import { homedir } from "node:os";
import { join, resolve } from "node:path";

export { buildMemoryPrompt, readDreamTemplate } from "./lib/core/index.js";

function expandHome(path, home) {
  if (path === "~") return home;
  return /^~[/\\]/.test(path) ? join(home, path.slice(2)) : path;
}

/** DSH owns root configuration; the shared core receives the resolved path. */
export function resolveMemoryRoot(directory, env = process.env, home = homedir()) {
  const override = directory?.trim() ? directory : env.DSH_MEMORY_DIR;
  if (override?.trim()) return resolve(expandHome(override, home));
  const dshHome = env.DSH_HOME?.trim() ? expandHome(env.DSH_HOME, home) : join(home, ".dsh");
  return resolve(dshHome, "memory");
}
