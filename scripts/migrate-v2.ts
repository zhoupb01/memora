import { lstatSync, mkdirSync, renameSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { stringify } from "yaml";
import { folderEntries, indexFile, noteFiles, nowFile, readIndex, type IndexEntry } from "../src/index-file";
import { isMapping, readNote } from "../src/note";
import { resolveMemoryRoot } from "../src/root";
import { syncIndexes } from "../src/sync";

const prefix = "-Users-zhoupb-Documents-";
const projectSlugs = new Map([
  ["Pi", "Pi"],
  ["esp32-lab", "esp32-lab"],
  ["github-reverse-skill", "reverse-skill"],
  ["huahua-materials", "huahua-materials"],
  ["kilimall-business-finance", "business-finance"],
  ["kilimall-finance-projects", "finance-projects"],
  ["kilimall-games", "kilimall-games"],
  ["kilimall-ir-2026-10", "kilimall-ir-2026-10"],
  ["kiro-wacky-ideas", "kiro-wacky-ideas"],
  ...[
    "NotchClip", "hoku", "kili-clip-ai", "kili-finance", "kili-pulse", "kinoshell", "memora", "monopoly-3d",
    "moonparlor", "obol", "peer-drop", "sitetraffic", "tietie", "unidroid", "zhoupb-blog",
  ].map((slug) => [`projects-${slug}`, slug] as const),
  ["stocks", "stocks"],
  ["tietie-materials", "tietie-materials"],
  ["wx-kit", "wx-kit"],
]);

const memora = ["projects", "memora"];
const catchAll = new Map<string, { file: string; folder: string[]; section?: string }[]>([
  [`${prefix}deepseek-harness-default-workspace`, [
    { file: "memora-release-expectations.md", folder: memora },
    { file: "gpt-search-release-expectations.md", folder: ["global"], section: "工具" },
    { file: "chrome-mcp-native-config.md", folder: ["global"], section: "工具" },
    { file: "electric-bicycle-shopping.md", folder: ["global"], section: "生活" },
  ]],
  [`${prefix}projects`, [
    { file: "memory-adapter-parity.md", folder: [...memora, "archive"] },
  ]],
]);
const openThreads = "open-threads.md";

type Move = { source: string; destination: string };

function requireFree(path: string, futurePath = path) {
  if (lstatSync(path, { throwIfNoEntry: false })) throw new Error(`Destination already exists: ${futurePath}`);
}

function planMigration(root: string) {
  const global = join(root, "global");
  const projects = join(root, "projects");
  const writes: { path: string; contents: Buffer }[] = [];
  const untouched: { path: string; issue: string }[] = [];
  const renamedFolders: Move[] = [];
  const rehomedNotes: Move[] = [];
  const renamedNow: Move[] = [];
  const removedFolders: string[] = [];
  const oldBySlug = new Map<string, string>();
  const folders = folderEntries(projects).filter((entry) => entry.isDirectory());

  for (const { name } of folders) {
    if (catchAll.has(name)) continue;
    const slug = name.startsWith(prefix) ? projectSlugs.get(name.slice(prefix.length)) : undefined;
    if (!slug) throw new Error(`Unknown project folder: ${join(projects, name)}`);
    const source = join(projects, name);
    const destination = join(projects, slug);
    requireFree(destination);
    oldBySlug.set(slug, source);
    renamedFolders.push({ source, destination });
  }

  function normalize(path: string, { name, description, section }: Partial<IndexEntry>) {
    const { fields, body, issue } = readNote(path);
    if (!fields) {
      untouched.push({ path: relative(root, path), issue });
      return;
    }
    const frontmatter = stringify({
      name: name ?? fields.name,
      description: description ?? fields.description,
      type: fields.type ?? (isMapping(fields.metadata) ? fields.metadata.type : undefined),
      section,
    }, { lineWidth: 0 });
    writes.push({ path, contents: Buffer.concat([Buffer.from(`---\n${frontmatter}---\n`), body]) });
  }

  function normalizeFolder(folder: string, globalNotes: boolean, destination?: string) {
    const { entries } = readIndex(join(folder, indexFile));
    function normalizeNotes(directory: string) {
      const local = directory === folder ? entries : readIndex(join(directory, indexFile)).entries;
      for (const file of noteFiles(directory)) {
        const path = join(directory, file);
        const entry = local.get(file);
        let name = entry?.name;
        if (directory === folder && destination && file === openThreads) {
          requireFree(join(folder, nowFile), join(destination, nowFile));
          renamedNow.push({ source: join(destination, file), destination: join(destination, nowFile) });
          name = "现在做到哪";
        }
        normalize(path, { ...entry, name, section: globalNotes ? entries.get(relative(folder, path))?.section : undefined });
      }
    }
    function walkArchive(directory: string) {
      normalizeNotes(directory);
      for (const entry of folderEntries(directory)) {
        if (entry.isDirectory()) walkArchive(join(directory, entry.name));
      }
    }
    normalizeNotes(folder);
    walkArchive(join(folder, "archive"));
  }

  normalizeFolder(global, true);
  for (const { source, destination } of renamedFolders) normalizeFolder(source, false, destination);

  for (const { name } of folders) {
    const rules = catchAll.get(name);
    if (!rules) continue;
    const folder = join(projects, name);
    const { entries } = readIndex(join(folder, indexFile));
    const contents = folderEntries(folder);
    for (const entry of contents) {
      if (!entry.isFile() || (entry.name !== indexFile && !rules.some(({ file }) => entry.name === file))) {
        throw new Error(`Unexpected catch-all entry: ${join(folder, entry.name)}`);
      }
    }
    for (const rule of rules) {
      const source = join(folder, rule.file);
      if (!contents.some(({ name }) => name === rule.file)) throw new Error(`Missing catch-all note: ${source}`);
      const destination = join(root, ...rule.folder, rule.file);
      if (rule.folder[0] === "projects") {
        const old = oldBySlug.get(rule.folder[1]);
        if (!old) throw new Error(`Missing destination project: ${join(root, ...rule.folder.slice(0, 2))}`);
        requireFree(join(old, ...rule.folder.slice(2), rule.file), destination);
      } else {
        requireFree(destination);
      }
      normalize(source, { ...entries.get(rule.file), section: rule.section });
      rehomedNotes.push({ source, destination });
    }
    removedFolders.push(folder);
  }

  return { writes, untouched, renamedFolders, rehomedNotes, renamedNow, removedFolders };
}

function migrate(root: string) {
  const plan = planMigration(root);
  for (const { path, contents } of plan.writes) writeFileSync(path, contents);
  for (const { source, destination } of plan.renamedFolders) renameSync(source, destination);
  for (const { source, destination } of plan.rehomedNotes) {
    mkdirSync(dirname(destination), { recursive: true });
    renameSync(source, destination);
  }
  for (const { source, destination } of plan.renamedNow) renameSync(source, destination);
  for (const folder of plan.removedFolders) {
    rmSync(join(folder, indexFile), { force: true });
    rmdirSync(folder);
  }
  syncIndexes(root);
  console.log(`Notes normalized: ${plan.writes.length}`);
  console.log(`Folders renamed: ${plan.renamedFolders.length}`);
  console.log(`Notes rehomed: ${plan.rehomedNotes.length}`);
  console.log(`Files left untouched: ${plan.untouched.length}`);
  for (const { path, issue } of plan.untouched) console.log(`- ${path}: ${issue}`);
}

try {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !args[0].trim()) throw new Error("Usage: bun scripts/migrate-v2.ts <memory-root>");
  migrate(resolveMemoryRoot(args[0]));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
