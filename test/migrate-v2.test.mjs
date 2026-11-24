import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { parse } from "yaml";
import { migrateV2 } from "../scripts/migrate-v2.mjs";
import { createFixture, createStream, put } from "./fixture.mjs";

const prefix = "-Users-zhoupb-Documents-";
const testMemora = `${prefix}projects-memora`;
const testWorkspace = `${prefix}deepseek-harness-default-workspace`;
const testProjects = `${prefix}projects`;
const testNote = "---\nname: Original\ndescription: Original hook\ntype: project\nextra: gone\n---\n\nBody\n";
const rawBody = Buffer.from([0x0d, 0x0a, 0x00, 0xff, 0x0a]);

function setupLegacy(t) {
  const f = createFixture(t);
  put(join(f.root, "global", "MEMORY.md"), "## 工作\n- [用户偏好](legacy.md) — 从索引来\n");
  const legacyHeader = Buffer.from("---\r\nname: 原名\r\ndescription: 旧说明\r\nmetadata:\r\n  type: feedback\r\n  node_type: memory\r\n  originSessionId: sample\r\n  modified: 2026-11-18\r\n---\r\n");
  put(join(f.root, "global", "legacy.md"), Buffer.concat([legacyHeader, rawBody]));
  put(join(f.root, "global", "broken.md"), "---\nname: [broken\n---\n\nKeep unchanged\n");

  const proj = (slug, file) => join(f.root, "projects", slug, file);
  put(proj(testMemora, "MEMORY.md"), "- [Keep](keep.md) — from the index\n- [Open](open-threads.md) — next step\n");
  put(proj(testMemora, "keep.md"), testNote);
  put(proj(testMemora, "open-threads.md"), testNote);
  put(proj(testMemora, "archive/old.md"), testNote);
  put(proj(testMemora, "archive/indexed.md"), testNote);
  put(proj(testMemora, "archive/MEMORY.md"), "- [Archived](indexed.md) — archive hook\n");

  put(proj(testWorkspace, "MEMORY.md"), "- [Chat](chrome-mcp-native-config.md) — catch-all index hook\n");
  for (const file of ["memora-release-expectations.md", "gpt-search-release-expectations.md", "chrome-mcp-native-config.md", "electric-bicycle-shopping.md"]) {
    put(proj(testWorkspace, file), testNote);
  }
  put(proj(testProjects, "MEMORY.md"), "- [Parity](memory-adapter-parity.md) — old adapter note\n");
  put(proj(testProjects, "memory-adapter-parity.md"), testNote);
  return { ...f, proj };
}

function readMigrated(path) {
  const raw = readFileSync(path);
  const close = raw.indexOf(Buffer.from("\n---\n"), 4);
  assert.notEqual(close, -1);
  return {
    fields: parse(raw.subarray(4, close).toString("utf8")),
    body: raw.subarray(close + 5),
  };
}

function snapshotTree(root) {
  const items = [];
  function walk(dir) {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) {
        items.push(`${full}=LINK:${readlinkSync(full)}`);
      } else if (stat.isDirectory()) {
        items.push(`${full}=DIR`);
        walk(full);
      } else {
        items.push(`${full}=${readFileSync(full).toString("base64")}`);
      }
    }
  }
  walk(root);
  return items;
}

test("migrate-v2 rewrites frontmatter, moves folders, preserves raw body bytes, and rebuilds indexes", (t) => {
  const f = setupLegacy(t);
  const out = createStream();
  const err = createStream();
  migrateV2(f.root, { stdout: out, stderr: err });

  assert.ok(out.text.includes("Notes normalized: 10\nFolders renamed: 1\nNotes rehomed: 5\nFiles left untouched: 1\n"));
  assert.ok(out.text.includes("global/broken.md: invalid YAML"));

  const legacy = readMigrated(join(f.root, "global", "legacy.md"));
  assert.deepEqual(legacy.fields, { name: "用户偏好", description: "从索引来", type: "feedback", section: "工作" });
  assert.deepEqual(legacy.body, rawBody);

  assert.equal(readFileSync(join(f.root, "global/broken.md"), "utf8"), "---\nname: [broken\n---\n\nKeep unchanged\n");
  assert.deepEqual(readMigrated(f.proj("memora", "archive/old.md")), {
    fields: { name: "Original", description: "Original hook", type: "project" }, body: Buffer.from("\nBody\n"),
  });
  assert.deepEqual(readMigrated(f.proj("memora", "archive/indexed.md")).fields, {
    name: "Archived", description: "archive hook", type: "project",
  });
  assert.deepEqual(readMigrated(f.proj("memora", "archive/memory-adapter-parity.md")).fields, {
    name: "Parity", description: "old adapter note", type: "project",
  });
  assert.equal(existsSync(f.proj("memora", "archive/MEMORY.md")), false);
  assert.equal(readFileSync(f.proj("memora", "MEMORY.md"), "utf8"), `- [现在做到哪](NOW.md) — next step
- [Keep](keep.md) — from the index
- [Original](memora-release-expectations.md) — Original hook
`);
  assert.equal(readFileSync(join(f.root, "global/MEMORY.md"), "utf8"), `## 工作
- [用户偏好](legacy.md) — 从索引来

## 工具
- [Chat](chrome-mcp-native-config.md) — catch-all index hook
- [Original](gpt-search-release-expectations.md) — Original hook

## 生活
- [Original](electric-bicycle-shopping.md) — Original hook

## 未分类
- [broken](broken.md) — Keep unchanged
`);

  const now = readMigrated(f.proj("memora", "NOW.md"));
  assert.deepEqual(now.fields, { name: "现在做到哪", description: "next step", type: "project" });
  assert.equal(existsSync(f.proj("memora", "open-threads.md")), false);
  for (const old of [testMemora, testWorkspace, testProjects]) {
    assert.equal(existsSync(join(f.root, "projects", old)), false);
  }
});

test("migration preserves templates and archive indexes needed by malformed notes", (t) => {
  const f = setupLegacy(t);
  const archiveIndex = readFileSync(f.proj(testMemora, "archive/MEMORY.md"));
  put(f.proj(testMemora, "archive/indexed.md"), "Missing header");
  put(f.proj(testMemora, "templates/sample.md"), testNote);
  migrateV2(f.root, { stdout: createStream(), stderr: createStream() });
  assert.equal(readFileSync(f.proj("memora", "templates/sample.md"), "utf8"), testNote);
  assert.equal(readFileSync(f.proj("memora", "archive/indexed.md"), "utf8"), "Missing header");
  assert.deepEqual(readFileSync(f.proj("memora", "archive/MEMORY.md")), archiveIndex);
});

test("migration rejects omitted, blank and extra arguments before using a default root", (t) => {
  const f = setupLegacy(t);
  const before = snapshotTree(f.root);
  for (const args of [[], ["  "], [f.root, "extra"]]) {
    const result = spawnSync(process.execPath, ["scripts/migrate-v2.mjs", ...args], {
      encoding: "utf8", env: { ...process.env, HOME: f.home, MEMORA_DIR: f.root },
    });
    assert.equal(result.status, 1);
    assert.equal(result.stderr.trim(), "Usage: node scripts/migrate-v2.mjs <memory-root>");
    assert.deepEqual(snapshotTree(f.root), before);
  }
  // Isolate the API's default-root lookup too, even if its argument check regresses.
  const api = spawnSync(process.execPath, ["--input-type=module", "-e",
    'import assert from "node:assert/strict"; import { migrateV2 } from "./scripts/migrate-v2.mjs"; for (const path of [undefined, "  "]) assert.throws(() => migrateV2(path), /memory-root/);',
  ], { env: { ...process.env, HOME: f.home, MEMORA_DIR: f.root }, encoding: "utf8" });
  assert.equal(api.status, 0, api.stderr);
  assert.deepEqual(snapshotTree(f.root), before);
});

test("catch-all symlinks and missing project destinations fail before any write", (t) => {
  for (const kind of ["symlink", "missing project"]) {
    const f = setupLegacy(t);
    if (kind === "symlink") {
      const path = f.proj(testWorkspace, "chrome-mcp-native-config.md");
      rmSync(path);
      symlinkSync(join(f.root, "global/legacy.md"), path);
    } else {
      rmSync(f.proj(testMemora, ""), { recursive: true });
    }
    const before = snapshotTree(f.root);
    assert.throws(() => migrateV2(f.root), kind === "symlink" ? /regular file/ : /Missing project/);
    assert.deepEqual(snapshotTree(f.root), before);
  }
});

test("migrate-v2 preflight failures leave fixture completely unchanged", (t) => {
  const cases = [
    ["unknown project", "projects/unexpected/note.md", false, /Unknown project folder/],
    ["rehoming clash", "global/chrome-mcp-native-config.md", false, /Destination already exists/],
    ["NOW.md clash", `projects/${testMemora}/NOW.md`, false, /Destination already exists/],
    ["slug clash", "projects/memora", true, /Destination already exists/],
    ["unexpected catch-all", `projects/${testWorkspace}/extra.md`, false, /Unexpected catch-all entry/],
  ];
  for (const [name, relPath, isDir, pattern] of cases) {
    const f = setupLegacy(t);
    const target = join(f.root, relPath);
    if (isDir) mkdirSync(target, { recursive: true });
    else put(target, testNote);

    const before = snapshotTree(f.root);
    assert.throws(() => migrateV2(f.root, { stdout: createStream(), stderr: createStream() }), pattern, name);
    assert.deepEqual(snapshotTree(f.root), before, `fixture modified on ${name}`);
  }
});
