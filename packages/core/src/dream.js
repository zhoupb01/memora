import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { localDate, writeDigest } from "./digest.js";
import { trackDreamChanges } from "./dream-changes.js";
import { withDreamLock } from "./dream-lock.js";
import { folderEntries } from "./index-file.js";
import { readResource, renderContract } from "./prompt.js";
import { resolveMemoryRoot, userHome } from "./root.js";
import { syncIndexes, writeAtomic } from "./sync.js";
import { collectTranscripts, dreamFollowupEnding } from "./transcripts.js";

export const defaultDreamModel = "sub2api/gpt-6.2-sol";
export const dreamCommandDescription = "Dream — curate shared memory from pi, DeepSeek Harness, and Claude Code transcripts";
export const dreamCommandUsage = "Usage: /dream [--dry-run] [--since YYYY-MM-DD] [--model <id>]";
export const dreamCliUsage = "Usage: dream [--since <YYYY-MM-DD>] [--dry-run] [--model <id>] [--root <dir>]";

export function parseSince(since) {
  if (since === undefined) return undefined;
  const date = new Date(`${since}T00:00:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || localDate(date) !== since) {
    throw new Error("--since must be a valid local date (YYYY-MM-DD)");
  }
  return date.getTime();
}

export function parseDreamArgs(args, { allowRoot = true, usage = dreamCliUsage } = {}) {
  const options = { dryRun: false };
  const allowedStrings = new Set(["since", "model", ...(allowRoot ? ["root"] : [])]);

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      throw new Error(usage);
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    const inline = eq === -1 ? undefined : arg.slice(eq + 1);

    if (name === "dry-run") {
      if (inline !== undefined) throw new Error(usage);
      options.dryRun = true;
      continue;
    }
    if (!allowedStrings.has(name)) {
      throw new Error(usage);
    }
    const value = inline !== undefined ? inline : args[++i];
    if (value === undefined || value.trim() === "" || (inline === undefined && value.startsWith("-"))) {
      throw new Error(usage);
    }
    options[name] = value;
  }

  if (options.since !== undefined) {
    parseSince(options.since);
  }
  return options;
}

function tokenizeInput(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const tokens = [];
  let current = "";
  let quote = null;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (quote) throw new Error(dreamCommandUsage);
  if (current) tokens.push(current);
  return tokens;
}

export function parseDreamCommandInput(rawInput = "") {
  try {
    const tokens = tokenizeInput(rawInput);
    const parsed = parseDreamArgs(tokens, { allowRoot: false, usage: dreamCommandUsage });
    const args = [];
    if (parsed.dryRun) args.push("--dry-run");
    if (parsed.since) args.push("--since", parsed.since);
    if (parsed.model) args.push("--model", parsed.model);
    return { ok: true, args, options: parsed };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error && error.message.startsWith("--since")
        ? error.message
        : dreamCommandUsage,
    };
  }
}

export function buildDreamFollowup({ script, root, args = [] }) {
  const quote = (arg) => "'" + arg.replaceAll("'", "'\\''") + "'";
  const argv = ["node", quote(script), "--root", quote(root), ...args.map((arg) => /^--?[a-z-]+$/.test(arg) ? arg : quote(arg))];
  return `Run \`${argv.join(" ")}\` with bash and report its output clearly. ${dreamFollowupEnding}`;
}

function runPi({ root, model, prompt }) {
  const result = spawnSync(
    "pi",
    [
      "-p", "--model", model, "--thinking", "high",
      "--no-session", "--no-context-files", "--no-extensions", "--no-mcp",
      "--no-skills", "--no-prompt-templates", "--tools", "read,edit,write,bash",
      "--", prompt,
    ],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr ?? "").trim() || `pi exited with status ${result.status ?? 1}`);
  }
  return result.stdout ?? "";
}

function saveCursor(path, cursor) {
  writeAtomic(path, `${JSON.stringify(cursor, null, 2)}\n`, 0o600);
}

export function dream(
  { root, since, dryRun = false, model = defaultDreamModel },
  runner = runPi,
  home = userHome(),
  { stdout = process.stdout, stderr = process.stderr } = {},
) {
  const start = parseSince(since);
  const directory = join(root, ".dream");
  mkdirSync(directory, { recursive: true, mode: 0o700 });

  withDreamLock(join(directory, "lock"), () => {
    const cursorPath = join(directory, "cursor.json");
    const previous = start === undefined && existsSync(cursorPath)
      ? JSON.parse(readFileSync(cursorPath, "utf8"))
      : undefined;
    const { sessions, cursor, totals } = collectTranscripts(home, previous, start);
    const digest = writeDigest(root, directory, sessions, home);

    stdout.write(`Sessions: pi ${totals.pi}, DeepSeek Harness ${totals["DeepSeek Harness"]}, Claude Code ${totals["Claude Code"]}\n`);
    const count = digest.chunks.length;
    stdout.write(`Size: ${digest.characters} characters, ${count} ${count === 1 ? "chunk" : "chunks"}\n`);
    stdout.write(`Digest: ${digest.path}\n`);
    if (dryRun) return;

    let changes;
    try {
      if (!count) {
        syncIndexes(root, { stdout, stderr });
        saveCursor(cursorPath, cursor);
        if (!previous && start === undefined) {
          stdout.write(`Cursor initialized: ${Object.keys(cursor).length} transcripts\n`);
        }
        stdout.write("nothing new\n");
        return;
      }

      const finish = trackDreamChanges(root, join(digest.path, "backup"));
      const guide = readResource("DREAM.md").trimEnd();
      const contract = renderContract(root);
      const today = localDate(new Date());
      const reports = [];

      try {
        syncIndexes(root, { quiet: true });
        for (const [i, chunk] of digest.chunks.entries()) {
          const projects = folderEntries(join(root, "projects"))
            .filter((entry) => entry.isDirectory())
            .map(({ name }) => name);
          const prompt = `${guide}\nMemory root: ${root}\nDate: ${today}\nProject folders: ${JSON.stringify(projects)}\n` +
            `Projects in this chunk: ${JSON.stringify(chunk.projects)}\nChunk: ${chunk.file}\n\n${contract}`;
          try {
            const report = runner({ root, model, prompt }).trim();
            if (!report) throw new Error("pi returned no report");
            const file = basename(chunk.file).replace(/^chunk-/, "report-");
            writeFileSync(join(digest.path, file), `${report}\n`, { mode: 0o600 });
            reports.push(report);
            syncIndexes(root, { quiet: true });
          } catch (error) {
            throw new Error(`Dream chunk ${i + 1}/${count} failed: ${error instanceof Error ? error.message : error}`);
          }
        }

        syncIndexes(root, { stdout, stderr });
      } finally {
        changes = finish();
      }
      const { counts, backupPath } = changes;
      saveCursor(cursorPath, cursor);
      stdout.write(`Chunks run: ${reports.length}\n`);
      stdout.write(`Notes: ${counts.added} added, ${counts.changed} changed, ${counts.moved} moved, ${counts.deleted} deleted\n`);
      if (backupPath) {
        stdout.write(`Backups: ${backupPath}\n`);
      }
      stdout.write(`${reports.join("\n\n")}\n`);
    } catch (error) {
      const backups = changes?.backupPath ? `\nBackups: ${changes.backupPath}` : "";
      throw new Error(`${error instanceof Error ? error.message : error}\nDigest: ${digest.path}${backups}`);
    }
  });
}

export function runDreamCLI(argv = process.argv.slice(2), io = { stdout: process.stdout, stderr: process.stderr }) {
  try {
    const parsed = parseDreamArgs(argv);
    const root = resolveMemoryRoot(parsed.root);
    dream(
      {
        root,
        since: parsed.since,
        dryRun: parsed.dryRun,
        model: parsed.model ?? defaultDreamModel,
      },
      undefined,
      undefined,
      io,
    );
    return 0;
  } catch (error) {
    io.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    return 1;
  }
}
