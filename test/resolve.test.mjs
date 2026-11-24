import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { resolveMemoryRoot, resolveProject } from "../packages/core/src/index.js";
import { createFixture, put } from "./fixture.mjs";

function git(f, dir, args, input) {
  const res = spawnSync("git", ["-C", dir, ...args], {
    input,
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: f.home, XDG_CONFIG_HOME: f.home, GIT_CONFIG_NOSYSTEM: "1" },
  });
  if (res.status !== 0) throw new Error(res.stderr);
  return res.stdout.trimEnd();
}

test("explicit directory wins over MEMORA_DIR, which expands home and falls back when blank", (t) => {
  const f = createFixture(t);
  assert.equal(resolveMemoryRoot(f.root, { MEMORA_DIR: "~/override" }, f.home), f.root);
  assert.equal(resolveMemoryRoot("~/explicit", { MEMORA_DIR: "~/override" }, f.home), join(f.home, "explicit"));
  assert.equal(resolveMemoryRoot("", { MEMORA_DIR: "~/override" }, f.home), join(f.home, "override"));
  for (const override of ["", " \t\n", undefined]) {
    assert.equal(resolveMemoryRoot(undefined, override === undefined ? {} : { MEMORA_DIR: override }, f.home), join(f.home, ".agents", "memory"));
  }
  for (const override of ["~", "~/", "~\\"]) {
    assert.equal(resolveMemoryRoot(undefined, { MEMORA_DIR: override }, f.home), f.home);
  }
  for (const override of ["~/memory", "~\\memory"]) {
    assert.equal(resolveMemoryRoot(undefined, { MEMORA_DIR: override }, f.home), join(f.home, "memory"));
  }
});

test("nested repository, linked worktree, and submodule .git files resolve without spawning git", (t) => {
  const f = createFixture(t);
  const main = join(f.cwd, "MainRepo");
  const nested = join(main, "src");
  const worktree = join(f.home, "linked-worktree");
  mkdirSync(nested, { recursive: true });
  git(f, f.cwd, ["init", "--quiet"]);
  git(f, main, ["init", "--quiet"]);
  const tree = git(f, main, ["mktree"], "");
  const commit = git(f, main, ["-c", "user.name=Test", "-c", "user.email=test@example.test", "commit-tree", tree, "-m", "initial"]);
  git(f, main, ["worktree", "add", "--quiet", "--detach", worktree, commit]);

  const folder = join(f.root, "projects", "MainRepo");
  assert.deepEqual(resolveProject(f.root, nested, f.home), { slug: "MainRepo", folder, exists: false });
  assert.deepEqual(resolveProject(f.root, worktree, f.home), { slug: "MainRepo", folder, exists: false });
  mkdirSync(folder, { recursive: true });
  assert.deepEqual(resolveProject(f.root, worktree, f.home), { slug: "MainRepo", folder, exists: true });

  // Submodule-style .git file (no commondir file) resolves to the submodule directory name
  const sub = join(main, "vendor", "SubPkg");
  put(join(sub, ".git"), "gitdir: ../../.git/modules/SubPkg\n");
  mkdirSync(join(main, ".git", "modules", "SubPkg"), { recursive: true });
  assert.deepEqual(resolveProject(f.root, sub, f.home), {
    slug: "SubPkg",
    folder: join(f.root, "projects", "SubPkg"),
    exists: false,
  });
});

test("outside git, the closest matching folder wins and home itself does not count", (t) => {
  const f = createFixture(t);
  const nested = join(f.cwd, "src", "nested");
  mkdirSync(nested, { recursive: true });
  mkdirSync(join(f.root, "projects", "home"), { recursive: true });
  assert.deepEqual(resolveProject(f.root, nested, f.home), { slug: null, folder: null, exists: false });

  const project = join(f.root, "projects", "work");
  mkdirSync(project, { recursive: true });
  assert.deepEqual(resolveProject(f.root, f.cwd, f.home), { slug: "work", folder: project, exists: true });
  assert.deepEqual(resolveProject(f.root, nested, f.home), { slug: "work", folder: project, exists: true });

  const closer = join(f.root, "projects", "src");
  mkdirSync(closer, { recursive: true });
  assert.deepEqual(resolveProject(f.root, nested, f.home), { slug: "src", folder: closer, exists: true });
});
