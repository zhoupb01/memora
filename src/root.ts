import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function resolveMemoryRoot(directory?: string) {
  const override = process.env.MEMORA_DIR;
  const selected = directory ?? (override?.trim() ? override : undefined);
  if (selected === undefined) return resolve(homedir(), ".agents", "memory");
  if (selected === "~" || /^~[/\\]/.test(selected)) return resolve(join(homedir(), selected.slice(2)));
  return resolve(selected);
}
