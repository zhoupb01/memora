import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

export function userHome(env = process.env) {
  return env.HOME || env.USERPROFILE || homedir();
}

export function resolveMemoryRoot(directory, env = process.env, home = userHome(env)) {
  const explicit = directory?.trim() ? directory : undefined;
  const fromEnv = env.MEMORA_DIR?.trim() ? env.MEMORA_DIR : undefined;
  const selected = explicit ?? fromEnv;
  if (selected === undefined) return resolve(home, ".agents", "memory");
  if (selected === "~" || /^~[/\\]/.test(selected)) {
    const rest = selected.slice(2).replaceAll("\\", sep);
    return resolve(join(home, rest));
  }
  return resolve(selected);
}
