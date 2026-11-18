import { readFileSync } from "node:fs";
import { join } from "node:path";
import { folderEntries, indexFile, noteFiles } from "./index-file";

const memoryPaths = [".", ":(exclude).dream"];
const exactRenames = "-M100%";
const empty = () => ({ added: 0, changed: 0, moved: 0, deleted: 0 });
const isNote = (path: string) => /^(global|projects)\//.test(path) && path.endsWith(".md") && path.split("/").at(-1) !== indexFile;

function git(root: string, args: string[], allowOutside = false) {
  const result = Bun.spawnSync(["git", "-C", root, ...args]);
  if (result.exitCode === 0) return result.stdout.toString();
  const error = result.stderr.toString().trim();
  if (allowOutside && error.includes("not a git repository")) return;
  throw new Error(error || `git ${args[0]} exited with status ${result.exitCode}`);
}

function notes(root: string) {
  const result = new Map<string, string>();
  function walk(directory: string) {
    for (const file of noteFiles(join(root, directory))) {
      const path = join(directory, file);
      result.set(path, new Bun.CryptoHasher("sha256").update(readFileSync(join(root, path))).digest("hex"));
    }
    for (const entry of folderEntries(join(root, directory))) {
      if (entry.isDirectory()) walk(join(directory, entry.name));
    }
  }
  walk("global");
  walk("projects");
  return result;
}

function compare(before: Map<string, string>, after: Map<string, string>) {
  const counts = empty();
  const removed = new Map<string, number>();
  for (const [path, hash] of before) {
    if (!after.has(path)) {
      counts.deleted++;
      removed.set(hash, (removed.get(hash) ?? 0) + 1);
    } else if (after.get(path) !== hash) counts.changed++;
  }
  for (const [path, hash] of after) {
    if (before.has(path)) continue;
    const matches = removed.get(hash) ?? 0;
    if (matches) {
      removed.set(hash, matches - 1);
      counts.deleted--;
      counts.moved++;
    } else counts.added++;
  }
  return counts;
}

export function trackDreamChanges(root: string) {
  const inGit = git(root, ["rev-parse", "--is-inside-work-tree"], true)?.trim() === "true";
  const before = inGit ? undefined : notes(root);
  return (summary: string) => {
    if (before) return { counts: compare(before, notes(root)), commit: undefined, stat: undefined };
    const counts = empty();
    if (!git(root, ["status", "--porcelain", "--untracked-files=all", "--", ...memoryPaths])) {
      return { counts, commit: undefined, stat: undefined };
    }
    git(root, ["add", "-A", "--", ...memoryPaths]);
    git(root, ["commit", "--only", "-m", summary, "--", ...memoryPaths]);
    const commit = git(root, ["rev-parse", "HEAD"])!.trim();
    const stat = git(root, ["show", "--relative", "--format=", "--stat", exactRenames, commit, "--", ...memoryPaths])!.trimEnd();
    const entries = git(root, ["show", "--relative", "--format=", "--name-status", "-z", exactRenames, commit, "--", ...memoryPaths])!.split("\0");
    for (let i = 0; entries[i];) {
      const status = entries[i++][0];
      const path = entries[i++];
      if (status === "R") {
        const destination = entries[i++];
        if (isNote(path) && isNote(destination)) counts.moved++;
        else if (isNote(path)) counts.deleted++;
        else if (isNote(destination)) counts.added++;
      } else if (isNote(path)) {
        if (status === "A") counts.added++;
        else if (status === "D") counts.deleted++;
        else counts.changed++;
      }
    }
    return { counts, commit, stat };
  };
}
