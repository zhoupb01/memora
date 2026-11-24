import assert from "node:assert/strict";
import fs, { appendFileSync, existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { buildDreamFollowup, dream, parseDreamCommandInput, dreamCommandUsage, withDreamLock } from "../packages/core/src/index.js";
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

test("dream validates missing flag values and quotes shell arguments literally", () => {
  for (const option of ["--model", "--since"]) {
    assert.deepEqual(parseDreamCommandInput(option + " --dry-run"), { ok: false, error: dreamCommandUsage });
  }
  const prompt = buildDreamFollowup({ script: "it's.js", root: "$HOME/a b", args: ["--model", "a`b`"] });
  assert.ok(prompt.startsWith("Run `node 'it'\\''s.js' --root '$HOME/a b' --model 'a`b`'` with bash"));
});

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
  const movedOrig = note("Moved", "Original archived text");
  const deletedOrig = movedOrig; // Identical siblings, but only old.md moved.
  put(join(f.root, "projects", "stocks", "NOW.md"), editedOrig);
  put(join(f.root, "global", "wrong.md"), deletedOrig);
  put(join(f.root, "global", "old.md"), movedOrig);

  appendFileSync(f.path, message("Update notes"));
  const res = f.invoke(({ root, prompt }) => {
    assert.equal(root, f.root);
    assert.ok(prompt.includes(`Memory root: ${root}`));
    assert.match(prompt, /# Shared memory/);
    assert.match(prompt, /Project folders: \["stocks"\]/);
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

test("unchanged size and mtime skip reading; --since bypasses cursor", (t) => {
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

  f.invoke(({ model, prompt }) => {
    assert.equal(model, "test/model");
    assert.match(readChunk(prompt), /Already there/);
    return "Replayed session";
  }, { since: "2026-11-17", model: "test/model" });
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(f.cursor))), [f.path]);
});

test("failed chunk keeps reports and originals; retry runs chunks in order with fresh indexes", (t) => {
  const f = setup(t);
  f.invoke(noCall);
  const before = readFileSync(f.cursor, "utf8");
  const index = join(f.root, "global", "MEMORY.md");
  rmSync(index);
  const changed = put(join(f.root, "global", "edit.md"), note("Original"));
  const deleted = put(join(f.root, "global", "delete.md"), note("Deleted"));
  for (let i = 0; i < 153; i++) appendFileSync(f.path, message(`${i}: ${"x".repeat(2000)}`));
  let calls = 0;
  let digest;
  assert.throws(() => f.invoke(({ prompt }) => {
    if (++calls === 1) {
      digest = dirname(/^Chunk: (.+)$/m.exec(prompt)[1]);
      assert.match(readFileSync(index, "utf8"), /Original/);
      assert.match(readChunk(prompt), /0: xxx/);
      put(changed, note("Updated"));
      rmSync(deleted);
      return "Chunk 1 ok";
    }
    assert.match(readFileSync(index, "utf8"), /Updated/);
    assert.match(readChunk(prompt), /152: xxx/);
    throw new Error("boom");
  }, { since: "2026-11-17" }), { message: /Dream chunk 2\/2 failed: boom\nDigest: .+\nBackups: .+/ });
  assert.deepEqual(readdirSync(digest).sort(), ["backup", "chunk-000001.md", "chunk-000002.md", "report-000001.md"]);
  assert.equal(readFileSync(join(digest, "report-000001.md"), "utf8"), "Chunk 1 ok\n");
  assert.equal(readFileSync(join(digest, "backup/global/edit.md"), "utf8"), note("Original"));
  assert.equal(readFileSync(join(digest, "backup/global/delete.md"), "utf8"), note("Deleted"));
  assert.equal(readFileSync(f.cursor, "utf8"), before);
  calls = 0;
  const retry = f.invoke(({ prompt }) => {
    assert.match(readChunk(prompt), ++calls === 1 ? /0: xxx/ : /152: xxx/);
    return "Processed chunk";
  });
  assert.equal(calls, 2);
  assert.equal(retry.out.match(/^Indexes:/gm).length, 1);
  assert.equal(JSON.parse(readFileSync(f.cursor))[f.path].records, 155);
});

test("an empty digest advances past tool records and skips the unchanged file next time", (t) => {
  const f = setup(t);
  f.invoke(noCall);
  appendFileSync(f.path, line({ type: "message", timestamp: time, message: { role: "toolResult" } }));
  utimesSync(f.path, 100, 100);
  const { size, mtimeMs: mtime } = statSync(f.path);
  assert.match(f.invoke(noCall).out, /nothing new/);
  assert.deepEqual(JSON.parse(readFileSync(f.cursor))[f.path], { size, mtime, records: 3 });
  put(f.path, "x".repeat(size - 1) + "\n");
  utimesSync(f.path, 100, 100);
  assert.match(f.invoke(noCall).out, /nothing new/);
});

for (const failure of ["report write", "index sync"]) {
  test(`a failed ${failure} keeps backups, completed reports and the prior cursor`, (t) => {
    const f = setup(t);
    f.invoke(noCall);
    const before = readFileSync(f.cursor);
    const path = put(join(f.root, "global", "old.md"), note("Before"));
    appendFileSync(f.path, message("x".repeat(2000)).repeat(153));
    let digest;
    let calls = 0;
    assert.throws(() => f.invoke(({ prompt }) => {
      digest = dirname(/^Chunk: (.+)$/m.exec(prompt)[1]);
      if (++calls === 2) {
        assert.equal(readFileSync(join(digest, "report-000001.md"), "utf8"), "Report 1\n");
        rmSync(path);
        const blocker = failure === "index sync" ? join(f.root, "global/MEMORY.md") : join(digest, "report-000002.md");
        rmSync(blocker, { force: true });
        put(join(blocker, "blocker"));
      }
      return `Report ${calls}`;
    }), /EISDIR[\s\S]*Digest: .+\nBackups: .+/);
    assert.equal(calls, 2);
    if (failure === "index sync") assert.equal(readFileSync(join(digest, "report-000002.md"), "utf8"), "Report 2\n");
    assert.equal(readFileSync(join(digest, "backup/global/old.md"), "utf8"), note("Before"));
    assert.deepEqual(readFileSync(f.cursor), before);
  });
}

test("transcript scan permission errors preserve the last cursor", (t) => {
  const f = setup(t);
  f.invoke(noCall);
  const before = readFileSync(f.cursor);
  const read = fs.readdirSync;
  const mock = t.mock.method(fs, "readdirSync", (path, ...args) => {
    if (path === dirname(f.path)) throw Object.assign(new Error("scan denied"), { code: "EPERM" });
    return read(path, ...args);
  });
  syncBuiltinESMExports();
  try {
    assert.throws(() => f.invoke(noCall), { code: "EPERM" });
    assert.deepEqual(readFileSync(f.cursor), before);
  } finally {
    mock.mock.restore();
    syncBuiltinESMExports();
  }
});

for (const [kind, replacement] of [["shrunk", "New"], ["fewer rows but larger size", "New".repeat(300)]]) {
  test(`dream reads replaced transcripts from the start (${kind})`, (t) => {
    const f = setup(t);
    appendFileSync(f.path, message("Previous".repeat(50)));
    f.invoke(noCall);
    put(f.path, message(replacement) + (kind === "shrunk" ? message("B") + message("C") : ""));
    const result = f.invoke(({ prompt }) => {
      assert.ok(readChunk(prompt).includes(replacement));
      return "Read replacement";
    });
    assert.match(result.out, /Chunks run: 1/);
  });
}

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

  // Unlock does not remove a lock file replaced behind its back
  withDreamLock(lock, () => {
    renameSync(lock, `${lock}.old`);
    put(lock, "replacement\n");
  });
  assert.equal(readFileSync(lock, "utf8"), "replacement\n");
});
