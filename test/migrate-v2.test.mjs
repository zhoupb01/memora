import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
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
      if (statSync(full).isDirectory()) {
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

  const now = readMigrated(f.proj("memora", "NOW.md"));
  assert.deepEqual(now.fields, { name: "现在做到哪", description: "next step", type: "project" });
  assert.equal(existsSync(f.proj("memora", "open-threads.md")), false);
  for (const old of [testMemora, testWorkspace, testProjects]) {
    assert.equal(existsSync(join(f.root, "projects", old)), false);
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
