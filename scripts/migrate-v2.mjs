#!/usr/bin/env node
import { lstatSync, mkdirSync, renameSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import {
  folderEntries,
  indexFile,
  isMapping,
  noteFiles,
  nowFile,
  readIndex,
  readNote,
  resolveMemoryRoot,
  stringifyFrontmatter,
  syncIndexes,
} from "../packages/core/src/index.js";

const usage = "Usage: node scripts/migrate-v2.mjs <memory-root>";
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
  ].map((slug) => [`projects-${slug}`, slug]),
  ["stocks", "stocks"],
  ["tietie-materials", "tietie-materials"],
  ["wx-kit", "wx-kit"],
]);

const memora = ["projects", "memora"];
const catchAll = new Map([
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

function requireFree(path, futurePath = path) {
  if (lstatSync(path, { throwIfNoEntry: false })) {
    throw new Error(`Destination already exists: ${futurePath}`);
  }
}

function planMigration(root) {
  const global = join(root, "global");
  const projects = join(root, "projects");
  const writes = [];
  const untouched = [];
  const renamedFolders = [];
  const rehomedNotes = [];
  const renamedNow = [];
  const removedFolders = [];
  const oldBySlug = new Map();
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

  function normalize(path, { name, description, section, destination = path }) {
    const { fields, body, issue } = readNote(path);
    if (!fields) {
      untouched.push({ path: relative(root, path), destination, issue });
      return;
    }
    const clean = {
      name: name ?? fields.name,
      description: description ?? fields.description,
      type: fields.type ?? (isMapping(fields.metadata) ? fields.metadata.type : undefined),
    };
    if (section !== undefined) clean.section = section;
    const frontmatter = stringifyFrontmatter(clean);
    writes.push({ path, contents: Buffer.concat([Buffer.from(`---\n${frontmatter}---\n`), body]) });
  }

  function normalizeFolder(folder, globalNotes, destination = folder) {
    for (const directory of [folder, join(folder, "archive")]) {
      if (!lstatSync(directory, { throwIfNoEntry: false })?.isDirectory()) continue;
      const { entries } = readIndex(join(directory, indexFile));
      for (const file of noteFiles(directory)) {
        const entry = entries.get(file);
        const name = directory === folder && file === openThreads ? "现在做到哪" : entry?.name;
        normalize(join(directory, file), {
          name,
          description: entry?.description,
          section: globalNotes ? entry?.section : undefined,
          destination: join(destination, relative(folder, directory), file),
        });
      }
    }
    if (!globalNotes && lstatSync(join(folder, openThreads), { throwIfNoEntry: false })) {
      requireFree(join(folder, nowFile), join(destination, nowFile));
      renamedNow.push({ source: join(destination, openThreads), destination: join(destination, nowFile) });
    }
  }

  if (lstatSync(global, { throwIfNoEntry: false })) normalizeFolder(global, true);
  for (const { source, destination } of renamedFolders) normalizeFolder(source, false, destination);

  for (const [name, targets] of catchAll) {
    const folder = join(projects, name);
    if (!lstatSync(folder, { throwIfNoEntry: false })) continue;
    const { entries } = readIndex(join(folder, indexFile));
    const expected = new Set(targets.map((target) => target.file));
    for (const entry of folderEntries(folder)) {
      if (entry.name !== indexFile && !expected.has(entry.name)) {
        throw new Error(`Unexpected catch-all entry: ${join(folder, entry.name)}`);
      }
    }
    for (const target of targets) {
      const source = join(folder, target.file);
      if (!lstatSync(source, { throwIfNoEntry: false })?.isFile()) {
        throw new Error(`Expected a regular file for catch-all note: ${source}`);
      }
      const futureFolder = join(root, ...target.folder);
      const destination = join(futureFolder, target.file);
      const mapped = target.folder[0] === "projects" ? oldBySlug.get(target.folder[1]) : undefined;
      if (target.folder[0] === "projects" && !mapped) throw new Error(`Missing project folder: ${target.folder[1]}`);
      const checkFolder = mapped ? join(mapped, ...target.folder.slice(2)) : futureFolder;
      requireFree(join(checkFolder, target.file), destination);
      const entry = entries.get(target.file);
      normalize(source, { name: entry?.name, description: entry?.description, section: target.section, destination });
      rehomedNotes.push({ source, destination });
    }
    removedFolders.push(folder);
  }

  return { writes, untouched, renamedFolders, rehomedNotes, renamedNow, removedFolders };
}

export function migrateV2(directory, { stdout = process.stdout, stderr = process.stderr } = {}) {
  if (!directory?.trim()) throw new Error(usage);
  const root = resolveMemoryRoot(directory);
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
  const untouchedFolders = new Set(plan.untouched.map(({ destination }) => dirname(destination)));
  for (const { destination } of plan.renamedFolders) {
    const archive = join(destination, "archive");
    if (!untouchedFolders.has(archive)) rmSync(join(archive, indexFile), { force: true });
  }
  syncIndexes(root, { stdout, stderr });
  stdout.write(
    `Notes normalized: ${plan.writes.length}\n` +
    `Folders renamed: ${plan.renamedFolders.length}\n` +
    `Notes rehomed: ${plan.rehomedNotes.length}\n` +
    `Files left untouched: ${plan.untouched.length}\n`,
  );
  for (const { path, issue } of plan.untouched) {
    stdout.write(`  ${path}: ${issue}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !args[0].trim()) {
    console.error(usage);
    process.exit(1);
  }
  try {
    migrateV2(args[0]);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
