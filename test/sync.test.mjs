import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync, utimesSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { syncIndexes } from "../packages/core/src/index.js";
import { createFixture, createStream, put } from "./fixture.mjs";

const note = (name, description, section) => `---
name: ${name}
description: ${description}
type: project
${section ? `section: ${section}\n` : ""}---
body stays out of the index
`;

function runSync(root) {
  const out = createStream();
  const err = createStream();
  syncIndexes(root, { stdout: out, stderr: err });
  return { out: out.text, err: err.text };
}

test("first sync on an empty root initializes global/MEMORY.md cleanly", (t) => {
  const f = createFixture(t);
  assert.equal(existsSync(f.root), false);
  assert.deepEqual(runSync(f.root), {
    out: "Indexes: 1 written, 0 unchanged; 0 warnings\n",
    err: "",
  });
  assert.equal(readFileSync(join(f.root, "global", "MEMORY.md"), "utf8"), "");
  assert.deepEqual(runSync(f.root), {
    out: "Indexes: 0 written, 1 unchanged; 0 warnings\n",
    err: "",
  });
});

test("sync keeps section and link order, appends new notes, and keeps NOW.md first", (t) => {
  const f = createFixture(t);
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

  assert.deepEqual(runSync(f.root), {
    out: "Indexes: 2 written, 0 unchanged; 0 warnings\n",
    err: "",
  });
  assert.equal(readFileSync(globalIndex, "utf8"), `## 工作
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
  assert.equal(readFileSync(projectIndex, "utf8"), `- [Now](NOW.md) — next step
- [Z](z.md) — keep first
- [B](b.md) — keep second
- [A](a.md) — new note
`);
  assert.equal(existsSync(join(empty, "MEMORY.md")), false);

  for (const index of [globalIndex, projectIndex]) utimesSync(index, 100, 100);
  assert.deepEqual(runSync(f.root), {
    out: "Indexes: 0 written, 2 unchanged; 0 warnings\n",
    err: "",
  });
  for (const index of [globalIndex, projectIndex]) {
    assert.equal(statSync(index).mtimeMs, 100_000);
  }

  put(join(project, "z.md"), note("Z", "updated"));
  assert.deepEqual(runSync(f.root), {
    out: "Indexes: 1 written, 1 unchanged; 0 warnings\n",
    err: "",
  });
  assert.ok(readFileSync(projectIndex, "utf8").includes("- [Z](z.md) — updated\n"));
  assert.equal(statSync(globalIndex).mtimeMs, 100_000);
});

test("missing and invalid frontmatter use first body line; long hooks warn without truncation", (t) => {
  const f = createFixture(t);
  const project = join(f.root, "projects", "alpha");
  const longHook = "字".repeat(151);
  put(join(project, "missing.md"), `\n  ${longHook}  \nignored\n`);
  put(join(project, "broken.md"), "---\nname: [bad\n---\n\nReadable body\n");
  put(join(project, "long.md"), note("Long", longHook));

  const result = runSync(f.root);
  assert.ok(result.out.includes("3 warnings"));
  const lines = result.err.trimEnd().split("\n");
  assert.equal(lines.length, 3);
  assert.match(lines[0], /broken\.md: invalid YAML/);
  assert.match(lines[1], /long\.md: description exceeds 150 characters/);
  assert.match(lines[2], /missing\.md: missing frontmatter/);
  assert.equal(
    readFileSync(join(project, "MEMORY.md"), "utf8"),
    `- [broken](broken.md) — Readable body\n- [Long](long.md) — ${longHook}\n- [missing](missing.md) — ${"字".repeat(150)}\n`,
  );
});

for (const [globalCount, projectCount] of [[199, 201], [200, 200], [200, 201]]) {
  test(`index size warnings apply independently (${globalCount + 1} global, ${projectCount} project lines)`, (t) => {
    const f = createFixture(t);
    const global = join(f.root, "global");
    const project = join(f.root, "projects", "alpha");
    for (const [folder, count] of [[global, globalCount], [project, projectCount]]) {
      for (let i = 1; i <= count; i++) {
        put(join(folder, `${i}.md`), note(`Note ${i}`, "hook", "工具"));
      }
    }
    const result = runSync(f.root);
    for (const [folder, count] of [[global, globalCount + 1], [project, projectCount]]) {
      const path = join(folder, "MEMORY.md");
      assert.equal(readFileSync(path, "utf8").trimEnd().split("\n").length, count);
      assert.equal(result.err.includes(`${path}: index exceeds 200 lines`), count > 200);
    }
  });
}

for (const scope of ["global", "projects/alpha"]) {
  test(`sync throws on unreadable ${scope} index`, (t) => {
    const f = createFixture(t);
    put(join(f.root, scope, "note.md"), note("Note", "hook"));
    put(join(f.root, scope, "MEMORY.md", "not-an-index"));
    assert.throws(() => runSync(f.root), /EISDIR/);
  });
}
