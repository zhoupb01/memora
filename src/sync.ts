import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { folderEntries, indexFile, noteFiles, nowFile, readIndex } from "./index-file";
import { noteTypes, oneLine, readNote } from "./note";

const uncategorized = "未分类";
const maxDescription = 150;
const maxIndexLines = 200;

export function syncIndexes(root: string) {
  let written = 0;
  let unchanged = 0;
  let warnings = 0;
  function warn(path: string, issue: string) {
    warnings++;
    console.error(`${path}: ${issue}`);
  }

  function syncFolder(folder: string, global: boolean) {
    const files = noteFiles(folder);
    if (!global && files.length === 0) return;
    const index = join(folder, indexFile);
    const previous = readIndex(index);
    const sections = previous.sections;
    const notes = new Map(files.map((file) => {
      const path = join(folder, file);
      const { body, issue, fields } = readNote(path);
      const { name, description, type, section } = fields ?? {};
      const group = oneLine(section) ? section : uncategorized;
      sections.add(group);
      const validType = noteTypes.some((value) => value === type);
      if (!issue && oneLine(name) && oneLine(description) && validType) {
        if ([...description].length > maxDescription) warn(path, `description exceeds ${maxDescription} characters`);
        return [file, { line: `- [${name}](${file}) — ${description}`, group }];
      }
      const missing = [!oneLine(name) && "name", !oneLine(description) && "description", !validType && "type"].filter(Boolean);
      warn(path, issue ?? `missing or invalid frontmatter: ${missing.join(", ")}`);
      const firstLine = body.toString("utf8").split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
      const fallback = [...firstLine].slice(0, maxDescription).join("");
      return [file, { line: `- [${basename(file, ".md")}](${file}) — ${fallback}`, group }];
    }));

    const order = new Set([...(global ? [] : [nowFile]), ...previous.entries.keys(), ...files]);
    const ordered = [...order].flatMap((file) => notes.get(file) ?? []);
    const lines: string[] = [];
    if (global) {
      sections.delete(uncategorized);
      sections.add(uncategorized);
      const groups = Map.groupBy(ordered, (note) => note.group);
      for (const section of sections) {
        const entries = groups.get(section);
        if (!entries?.length) continue;
        if (lines.length) lines.push("");
        lines.push(`## ${section}`, ...entries.map((note) => note.line));
      }
    } else {
      lines.push(...ordered.map((note) => note.line));
    }
    const content = lines.length ? `${lines.join("\n")}\n` : "";
    if (lines.length > maxIndexLines) warn(index, `index exceeds ${maxIndexLines} lines (${lines.length})`);
    if (content === previous.content) {
      unchanged++;
      return;
    }

    mkdirSync(folder, { recursive: true });
    const temp = join(folder, `.${indexFile}.${randomUUID()}.tmp`);
    try {
      writeFileSync(temp, content, { flag: "wx" });
      renameSync(temp, index);
    } finally {
      rmSync(temp, { force: true });
    }
    written++;
  }

  syncFolder(join(root, "global"), true);
  const projects = join(root, "projects");
  for (const entry of folderEntries(projects)) {
    if (entry.isDirectory()) syncFolder(join(projects, entry.name), false);
  }
  console.log(`Indexes: ${written} written, ${unchanged} unchanged; ${warnings} warnings`);
}
