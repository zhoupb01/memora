import { appendFileSync, existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync, utimesSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, spyOn, test } from "bun:test";
import { dream } from "../src/dream";
import { cli, fixture, put } from "./fixture";

const time = "2026-11-17T12:00:00Z";
const line = (record: unknown) => JSON.stringify(record) + "\n";
const message = (text: string) => line({ type: "message", timestamp: time, message: { role: "user", content: [{ type: "text", text }] } });
const note = (name: string) => `---\nname: ${name}\ndescription: hook\ntype: user\nsection: Work\n---\nBody\n`;

function setup() {
  const f = fixture();
  const path = join(f.home, ".pi", "agent", "sessions", "project", "session.jsonl");
  put(path, line({ type: "session", timestamp: time, cwd: "/example/work" }) + message("Already there"));
  const cursor = join(f.root, ".dream", "cursor.json");
  const invoke = (runner: NonNullable<Parameters<typeof dream>[1]>, options = {}) => dream({ root: f.root, ...options }, runner, f.home);
  return { ...f, path, cursor, invoke };
}

function chunk(prompt: string) {
  const path = /^Chunk: (.+)$/m.exec(prompt)?.[1];
  if (!path) throw new Error("Missing chunk path");
  return readFileSync(path, "utf8");
}

const noCall = () => { throw new Error("Unexpected model call"); };

test("first run records the baseline; a new record is sent once and sync runs", () => {
  const f = setup();
  const first = cli(f, ["dream", "--root", f.root]);
  expect(first.code).toBe(0);
  expect(first.out).toContain("Cursor initialized: 1 transcripts");
  expect(JSON.parse(readFileSync(f.cursor, "utf8"))[f.path].records).toBe(2);
  appendFileSync(f.path, message("Appended"));
  f.invoke(({ prompt, model }) => {
    expect(model).toBe("sub2api/gpt-6.2-sol");
    expect(chunk(prompt)).toContain("Appended");
    expect(chunk(prompt)).not.toContain("Already there");
    put(join(f.root, "global", "new.md"), note("New"));
    return "Saved note\nAdded new.md: supported by the user.";
  });
  expect(readFileSync(join(f.root, "global", "MEMORY.md"), "utf8")).toContain("[New](new.md)");
  expect(JSON.parse(readFileSync(f.cursor, "utf8"))[f.path].records).toBe(3);
  const before = readFileSync(f.cursor, "utf8");
  f.invoke(noCall);
  expect(readFileSync(f.cursor, "utf8")).toBe(before);
});

test("an empty digest saves new tool records so the unchanged file is skipped next time", () => {
  const f = setup();
  f.invoke(noCall);
  appendFileSync(f.path, line({ type: "message", timestamp: time, message: { role: "toolResult" } }));
  const fixedTime = new Date(time);
  utimesSync(f.path, fixedTime, fixedTime);
  const { size, mtimeMs: mtime } = statSync(f.path);

  const result = cli(f, ["dream", "--root", f.root]);
  expect(result.code).toBe(0);
  expect(result.out).toContain("nothing new");
  expect(JSON.parse(readFileSync(f.cursor, "utf8"))[f.path]).toEqual({ size, mtime, records: 3 });

  // Same stat, invalid JSONL: the next run fails if it reads the file again.
  put(f.path, "x".repeat(size - 1) + "\n");
  utimesSync(f.path, fixedTime, fixedTime);
  f.invoke(noCall);
  expect(JSON.parse(readFileSync(f.cursor, "utf8"))[f.path].records).toBe(3);
});

test("unchanged size and mtime skip reading; --since bypasses the cursor", () => {
  const f = setup();
  const bad = join(dirname(f.path), "unreadable.jsonl");
  put(bad, "invalid JSONL\n");
  const { size, mtimeMs: mtime } = statSync(bad);
  put(f.cursor, JSON.stringify({ [bad]: { size, mtime, records: 1 } }));
  f.invoke(({ prompt }) => {
    expect(chunk(prompt)).toContain("Already there");
    return "Read session";
  });
  expect(() => f.invoke(noCall, { since: "2026-11-17", dryRun: true })).toThrow("invalid JSONL");
  rmSync(bad);
  const before = readFileSync(f.cursor, "utf8");
  const dry = cli(f, ["dream", "--root", f.root, "--dry-run", "--since", "2026-11-17"]);
  expect(dry.code).toBe(0);
  expect(dry.out).toContain("Sessions: pi 1");
  expect(readFileSync(f.cursor, "utf8")).toBe(before);
  f.invoke(({ model, prompt }) => {
    expect(model).toBe("test/model");
    expect(chunk(prompt)).toContain("Already there");
    return "Replayed session";
  }, { since: "2026-11-17", model: "test/model" });
  expect(Object.keys(JSON.parse(readFileSync(f.cursor, "utf8")))).toEqual([f.path]);
});

test("a later failed chunk keeps the digest and cursor; retry runs chunks in order", () => {
  const f = setup();
  f.invoke(noCall);
  const before = readFileSync(f.cursor, "utf8");
  for (let i = 0; i < 153; i++) appendFileSync(f.path, message(`${i}: ${"x".repeat(2000)}`));
  let calls = 0;
  expect(() => f.invoke(({ prompt }) => {
    calls++;
    if (calls === 1) {
      expect(chunk(prompt)).toContain("0: xxx");
      return "First chunk done";
    }
    expect(chunk(prompt)).toContain("152: xxx");
    throw new Error("test failure");
  })).toThrow("Dream chunk 2/2 failed: test failure");
  expect(calls).toBe(2);
  expect(readFileSync(f.cursor, "utf8")).toBe(before);
  expect([...new Bun.Glob("digest-*/chunk-*.md").scanSync(dirname(f.cursor))]).toHaveLength(2);
  calls = 0;
  f.invoke(({ prompt }) => {
    expect(chunk(prompt)).toContain(calls++ === 0 ? "0: xxx" : "152: xxx");
    return "Processed chunk";
  });
  expect(calls).toBe(2);
  expect(JSON.parse(readFileSync(f.cursor, "utf8"))[f.path].records).toBe(155);
});

test("a live lock refuses a run; a dead PID is taken over", () => {
  const f = setup();
  const lock = join(f.root, ".dream", "lock");
  put(lock, `${process.pid}\n`);
  const args = ["dream", "--root", f.root, "--dry-run"];
  const live = cli(f, args);
  expect(live.code).not.toBe(0);
  expect(live.err).toContain(`Dream lock is held by PID ${process.pid}`);
  expect(readFileSync(lock, "utf8")).toBe(`${process.pid}\n`);
  expect(readdirSync(dirname(lock))).toEqual(["lock"]);
  const child = Bun.spawnSync([process.execPath, "-e", "console.log(process.pid)"]);
  put(lock, child.stdout);
  const dead = cli(f, args);
  expect(dead.code).toBe(0);
  expect(readFileSync(lock, "utf8")).toBe("");
  expect(existsSync(f.cursor)).toBe(false);
});

test("successful dream commits only the memory root and reports actual note changes", () => {
  const f = setup();
  const repo = dirname(f.root);
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(["git", "-C", repo, "-c", "user.name=Test", "-c", "user.email=test@example.test", ...args], {
      env: { PATH: process.env.PATH, HOME: f.home, XDG_CONFIG_HOME: f.home, GIT_CONFIG_NOSYSTEM: "1" },
    });
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
    return result.stdout.toString().trimEnd();
  };
  const global = join(f.root, "global");
  put(join(global, "delete.md"), note("Delete"));
  put(join(global, "archive.md"), note("Archive"));
  put(join(global, "edit.md"), note("Edit"));
  put(join(repo, "outside.txt"), "Before");
  put(join(repo, ".gitignore"), "/home/\n");
  git("init", "--quiet");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.test");
  const tree = git("mktree");
  const base = git("commit-tree", tree, "-m", "Initialize fixture");
  git("update-ref", "HEAD", base);
  f.invoke(noCall);
  appendFileSync(f.path, message("Commit initial notes"));
  f.invoke(() => "Initial memory");
  const initial = git("rev-parse", "HEAD");
  put(join(repo, "outside.txt"), "Must not commit");
  git("update-index", "--add", "--cacheinfo", `100644,${git("hash-object", "-w", "outside.txt")},outside.txt`);
  appendFileSync(f.path, message("Change notes"));
  const log = spyOn(console, "log").mockImplementation(() => {});
  try {
    f.invoke(({ root, prompt }) => {
      expect(root).toBe(f.root);
      expect(prompt).toContain(`Memory root: ${f.root}`);
      expect(prompt).toContain("# Shared memory");
      expect(prompt).toContain("Project folders:");
      const archive = join(global, "archive", "archive.md");
      put(archive);
      renameSync(join(global, "archive.md"), archive);
      rmSync(join(global, "delete.md"));
      put(join(global, "edit.md"), note("Changed"));
      put(join(global, "add.md"), note("Added"));
      return "Curated notes\nMoved archive.md.";
    });
    expect(log.mock.calls.flat()).toContain("Notes: 1 added, 1 changed, 1 moved, 1 deleted");
  } finally {
    log.mockRestore();
  }
  expect(git("log", "-1", "--format=%s")).toMatch(/^dream \d{4}-\d{2}-\d{2}: Curated notes$/);
  expect(git("diff", "--name-status", "-M100%", initial, "HEAD").split("\n").sort()).toEqual([
    "A\tmemory/global/add.md", "D\tmemory/global/delete.md", "M\tmemory/global/MEMORY.md", "M\tmemory/global/edit.md", "R100\tmemory/global/archive.md\tmemory/global/archive/archive.md",
  ]);
  expect(git("diff", "--cached", "--name-only")).toBe("outside.txt");
  const commit = git("rev-parse", "HEAD");
  appendFileSync(f.path, message("No edits this time"));
  f.invoke(() => "No change");
  expect(git("rev-parse", "HEAD")).toBe(commit);
});
