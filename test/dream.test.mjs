import assert from "node:assert/strict";
import { appendFileSync, existsSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { dream, withDreamLock } from "../packages/core/src/index.js";
import { createFixture, createStream, put } from "./fixture.mjs";

const time = "2026-11-17T12:00:00Z";
const line = (record) => `${JSON.stringify(record)}\n`;
const message = (text) => line({ type: "message", timestamp: time, message: { role: "user", content: [{ type: "text", text }] } });
const note = (name, body = "Body") => `---\nname: ${name}\ndescription: hook\ntype: user\nsection: Work\n---\n${body}\n`;

function setup(t) {
  const f = createFixture(t);
  const path = join(f.home, ".pi", "agent", "sessions", "project", "session.jsonl");
  put(path, line({ type: "session", timestamp: time, cwd: "/example/work" }) + message("Already there"));
  const cursor = join(f.root, ".dream", "cursor.json");
  const invoke = (runner, options = {}) => {
    const out = createStream();
    const err = createStream();
    dream({ root: f.root, ...options }, runner, f.home, { stdout: out, stderr: err });
    return { out: out.text, err: err.text };
  };
  return { ...f, path, cursor, invoke };
}

function readChunk(prompt) {
  const path = /^Chunk: (.+)$/m.exec(prompt)?.[1];
  assert.ok(path, "missing chunk path");
  return readFileSync(path, "utf8");
}

const noCall = () => {
  throw new Error("Unexpected model call");
};

test("first run records baseline cursor without git; appended record runs curator and syncs indexes", (t) => {
  const f = setup(t);
  const first = f.invoke(noCall);
  assert.ok(first.out.includes("Cursor initialized: 1 transcripts"));
  assert.equal(existsSync(join(f.root, ".dream", ".gitignore")), false);
  assert.equal(JSON.parse(readFileSync(f.cursor, "utf8"))[f.path].records, 2);

  appendFileSync(f.path, message("Appended"));
  const second = f.invoke(({ prompt, model }) => {
    assert.equal(model, "sub2api/gpt-6.2-sol");
    assert.ok(readChunk(prompt).includes("Appended"));
    assert.ok(!readChunk(prompt).includes("Already there"));
    put(join(f.root, "global", "new.md"), note("New"));
    return "Saved note\nAdded new.md: supported by the user.";
  });
  assert.ok(second.out.includes("Notes: 1 added, 0 changed, 0 moved, 0 deleted"));
  assert.ok(!second.out.includes("Commit:"));
  assert.ok(readFileSync(join(f.root, "global", "MEMORY.md"), "utf8").includes("[New](new.md)"));
  assert.equal(JSON.parse(readFileSync(f.cursor, "utf8"))[f.path].records, 3);

  const before = readFileSync(f.cursor, "utf8");
  f.invoke(noCall);
  assert.equal(readFileSync(f.cursor, "utf8"), before);
});

test("dream counts added/changed/moved/deleted without git and backs up modified and deleted originals", (t) => {
  const f = setup(t);
  f.invoke(noCall);

  const editedOrig = note("Edited", "Original important 10-Q check");
  const deletedOrig = note("Deleted", "Original deleted text");
  const movedOrig = note("Moved", "Original archived text");
  put(join(f.root, "projects", "stocks", "NOW.md"), editedOrig);
  put(join(f.root, "global", "wrong.md"), deletedOrig);
  put(join(f.root, "global", "old.md"), movedOrig);

  appendFileSync(f.path, message("Update notes"));
  const res = f.invoke(() => {
    put(join(f.root, "projects", "stocks", "NOW.md"), note("Edited", "Rewritten body"));
    rmSync(join(f.root, "global", "wrong.md"));
    put(join(f.root, "global", "archive", "old.md"), movedOrig);
    rmSync(join(f.root, "global", "old.md"));
    put(join(f.root, "global", "fresh.md"), note("Fresh", "Brand new"));
    return "Curated all four actions";
  });

  assert.ok(res.out.includes("Notes: 1 added, 1 changed, 1 moved, 1 deleted"), res.out);
  const backupDir = /^Backups: (.+)$/m.exec(res.out)?.[1];
  assert.ok(backupDir, `expected Backups line in:\n${res.out}`);
  assert.equal(readFileSync(join(backupDir, "projects", "stocks", "NOW.md"), "utf8"), editedOrig);
  assert.equal(readFileSync(join(backupDir, "global", "wrong.md"), "utf8"), deletedOrig);
  // Pure byte-identical moves to archive/ do not need duplicate backups
  assert.equal(existsSync(join(backupDir, "global", "old.md")), false);
});

test("unchanged size and mtime skip reading; --since bypasses cursor; failed chunk preserves cursor", (t) => {
  const f = setup(t);
  const bad = join(dirname(f.path), "unreadable.jsonl");
  put(bad, "invalid JSONL\n");
  const { size, mtimeMs: mtime } = statSync(bad);
  put(f.cursor, JSON.stringify({ [bad]: { size, mtime, records: 1 } }));

  f.invoke(({ prompt }) => {
    assert.ok(readChunk(prompt).includes("Already there"));
    return "Read session";
  });
  assert.throws(() => f.invoke(noCall, { since: "2026-11-17", dryRun: true }), /invalid JSONL/);
  rmSync(bad);

  const before = readFileSync(f.cursor, "utf8");
  const dry = f.invoke(noCall, { since: "2026-11-17", dryRun: true });
  assert.ok(dry.out.includes("Sessions: pi 1"));
  assert.equal(readFileSync(f.cursor, "utf8"), before);

  for (let i = 0; i < 153; i++) appendFileSync(f.path, message(`${i}: ${"x".repeat(2000)}`));
  let calls = 0;
  assert.throws(() => f.invoke(() => {
    calls++;
    if (calls === 2) throw new Error("boom");
    return "Chunk 1 ok";
  }), /Dream chunk 2\/2 failed: boom/);
  assert.equal(readFileSync(f.cursor, "utf8"), before);
});

test("dream lock blocks re-entry on live PID and recovers stale dead PID lock", (t) => {
  const f = createFixture(t);
  const lock = join(f.dir, "lock");

  withDreamLock(lock, () => {
    assert.throws(() => withDreamLock(lock, () => {}), new RegExp(`Dream lock is held by PID ${process.pid}`));
  });
  assert.equal(existsSync(lock), false);

  // Dead PID lock is reclaimed cleanly
  writeFileSync(lock, "99999999\n");
  let ran = false;
  withDreamLock(lock, () => {
    ran = true;
    assert.equal(readFileSync(lock, "utf8").trim(), String(process.pid));
  });
  assert.equal(ran, true);
  assert.equal(existsSync(lock), false);
});
