import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { cli, fixture } from "./fixture";

function git(f: ReturnType<typeof fixture>, dir: string, args: string[], stdin?: string) {
  const result = Bun.spawnSync(["git", "-C", dir, ...args], {
    stdin: stdin === undefined ? undefined : new TextEncoder().encode(stdin),
    env: { PATH: process.env.PATH, HOME: f.home, XDG_CONFIG_HOME: f.home, GIT_CONFIG_NOSYSTEM: "1" },
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trimEnd();
}

test("--root wins over MEMORA_DIR, which expands home and falls back when blank", () => {
  const f = fixture();
  git(f, f.cwd, ["init", "--quiet"]);
  const folder = (root: string) => join(root, "projects", "work") + "\n";
  expect(cli(f, ["resolve", "--root", f.root], "~/override").out).toBe(folder(f.root));
  expect(cli(f, ["resolve", "--root", "~/explicit"], "~/override").out).toBe(folder(join(f.home, "explicit")));
  expect(cli(f, ["resolve", "--root", ""], "~/override").out).toBe(folder(f.cwd));
  for (const override of ["", " \t\n", undefined]) {
    expect(cli(f, ["resolve"], override).out).toBe(folder(join(f.home, ".agents", "memory")));
  }
  for (const override of ["~", "~/", "~\\"]) {
    expect(cli(f, ["resolve"], override).out).toBe(folder(f.home));
  }
  for (const override of ["~/memory", "~\\memory"]) {
    expect(cli(f, ["resolve"], override).out).toBe(folder(join(f.home, "memory")));
  }
});

test("a nested repository and its linked worktree use the same case-sensitive slug", () => {
  const f = fixture();
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
  expect(cli(f, ["resolve", nested, "--root", f.root])).toEqual({ code: 0, out: `${folder}\n`, err: "" });
  expect(JSON.parse(cli(f, ["resolve", worktree, "--json", "--root", f.root]).out)).toEqual({
    slug: "MainRepo", folder, exists: false,
  });
  mkdirSync(folder, { recursive: true });
  expect(JSON.parse(cli(f, ["resolve", worktree, "--json", "--root", f.root]).out)).toEqual({
    slug: "MainRepo", folder, exists: true,
  });
});

test("outside git, the closest matching folder wins and home itself does not count", () => {
  const f = fixture();
  const nested = join(f.cwd, "src", "nested");
  mkdirSync(nested, { recursive: true });
  const resolve = (...args: string[]) => cli(f, ["resolve", "--root", f.root, ...args]);
  mkdirSync(join(f.root, "projects", "home"), { recursive: true });
  expect(resolve(nested)).toEqual({ code: 0, out: "", err: "" });
  expect(JSON.parse(resolve(nested, "--json").out)).toEqual({ slug: null, folder: null, exists: false });
  const project = join(f.root, "projects", "work");
  mkdirSync(project);
  expect(resolve().out).toBe(`${project}\n`);
  expect(resolve(nested).out).toBe(`${project}\n`);
  const closer = join(f.root, "projects", "src");
  mkdirSync(closer);
  expect(resolve(nested).out).toBe(`${closer}\n`);
});
