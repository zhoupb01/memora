import { existsSync, readFileSync, statSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { cli, fixture, put } from "./fixture";

const note = (name: string, description: string, section?: string) => `---
name: ${name}
description: ${description}
type: project
${section ? `section: ${section}\n` : ""}---
body stays out of the index
`;

test("sync keeps section and link order, appends new notes, and keeps NOW.md first", () => {
  const f = fixture();
  const global = join(f.root, "global");
  const project = join(f.root, "projects", "alpha");
  const empty = join(f.root, "projects", "empty");
  const globalIndex = join(global, "MEMORY.md");
  const projectIndex = join(project, "MEMORY.md");
  put(globalIndex, `## 待删
- [Deleted](deleted.md) — gone

## 工作
- [Old title](z.md) — old hook
- [Old title](b.md) — old hook

## 用户
- [User](user.md) — current
`);
  put(join(global, "z.md"), note("Z", "keep first", "工作"));
  put(join(global, "b.md"), note("B", "keep second", "工作"));
  put(join(global, "a.md"), note("A", "new note", "工作"));
  put(join(global, "user.md"), note("User", "current", "用户"));
  put(join(global, "0.md"), note("Other", "new section", "工具"));
  put(join(global, "1.md"), note("Next", "next section", "生活"));
  put(join(global, "2.md"), note("Loose", "no section"));
  put(projectIndex, "- [Z](z.md) — keep first\n- [B](b.md) — keep second\n");
  put(join(project, "NOW.md"), note("Now", "next step"));
  put(join(project, "a.md"), note("A", "new note"));
  put(join(project, "b.md"), note("B", "keep second"));
  put(join(project, "z.md"), note("Z", "keep first"));
  put(join(global, "archive", "past.md"), "ignored archive body");
  put(join(project, "archive", "past.md"), "ignored archive body");
  put(join(project, "ignored.txt"), "ignored non-note body");
  put(join(project, "ignored.MD"), "ignored uppercase extension");
  put(join(empty, "archive", "past.md"), "ignored archive body");
  const sync = () => cli(f, ["sync", "--root", f.root]);
  expect(sync()).toEqual({ code: 0, out: "Indexes: 2 written, 0 unchanged; 0 warnings\n", err: "" });
  expect(readFileSync(globalIndex, "utf8")).toBe(`## 工作
- [Z](z.md) — keep first
- [B](b.md) — keep second
- [A](a.md) — new note

## 用户
- [User](user.md) — current

## 工具
- [Other](0.md) — new section

## 生活
- [Next](1.md) — next section

## 未分类
- [Loose](2.md) — no section
`);
  expect(readFileSync(projectIndex, "utf8")).toBe(`- [Now](NOW.md) — next step
- [Z](z.md) — keep first
- [B](b.md) — keep second
- [A](a.md) — new note
`);
  expect(existsSync(join(empty, "MEMORY.md"))).toBe(false);
  for (const index of [globalIndex, projectIndex]) utimesSync(index, 100, 100);
  expect(sync()).toEqual({ code: 0, out: "Indexes: 0 written, 2 unchanged; 0 warnings\n", err: "" });
  for (const index of [globalIndex, projectIndex]) expect(statSync(index).mtimeMs).toBe(100_000);
  put(join(project, "z.md"), note("Z", "updated"));
  expect(sync()).toEqual({ code: 0, out: "Indexes: 1 written, 1 unchanged; 0 warnings\n", err: "" });
  expect(readFileSync(projectIndex, "utf8")).toContain("- [Z](z.md) — updated\n");
  expect(statSync(globalIndex).mtimeMs).toBe(100_000);
});

test("missing and invalid frontmatter use the first body line; valid long hooks warn without truncation", () => {
  const f = fixture();
  const project = join(f.root, "projects", "alpha");
  const longHook = "字".repeat(151);
  put(join(project, "missing.md"), `\n  ${longHook}  \nignored\n`);
  put(join(project, "broken.md"), "---\nname: [bad\n---\n\nReadable body\n");
  put(join(project, "long.md"), note("Long", longHook));
  const result = cli(f, ["sync", "--root", f.root]);
  expect(result.code).toBe(0);
  expect(result.out).toContain("3 warnings");
  expect(result.err.trimEnd().split("\n")).toEqual([
    expect.stringContaining("broken.md: invalid YAML"),
    expect.stringContaining("long.md: description exceeds 150 characters"),
    expect.stringContaining("missing.md: missing frontmatter"),
  ]);
  expect(readFileSync(join(project, "MEMORY.md"), "utf8")).toBe(`- [broken](broken.md) — Readable body
- [Long](long.md) — ${longHook}
- [missing](missing.md) — ${"字".repeat(150)}
`);
});

for (const [globalCount, projectCount] of [[199, 201], [200, 200], [200, 200 + 1]]) {
  test(`index size warnings apply independently (${globalCount + 1} global, ${projectCount} project lines)`, () => {
    const f = fixture();
    const global = join(f.root, "global");
    const project = join(f.root, "projects", "alpha");
    for (const [folder, count] of [[global, globalCount], [project, projectCount]] as const) {
      for (let i = 1; i <= count; i++) put(join(folder, `${i}.md`), note(`Note ${i}`, "hook", "工具"));
    }
    const result = cli(f, ["sync", "--root", f.root]);
    expect(result.code).toBe(0);
    for (const [folder, count] of [[global, globalCount + 1], [project, projectCount]] as const) {
      const path = join(folder, "MEMORY.md");
      expect(readFileSync(path, "utf8").trimEnd().split("\n")).toHaveLength(count);
      expect(result.err.includes(`${path}: index exceeds 200 lines`)).toBe(count > 200);
    }
  });
}

for (const scope of ["global", "projects/alpha"]) {
  test(`sync reports an unreadable ${scope} index`, () => {
    const f = fixture();
    put(join(f.root, scope, "note.md"), note("Note", "hook"));
    put(join(f.root, scope, "MEMORY.md", "not-an-index"));
    const result = cli(f, ["sync", "--root", f.root]);
    expect(result.code).not.toBe(0);
    expect(result.err).toContain("EISDIR");
  });
}
