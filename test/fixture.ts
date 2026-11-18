import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach } from "bun:test";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

export function fixture() {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), "memora-test-"));
  temporaryDirectories.push(directory);
  const home = join(directory, "home");
  const cwd = join(home, "work");
  const root = join(directory, "memory");
  mkdirSync(cwd, { recursive: true });
  return { home, cwd, root };
}

export function put(path: string, text: string | Uint8Array = "") {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

export function run(f: ReturnType<typeof fixture>, entry: string, args: string[], memoryDir?: string) {
  const result = Bun.spawnSync([process.execPath, fileURLToPath(new URL(`../${entry}`, import.meta.url)), ...args], {
    cwd: f.cwd,
    env: { PATH: process.env.PATH, HOME: f.home, USERPROFILE: f.home, MEMORA_DIR: memoryDir, TZ: "UTC" },
  });
  return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() };
}

export function cli(f: ReturnType<typeof fixture>, args: string[], memoryDir?: string) {
  return run(f, "bin/memora.ts", args, memoryDir);
}
