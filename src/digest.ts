import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveProject } from "./project";
import type { Session } from "./transcripts";

const sessionStart = "=== session:";
const sessionEnd = " ===";
const preamble = `Sessions start with a line "${sessionStart} host | start | cwd | project${sessionEnd}".\n\n`;

export function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function localTimestamp(time: number) {
  if (!Number.isFinite(time)) return "unknown time";
  const date = new Date(time);
  const clock = [date.getHours(), date.getMinutes(), date.getSeconds()].map((part) => String(part).padStart(2, "0")).join(":");
  return `${localDate(date)} ${clock}`;
}

export function writeDigest(root: string, directory: string, sessions: Session[]) {
  const limit = 300_000;
  const path = mkdtempSync(join(directory, "digest-"));
  const chunks: { file: string; projects: string[] }[] = [];
  const projects = new Map<string, string | null>();
  const chunkProjects = new Set<string>();
  let characters = 0;
  let chunk = "";
  function flush() {
    if (!chunk) return;
    const file = join(path, `chunk-${String(chunks.length + 1).padStart(6, "0")}.md`);
    writeFileSync(file, chunk, { mode: 0o600 });
    chunks.push({ file, projects: [...chunkProjects] });
    chunkProjects.clear();
    characters += chunk.length;
    chunk = "";
  }
  for (const { host, cwd, start, turns } of sessions) {
    if (cwd && !projects.has(cwd)) projects.set(cwd, resolveProject(root, cwd).slug);
    const project = projects.get(cwd);
    const title = `${host} | ${localTimestamp(start)} | ${cwd || "unknown cwd"} | ${project ?? "global"}`;
    const header = `${sessionStart} ${title.replaceAll("\r", "\\r").replaceAll("\n", "\\n")}${sessionEnd}\n\n`;
    const blocks = turns.map(({ role, text }) => `**${role === "user" ? "User" : "Assistant"}:**\n\n${text}\n\n`);
    const size = blocks.reduce((sum, block) => sum + block.length, header.length);
    if (chunk.length + size > limit) flush();
    chunk += (chunk ? "" : preamble) + header;
    for (const block of blocks) {
      if (chunk.length + block.length > limit) {
        flush();
        chunk = preamble + header;
      }
      if (project) chunkProjects.add(project);
      chunk += block;
    }
  }
  flush();
  return { path, chunks, characters };
}
