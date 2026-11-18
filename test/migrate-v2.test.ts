import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { parse } from "yaml";
import { fixture, put, run } from "./fixture";

const prefix = "-Users-zhoupb-Documents-";
const memora = `${prefix}projects-memora`;
const workspace = `${prefix}deepseek-harness-default-workspace`;
const projects = `${prefix}projects`;
const note = "---\nname: Original\ndescription: Original hook\ntype: project\nextra: gone\n---\n\nBody\n";
const rawBody = Buffer.from([0x0d, 0x0a, 0x00, 0xff, 0x0a]);

function legacyFixture() {
  const f = fixture();
  const project = (slug: string, file: string) => join(f.root, "projects", slug, file);
  put(join(f.root, "global", "MEMORY.md"), "## 工作\n- [用户偏好](legacy.md) — 从索引来\n");
  put(join(f.root, "global", "legacy.md"), "---\r\nname: 原名\r\ndescription: 旧说明\r\nmetadata:\r\n  type: feedback\r\n  node_type: memory\r\n  originSessionId: sample\r\n  modified: 2026-11-18\r\n---\r\n");
  appendFileSync(join(f.root, "global", "legacy.md"), rawBody);
  put(join(f.root, "global", "broken.md"), "---\nname: [broken\n---\n\nKeep unchanged\n");
  put(project(memora, "MEMORY.md"), "- [Keep](keep.md) — from the index\n- [Open](open-threads.md) — next step\n");
  put(project(memora, "keep.md"), note);
  put(project(memora, "open-threads.md"), note);
  put(project(memora, "archive/old.md"), note);
  put(project(memora, "archive/indexed.md"), note);
  put(project(memora, "archive/MEMORY.md"), "- [Archived](indexed.md) — archive hook\n");
  put(project(workspace, "MEMORY.md"), "- [Chat](chrome-mcp-native-config.md) — catch-all index hook\n");
  for (const file of ["memora-release-expectations.md", "gpt-search-release-expectations.md", "chrome-mcp-native-config.md", "electric-bicycle-shopping.md"]) {
    put(project(workspace, file), note);
  }
  put(project(projects, "MEMORY.md"), "- [Parity](memory-adapter-parity.md) — old adapter note\n");
  put(project(projects, "memory-adapter-parity.md"), note);
  return { ...f, project };
}

function migrate(f: ReturnType<typeof fixture>) {
  return run(f, "scripts/migrate-v2.ts", [f.root]);
}

function migratedNote(path: string) {
  const bytes = readFileSync(path);
  const end = bytes.indexOf("\n---\n", 4);
  return { fields: parse(bytes.subarray(4, end).toString()), body: bytes.subarray(end + 5) };
}

function snapshot(root: string) {
  return readdirSync(root, { recursive: true, withFileTypes: true }).map((entry) => {
    const path = join(entry.parentPath, entry.name);
    return [path, entry.isDirectory() ? null : readFileSync(path).toString("base64")];
  }).sort(([a], [b]) => String(a).localeCompare(String(b)));
}

test("migration plans note rewrites and moves, preserves body bytes, and rebuilds indexes", () => {
  const f = legacyFixture();
  const result = migrate(f);
  expect(result.code).toBe(0);
  expect(result.out).toContain("Notes normalized: 10\nFolders renamed: 1\nNotes rehomed: 5\nFiles left untouched: 1\n");
  expect(result.out).toContain("global/broken.md: invalid YAML");
  expect(migratedNote(join(f.root, "global", "legacy.md"))).toEqual({
    fields: { name: "用户偏好", description: "从索引来", type: "feedback", section: "工作" }, body: rawBody,
  });
  expect(readFileSync(join(f.root, "global", "broken.md"), "utf8")).toBe("---\nname: [broken\n---\n\nKeep unchanged\n");
  expect(migratedNote(f.project("memora", "archive/old.md"))).toEqual({
    fields: { name: "Original", description: "Original hook", type: "project" }, body: Buffer.from("\nBody\n"),
  });
  expect(migratedNote(f.project("memora", "archive/indexed.md")).fields).toEqual({
    name: "Archived", description: "archive hook", type: "project",
  });
  expect(migratedNote(f.project("memora", "archive/memory-adapter-parity.md")).fields).toEqual({
    name: "Parity", description: "old adapter note", type: "project",
  });
  expect(migratedNote(f.project("memora", "NOW.md")).fields).toEqual({ name: "现在做到哪", description: "next step", type: "project" });
  expect(readFileSync(f.project("memora", "MEMORY.md"), "utf8")).toBe(`- [现在做到哪](NOW.md) — next step
- [Keep](keep.md) — from the index
- [Original](memora-release-expectations.md) — Original hook
`);
  expect(readFileSync(join(f.root, "global", "MEMORY.md"), "utf8")).toBe(`## 工作
- [用户偏好](legacy.md) — 从索引来

## 工具
- [Chat](chrome-mcp-native-config.md) — catch-all index hook
- [Original](gpt-search-release-expectations.md) — Original hook

## 生活
- [Original](electric-bicycle-shopping.md) — Original hook

## 未分类
- [broken](broken.md) — Keep unchanged
`);
  for (const old of [memora, workspace, projects]) expect(existsSync(join(f.root, "projects", old))).toBe(false);
  expect(existsSync(f.project("memora", "open-threads.md"))).toBe(false);
});

const preflightCases = [
  { name: "unknown project", path: "projects/unexpected/note.md", error: "Unknown project folder" },
  { name: "rehoming clash", path: "global/chrome-mcp-native-config.md", error: "Destination already exists" },
  { name: "NOW.md clash", path: `projects/${memora}/NOW.md`, error: "Destination already exists" },
  { name: "slug clash", path: "projects/memora", error: "Destination already exists" },
  { name: "unexpected catch-all file", path: `projects/${workspace}/extra.md`, error: "Unexpected catch-all entry" },
];
for (const { name, path, error } of preflightCases) {
  test(`migration does not write anything on ${name}`, () => {
    const f = legacyFixture();
    put(join(f.root, path), note);
    const before = snapshot(f.root);
    const result = migrate(f);
    expect(result.code).not.toBe(0);
    expect(result.err).toContain(error);
    expect(snapshot(f.root)).toEqual(before);
  });
}
