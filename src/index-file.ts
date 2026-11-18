import { readdirSync, readFileSync } from "node:fs";

export const indexFile = "MEMORY.md";
export const nowFile = "NOW.md";

export type IndexEntry = { name: string; description: string; section?: string };

function onMissing<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export function folderEntries(folder: string) {
  return (onMissing(() => readdirSync(folder, { withFileTypes: true })) ?? [])
    .sort((a, b) => (a.name > b.name ? 1 : a.name < b.name ? -1 : 0));
}

export function noteFiles(folder: string) {
  return folderEntries(folder)
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== indexFile)
    .map((entry) => entry.name);
}

export function readIndex(path: string) {
  const content = onMissing(() => readFileSync(path, "utf8"));
  const sections = new Set<string>();
  const entries = new Map<string, IndexEntry>();
  let section: string | undefined;
  for (const line of content?.split(/\r?\n/) ?? []) {
    if (line.startsWith("## ")) {
      section = line.slice(3);
      sections.add(section);
    } else {
      const link = /^- \[(.+)\]\((.+\.md)\) — (.*)$/.exec(line);
      if (link && !entries.has(link[2])) entries.set(link[2], { name: link[1], description: link[3], section });
    }
  }
  return { content, sections, entries };
}
