import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { localDate, writeDigest } from "./digest";
import { trackDreamChanges } from "./dream-changes";
import { withDreamLock } from "./dream-lock";
import { folderEntries } from "./index-file";
import { syncIndexes } from "./sync";
import { collectTranscripts, type Cursor } from "./transcripts";

const defaultModel = "sub2api/gpt-6.2-sol";
type ModelRequest = { root: string; model: string; prompt: string };
type Runner = (request: ModelRequest) => string;
type Options = { root: string; since?: string; dryRun?: boolean; model?: string };

function runPi({ root, model, prompt }: ModelRequest) {
  const result = Bun.spawnSync([
    "pi", "-p", "--model", model, "--thinking", "high", "--no-session", "--no-context-files",
    "--no-extensions", "--no-mcp", "--no-skills", "--no-prompt-templates", "--tools", "read,edit,write,bash", "--", prompt,
  ], { cwd: root, stdin: "ignore" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString().trim() || `pi exited with status ${result.exitCode}`);
  return result.stdout.toString();
}

function saveCursor(path: string, cursor: Cursor) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(cursor, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function parseSince(since?: string) {
  if (since === undefined) return;
  const date = new Date(`${since}T00:00:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || localDate(date) !== since) throw new Error("--since must be a valid local date (YYYY-MM-DD)");
  return date.getTime();
}

export function dream({ root, since, dryRun, model = defaultModel }: Options, runner: Runner = runPi, home = homedir()) {
  const start = parseSince(since);
  const directory = join(root, ".dream");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  withDreamLock(join(directory, "lock"), () => {
    const cursorPath = join(directory, "cursor.json");
    const previous: Cursor | undefined = start === undefined && existsSync(cursorPath) ? JSON.parse(readFileSync(cursorPath, "utf8")) : undefined;
    const { sessions, cursor, totals } = collectTranscripts(home, previous, start);
    const digest = writeDigest(root, directory, sessions);
    console.log(`Sessions: pi ${totals.pi}, DeepSeek Harness ${totals["DeepSeek Harness"]}, Claude Code ${totals["Claude Code"]}`);
    const count = digest.chunks.length;
    console.log(`Size: ${digest.characters} characters, ${count} ${count === 1 ? "chunk" : "chunks"}`);
    console.log(`Digest: ${digest.path}`);
    if (dryRun) return;
    if (!count) {
      syncIndexes(root);
      saveCursor(cursorPath, cursor);
      if (!previous && start === undefined) {
        console.log(`Cursor initialized: ${Object.keys(cursor).length} transcripts`);
      }
      console.log("nothing new");
      return;
    }

    const finish = trackDreamChanges(root);
    const guide = readFileSync(new URL("../DREAM.md", import.meta.url), "utf8");
    const contract = readFileSync(new URL("../CONTRACT.md", import.meta.url), "utf8");
    const today = localDate(new Date());
    const reports: string[] = [];
    for (const [i, chunk] of digest.chunks.entries()) {
      const projects = folderEntries(join(root, "projects")).filter((entry) => entry.isDirectory()).map(({ name }) => name);
      const prompt = `${guide}\nMemory root: ${root}\nDate: ${today}\nProject folders: ${JSON.stringify(projects)}\n` +
        `Projects in this chunk: ${JSON.stringify(chunk.projects)}\nChunk: ${chunk.file}\n\n${contract}`;
      try {
        const report = runner({ root, model, prompt }).trim();
        if (!report) throw new Error("pi returned no report");
        reports.push(report);
      } catch (error) {
        throw new Error(`Dream chunk ${i + 1}/${count} failed: ${error instanceof Error ? error.message : error}`);
      }
    }
    syncIndexes(root);
    const summary = reports.at(-1)!.split(/\r?\n/, 1)[0];
    const { counts, commit, stat } = finish(`dream ${today}: ${summary}`);
    saveCursor(cursorPath, cursor);
    console.log(`Chunks run: ${reports.length}`);
    console.log(`Notes: ${counts.added} added, ${counts.changed} changed, ${counts.moved} moved, ${counts.deleted} deleted`);
    console.log(`Commit: ${commit ?? "none"}`);
    if (stat) console.log(stat);
    console.log(reports.join("\n\n"));
  });
}
