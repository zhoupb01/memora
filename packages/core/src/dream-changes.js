import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { folderEntries, noteFiles } from "./index-file.js";

function snapshotNotes(root) {
  const result = new Map();
  function walk(relDir) {
    const absDir = join(root, ...relDir.split("/"));
    for (const file of noteFiles(absDir)) {
      const relPath = posix.join(relDir, file);
      const bytes = readFileSync(join(absDir, file));
      const hash = createHash("sha256").update(bytes).digest("hex");
      result.set(relPath, { hash, bytes });
    }
    for (const entry of folderEntries(absDir)) {
      if (entry.isDirectory()) walk(posix.join(relDir, entry.name));
    }
  }
  walk("global");
  walk("projects");
  return result;
}

export function trackDreamChanges(root, backupRoot) {
  const before = snapshotNotes(root);

  return () => {
    const after = snapshotNotes(root);
    const counts = { added: 0, changed: 0, moved: 0, deleted: 0 };
    const removedByHash = new Map();
    const toBackup = [];

    for (const [relPath, prev] of before) {
      const next = after.get(relPath);
      if (!next) {
        const list = removedByHash.get(prev.hash) ?? [];
        list.push({ relPath, bytes: prev.bytes });
        removedByHash.set(prev.hash, list);
      } else if (next.hash !== prev.hash) {
        counts.changed++;
        toBackup.push({ relPath, bytes: prev.bytes });
      }
    }

    for (const [relPath, next] of after) {
      if (before.has(relPath)) continue;
      const list = removedByHash.get(next.hash);
      if (list?.length) {
        list.pop();
        counts.moved++;
      } else {
        counts.added++;
      }
    }

    for (const list of removedByHash.values()) {
      for (const item of list) {
        counts.deleted++;
        toBackup.push(item);
      }
    }

    let backupPath;
    if (backupRoot && toBackup.length > 0) {
      backupPath = backupRoot;
      for (const { relPath, bytes } of toBackup) {
        const dest = join(backupRoot, ...relPath.split("/"));
        mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
        writeFileSync(dest, bytes, { mode: 0o600 });
      }
    }

    return { counts, backupPath };
  };
}
