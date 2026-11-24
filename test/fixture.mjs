import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export function createStream() {
  let text = "";
  return {
    write(chunk) {
      text += String(chunk);
    },
    get text() {
      return text;
    },
  };
}

export function createFixture(t) {
  const base = realpathSync(tmpdir());
  const dir = mkdtempSync(join(base, "memora-test-"));
  const home = join(dir, "home");
  const cwd = join(home, "work");
  const root = join(dir, "memory");
  mkdirSync(cwd, { recursive: true });
  if (t?.after) {
    t.after(() => rmSync(dir, { recursive: true, force: true }));
  }
  return { dir, home, cwd, root };
}

export function put(path, content = "") {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return path;
}
