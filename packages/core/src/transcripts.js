import { lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { zstdDecompressSync } from "node:zlib";

const sources = {
  pi: [".pi", "agent", "sessions", "*", "*.jsonl"],
  "DeepSeek Harness": [".dsh", "sessions", "*", "*", "session.v4.jsonl.zstd"],
  "Claude Code": [".claude", "projects", "*", "*.jsonl"],
};

function timestamp(value) {
  return value === undefined ? NaN : new Date(value).getTime();
}

function conversation(host, row) {
  if (host === "pi" && row.type === "message") return row.message;
  if (host === "DeepSeek Harness") {
    if (row.type === "user/message" && row.data?.source?.kind === "user") {
      return { role: "user", content: row.data.content };
    }
    if (row.type === "assistant/message") {
      return { role: "assistant", content: row.data?.message?.content };
    }
  }
  if (host === "Claude Code" && !row.isSidechain && !row.isMeta) {
    if (row.type === "assistant" || (row.type === "user" && typeof row.origin === "object" && row.origin?.kind === "human")) {
      return { role: row.type, content: row.message?.content };
    }
  }
  return undefined;
}

function visibleText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

function matchSegment(pattern, name) {
  if (pattern === "*") return true;
  if (pattern.startsWith("*.")) return name.endsWith(pattern.slice(1));
  return pattern === name;
}

function scanPattern(home, segments) {
  let current = [home];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const last = i === segments.length - 1;
    const hasWildcard = seg.includes("*");
    const next = [];
    for (const dir of current) {
      if (!hasWildcard) {
        const candidate = join(dir, seg);
        const info = lstatSync(candidate, { throwIfNoEntry: false });
        if (!info) continue;
        if (last ? info.isFile() : info.isDirectory()) next.push(candidate);
        continue;
      }
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!matchSegment(seg, entry.name)) continue;
        const candidate = join(dir, entry.name);
        if (last ? entry.isFile() : entry.isDirectory()) next.push(candidate);
      }
    }
    current = next;
    if (!current.length) break;
  }
  return current.sort();
}

function inspectTranscript(host, path, after, since) {
  const bytes = readFileSync(path);
  const input = (host === "DeepSeek Harness" ? zstdDecompressSync(bytes) : bytes).toString("utf8");
  let records = 0;
  let cwd;
  let start = NaN;
  let skip = false;
  let firstUser = true;
  const turns = [];
  for (const match of input.matchAll(/[^\n]+/g)) {
    if (!match[0].trim()) continue;
    let row;
    try {
      row = JSON.parse(match[0]);
    } catch {
      // A writer may still be appending the final record; don't count it yet.
      if (match.index + match[0].length === input.length) break;
      throw new Error(`${path}: invalid JSONL record ${records + 1}`);
    }
    records++;
    if (skip || after === Infinity) continue;
    if (host !== "Claude Code" && records === 1 && row.type === "session") {
      cwd = row.cwd;
      start = timestamp(row.timestamp ?? row.createdAt);
      skip = host === "DeepSeek Harness" && row.origin === "subagent";
    }
    const message = conversation(host, row);
    const role = message?.role;
    if (role !== "user" && role !== "assistant") continue;
    const time = timestamp(row.time ?? row.timestamp);
    cwd ??= row.cwd;
    if (!Number.isFinite(start) && Number.isFinite(time)) start = time;
    const visible = visibleText(message?.content);
    const text = (role === "user"
      ? visible.replace(/<system-reminder\b[^>]*>[\s\S]*?<\/system-reminder>/g, "")
      : visible).trim();
    if (!text) continue;
    if (role === "user" && firstUser) {
      firstUser = false;
      if (text.startsWith("<file name=")) {
        skip = true;
        continue;
      }
    }
    if (since === undefined ? records <= after : !(time >= since)) continue;
    const cut = "\n[truncated]";
    turns.push({ role, text: text.length <= 2000 ? text : text.slice(0, 2000 - cut.length) + cut });
  }
  const directory = cwd ? resolve(cwd) : "";
  const temporary = ["/tmp", "/private/tmp"].some((prefix) => directory === prefix || directory.startsWith(prefix + sep));
  return {
    records,
    session: !skip && !temporary && turns.length > 0 ? { host, cwd: directory, start, turns } : undefined,
  };
}

export function collectTranscripts(home, previous, since) {
  const cursor = {};
  const sessions = [];
  const totals = { pi: 0, "DeepSeek Harness": 0, "Claude Code": 0 };
  for (const host of Object.keys(sources)) {
    const paths = scanPattern(home, sources[host]);
    for (const path of paths) {
      const { size, mtimeMs: mtime } = statSync(path);
      const last = previous?.[path];
      if (since === undefined && last?.size === size && last.mtime === mtime) {
        cursor[path] = last;
        continue;
      }
      const after = since === undefined && !previous ? Infinity : (last?.records ?? 0);
      const { records, session } = inspectTranscript(host, path, after, since);
      cursor[path] = { size, mtime, records };
      if (session) {
        totals[host]++;
        sessions.push(session);
      }
    }
  }
  sessions.sort((a, b) => (a.start || 0) - (b.start || 0));
  return { sessions, cursor, totals };
}
