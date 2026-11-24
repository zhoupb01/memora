import { lstatSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { userHome } from "./root.js";

function findGitSlug(cwd) {
  for (let dir = cwd; ; ) {
    const dotGit = join(dir, ".git");
    const stat = lstatSync(dotGit, { throwIfNoEntry: false });
    if (stat?.isDirectory()) return basename(dir);
    if (stat?.isFile()) {
      const raw = readFileSync(dotGit, "utf8");
      const match = /^gitdir:\s*(.+?)\s*$/m.exec(raw);
      if (match) {
        const gitDir = resolve(dir, match[1]);
        try {
          const commonRel = readFileSync(join(gitDir, "commondir"), "utf8").trim();
          if (commonRel) return basename(dirname(resolve(gitDir, commonRel)));
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
        return basename(dir);
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function resolveProject(root, directory = process.cwd(), home = userHome()) {
  const cwd = resolve(directory);
  const gitSlug = findGitSlug(cwd);
  if (gitSlug !== null) {
    const folder = join(root, "projects", gitSlug);
    const exists = statSync(folder, { throwIfNoEntry: false })?.isDirectory() ?? false;
    return { slug: gitSlug, folder, exists };
  }

  const resolvedHome = resolve(home);
  for (let ancestor = cwd; ancestor !== resolvedHome && dirname(ancestor) !== ancestor; ancestor = dirname(ancestor)) {
    const slug = basename(ancestor);
    const folder = join(root, "projects", slug);
    if (statSync(folder, { throwIfNoEntry: false })?.isDirectory()) {
      return { slug, folder, exists: true };
    }
  }
  return { slug: null, folder: null, exists: false };
}
