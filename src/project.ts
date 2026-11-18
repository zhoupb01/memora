import { statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

export function resolveProject(root: string, directory = process.cwd()) {
  const cwd = resolve(directory);
  const git = Bun.spawnSync(["git", "-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (git.exitCode === 0) {
    const slug = basename(dirname(git.stdout.toString().trimEnd()));
    const folder = join(root, "projects", slug);
    return { slug, folder, exists: statSync(folder, { throwIfNoEntry: false })?.isDirectory() ?? false };
  }

  const home = resolve(homedir());
  for (let ancestor = cwd; ancestor !== home && dirname(ancestor) !== ancestor; ancestor = dirname(ancestor)) {
    const slug = basename(ancestor);
    const folder = join(root, "projects", slug);
    if (statSync(folder, { throwIfNoEntry: false })?.isDirectory()) return { slug, folder, exists: true };
  }
  return { slug: null, folder: null, exists: false };
}
