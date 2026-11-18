import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

/**
 * Resolve the shared memory root from configuration, environment, or home.
 * @param {string} [directory]
 */
export function resolveMemoryRoot(directory, env = process.env, home = homedir()) {
  const override = directory?.trim() ? directory : env.MEMORA_DIR;
  if (!override?.trim()) return resolve(home, ".agents", "memory");
  if (override === "~" || /^~[/\\]/.test(override)) return resolve(join(home, override.slice(2)));
  return resolve(override);
}

function findProjectRoot(cwd) {
  let root = resolve(cwd);
  while (!existsSync(join(root, ".git"))) {
    const parent = dirname(root);
    if (parent === root) return resolve(cwd);
    root = parent;
  }
  return root;
}

function projectKey(root) {
  return process.platform === "win32"
    ? root.replaceAll("/", "-").replaceAll("\\", "-").replaceAll(":", "-")
    : root.replaceAll("/", "-");
}

function readIndex(folder) {
  let content;
  try {
    content = readFileSync(join(folder, "MEMORY.md"), "utf8").trimEnd();
  } catch (error) {
    if (error.code === "ENOENT") return "(no memories yet)";
    throw error;
  }
  if (!content) return "(no memories yet)";
  const lines = content.split("\n");
  return lines.length > 200
    ? `${lines.slice(0, 200).join("\n")}\n(MEMORY.md is over 200 lines; the rest is not shown. Move outdated entries to cold storage to bring it back under 200 lines.)`
    : content;
}

function countArchive(archive) {
  try {
    return readdirSync(archive).filter((name) => name.endsWith(".md")).length;
  } catch (error) {
    if (error.code === "ENOENT") return 0;
    throw error;
  }
}

/**
 * Render the complete memory section for one model request.
 * The adapter supplies its memory root and the session's current cwd. Each call
 * re-reads the bundled guide and indexes; no cache, file writes, or model calls.
 * Missing indexes/archives are empty; other I/O failures propagate to the host.
 */
export function buildMemoryPrompt({ root, cwd, today = new Date() }) {
  const guide = readFileSync(new URL("./GUIDE.md", import.meta.url), "utf8").trimEnd();
  const projectRoot = findProjectRoot(cwd);
  const globalFolder = join(root, "global");
  const projectFolder = join(root, "projects", projectKey(projectRoot));
  const globalArchive = join(globalFolder, "archive");
  const projectArchive = join(projectFolder, "archive");
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  return `${guide}

## Current state

- Today is ${date}
- Global memory folder: ${globalFolder}
- Global cold storage: ${globalArchive} (${countArchive(globalArchive)} memories)
- Project memory folder: ${projectFolder} (project: ${projectRoot})
- Project cold storage: ${projectArchive} (${countArchive(projectArchive)} memories)

### Global MEMORY.md

${readIndex(globalFolder)}

### Project MEMORY.md

${readIndex(projectFolder)}`;
}

/** Read the shared /dream template, without exposing its YAML frontmatter to the model. */
export function readDreamTemplate() {
  const text = readFileSync(new URL("./dream.md", import.meta.url), "utf8");
  const match = /^---\r?\ndescription: (.+)\r?\n---\r?\n([\s\S]+)$/.exec(text);
  if (!match || !match[2].trim()) throw new Error("Invalid dream.md prompt template");
  return { description: match[1], text: match[2].trimEnd() };
}
