import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { test } from "node:test";

for (const adapter of ["pi-memory", "dsh-memory"]) {
  test(`${adapter} contains the same complete core and prompts`, () => {
    for (const file of ["index.js", "GUIDE.md", "dream.md"]) {
      const source = readFileSync(new URL(`../packages/core/${file}`, import.meta.url));
      const packaged = readFileSync(new URL(`../packages/${adapter}/lib/core/${file}`, import.meta.url));
      assert.deepEqual(packaged, source, `${adapter}/${file} is stale; run npm run build`);
    }
    assert.deepEqual(
      readFileSync(new URL(`../packages/${adapter}/LICENSE`, import.meta.url)),
      readFileSync(new URL("../LICENSE", import.meta.url)),
    );
  });
}

test("pi manifest points to package-local entry and shared dream template", () => {
  const root = new URL("../packages/pi-memory/", import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
  assert.deepEqual(manifest.pi, { extensions: ["./index.ts"], prompts: ["./lib/core/dream.md"] });
  for (const file of [...manifest.pi.extensions, ...manifest.pi.prompts]) {
    assert.ok(statSync(new URL(file, root)).isFile());
  }
});

test("repository root is a neutral workspace with three peer packages", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(manifest.name, "memora");
  assert.equal(manifest.private, true);
  assert.equal(manifest.pi, undefined);
  assert.equal(manifest.dsh, undefined);
  assert.deepEqual(manifest.workspaces, ["packages/core", "packages/pi-memory", "packages/dsh-memory"]);
});
