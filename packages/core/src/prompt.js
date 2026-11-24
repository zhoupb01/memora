import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { indexFile } from "./index-file.js";
import { resolveProject } from "./project.js";
import { userHome } from "./root.js";
import { maxIndexBytes, maxIndexLines, syncIndexes } from "./sync.js";

const overflowNotice = "(MEMORY.md exceeds 200 lines or 25 KB; run /dream to archive old notes.)";

export function readResource(name) {
  const adjacent = new URL(`./${name}`, import.meta.url);
  if (existsSync(adjacent)) return readFileSync(adjacent, "utf8");
  return readFileSync(new URL(`../../../${name}`, import.meta.url), "utf8");
}

export function formatIndex(folder) {
  let raw;
  try {
    raw = readFileSync(join(folder, indexFile), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "(empty)";
    throw error;
  }
  const normalized = raw.replace(/\r\n/g, "\n").trimEnd();
  if (!normalized) return "(empty)";

  const lines = normalized.split("\n");
  if (lines.length <= maxIndexLines && Buffer.byteLength(normalized) <= maxIndexBytes) return normalized;

  const budget = maxIndexBytes - Buffer.byteLength(overflowNotice) - 1;
  const kept = [];
  let bytes = 0;
  for (const line of lines) {
    const added = (kept.length ? 1 : 0) + Buffer.byteLength(line, "utf8");
    if (kept.length >= maxIndexLines - 1 || bytes + added > budget) break;
    kept.push(line);
    bytes += added;
  }
  if (!kept.length) {
    let slice = "";
    for (const ch of lines[0]) {
      bytes += Buffer.byteLength(ch);
      if (bytes > budget) break;
      slice += ch;
    }
    kept.push(slice);
  }
  return [...kept, overflowNotice].join("\n");
}

export function renderContract(root) {
  return readResource("CONTRACT.md")
    .trimEnd()
    .replaceAll("`~/.agents/memory/`", `\`${root}/\``);
}

export function buildMemoryPrompt({ root, cwd = process.cwd(), home = userHome() }) {
  syncIndexes(root, { quiet: true });
  const contract = renderContract(root);
  const globalFolder = join(root, "global");
  const project = resolveProject(root, cwd, home);
  const globalSection = `## Global (\`${globalFolder}\`)\n\n${formatIndex(globalFolder)}`;
  const projectSection = project.folder
    ? `## Project (\`${project.folder}\`)\n\n${formatIndex(project.folder)}`
    : "## Project\n\n(none — outside a project repository)";
  return `${contract}\n\n${globalSection}\n\n${projectSection}`;
}
