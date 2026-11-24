import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { buildMemoryPrompt } from "../packages/core/src/index.js";
import { createFixture, put } from "./fixture.mjs";

const note = (name, description, body, section) => `---
name: ${name}
description: ${description}
type: project
${section ? `section: ${section}\n` : ""}---
${body}
`;

test("buildMemoryPrompt auto-initializes empty store, syncs notes, and excludes NOW.md body", (t) => {
  const f = createFixture(t);
  const repo = join(f.cwd, "demo-repo");
  mkdirSync(join(repo, ".git"), { recursive: true });

  // First-time install: memory root does not exist at all yet
  const emptyPrompt = buildMemoryPrompt({ root: f.root, cwd: repo, home: f.home });
  assert.equal(existsSync(join(f.root, "global", "MEMORY.md")), true);
  assert.ok(emptyPrompt.includes(`My long-term memory is in \`${f.root}/\`.`));
  assert.ok(!emptyPrompt.includes("memora "));
  assert.ok(emptyPrompt.includes(`## Global (\`${join(f.root, "global")}\`)\n\n(empty)`));
  assert.ok(emptyPrompt.includes(`## Project (\`${join(f.root, "projects", "demo-repo")}\`)\n\n(empty)`));

  // Add global note + project NOW.md without manually editing MEMORY.md
  put(join(f.root, "global", "pref.md"), note("Pref", "Always use Bun", "SECRET_GLOBAL_BODY", "工作"));
  put(join(f.root, "projects", "demo-repo", "NOW.md"), note("现在做到哪", "Next step summary", "SECRET_NOW_BODY_MUST_NOT_LEAK"));

  const populated = buildMemoryPrompt({ root: f.root, cwd: repo, home: f.home });
  assert.ok(populated.includes("## 工作\n- [Pref](pref.md) — Always use Bun"));
  assert.ok(populated.includes("- [现在做到哪](NOW.md) — Next step summary"));
  assert.ok(!populated.includes("SECRET_GLOBAL_BODY"));
  assert.ok(!populated.includes("SECRET_NOW_BODY_MUST_NOT_LEAK"));
  assert.ok(readFileSync(join(f.root, "projects", "demo-repo", "MEMORY.md"), "utf8").includes("NOW.md"));
});

test("buildMemoryPrompt enforces hard 200-line and 25 KB caps and handles non-project directories", (t) => {
  const f = createFixture(t);
  const repo = join(f.cwd, "cap-repo");
  mkdirSync(join(repo, ".git"), { recursive: true });

  for (let i = 1; i <= 205; i++) {
    put(join(f.root, "projects", "cap-repo", `${String(i).padStart(3, "0")}.md`), note(`N${i}`, "short", "body"));
  }
  const lineCapped = buildMemoryPrompt({ root: f.root, cwd: repo, home: f.home });
  assert.ok(lineCapped.includes("- [N200](200.md) — short"));
  assert.ok(!lineCapped.includes("- [N201](201.md) — short"));
  assert.ok(lineCapped.includes("(MEMORY.md exceeds 200 lines or 25 KB; run /dream to archive old notes.)"));

  // Byte cap: 100 notes x ~350 bytes > 25 KB while still under 200 lines
  const byteRepo = join(f.cwd, "byte-repo");
  mkdirSync(join(byteRepo, ".git"), { recursive: true });
  const bigDesc = "中".repeat(120);
  for (let i = 1; i <= 90; i++) {
    put(join(f.root, "projects", "byte-repo", `${String(i).padStart(3, "0")}.md`), note(`B${i}`, bigDesc, "body"));
  }
  const byteCapped = buildMemoryPrompt({ root: f.root, cwd: byteRepo, home: f.home });
  assert.ok(byteCapped.includes("(MEMORY.md exceeds 200 lines or 25 KB; run /dream to archive old notes.)"));
  assert.ok(!byteCapped.includes("[B90](090.md)"));

  // Outside any project repository
  const outside = buildMemoryPrompt({ root: f.root, cwd: f.cwd, home: f.home });
  assert.ok(outside.includes("## Project\n\n(none — outside a project repository)"));
});
