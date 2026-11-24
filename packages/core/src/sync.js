import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { folderEntries, indexFile, noteFiles, nowFile, readIndex } from "./index-file.js";
import { noteTypes, oneLine, readNote } from "./note.js";

const uncategorized = "未分类";
const maxDescription = 150;
export const maxIndexLines = 200;
export const maxIndexBytes = 25_000;

export function writeAtomic(path, content, mode = 0o666) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, content, { mode, flag: "wx" });
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
}

export function syncIndexes(root, { quiet = false, stdout = process.stdout, stderr = process.stderr } = {}) {
  let written = 0;
  let unchanged = 0;
  let warnings = 0;
  function warn(path, issue) {
    warnings++;
    if (!quiet) stderr.write(`${path}: ${issue}\n`);
  }

  function syncFolder(folder, global) {
    const files = noteFiles(folder);
    const index = join(folder, indexFile);
    const previous = readIndex(index);
    if (!global && !files.length && previous.content === undefined) return;
    const sections = previous.sections;
    const notes = new Map(files.map((file) => {
      const path = join(folder, file);
      const { body, issue, fields } = readNote(path);
      const { name, description, type, section } = fields ?? {};
      const group = oneLine(section) ? section : uncategorized;
      sections.add(group);
      const validType = noteTypes.includes(type);
      if (!issue && oneLine(name) && oneLine(description) && validType) {
        if ([...description].length > maxDescription) {
          warn(path, `description exceeds ${maxDescription} characters`);
        }
        return [file, { line: `- [${name}](${file}) — ${description}`, group }];
      }
      const missing = [!oneLine(name) && "name", !oneLine(description) && "description", !validType && "type"].filter(Boolean);
      warn(path, issue ?? `missing or invalid frontmatter: ${missing.join(", ")}`);
      const firstLine = file === nowFile ? "" : body.toString("utf8").split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
      const fallback = [...firstLine].slice(0, maxDescription).join("");
      return [file, { line: `- [${basename(file, ".md")}](${file}) — ${fallback}`, group }];
    }));

    const order = new Set([...(global ? [] : [nowFile]), ...previous.entries.keys(), ...files]);
    const ordered = [...order].flatMap((file) => notes.get(file) ?? []);
    const lines = [];
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
    if (lines.length > maxIndexLines) {
      warn(index, `index exceeds ${maxIndexLines} lines (${lines.length})`);
    }
    if (content === previous.content) {
      unchanged++;
      return;
    }

    mkdirSync(folder, { recursive: true });
    writeAtomic(index, content);
    written++;
  }

  syncFolder(join(root, "global"), true);
  const projects = join(root, "projects");
  for (const entry of folderEntries(projects)) {
    if (entry.isDirectory()) syncFolder(join(projects, entry.name), false);
  }
  if (!quiet) {
    stdout.write(`Indexes: ${written} written, ${unchanged} unchanged; ${warnings} warnings\n`);
  }
  return { written, unchanged, warnings };
}
