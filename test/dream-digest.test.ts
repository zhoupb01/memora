import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { cli, fixture, put } from "./fixture";

const stamp = "2026-11-17T12:00:00";
const cwd = "/example/CaseRepo";
const since = ["--since", "2026-11-17"];
const jsonl = (rows: unknown[]) => rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
const text = (text: string) => ({ type: "text", text });
const pi = (role: string, content: unknown, timestamp = stamp) => ({ type: "message", timestamp, message: { role, content } });
const header = { type: "session", cwd, timestamp: stamp };

function transcript(f: ReturnType<typeof fixture>, file: string, rows: unknown[]) {
  const path = join(f.home, file);
  const source = jsonl(rows);
  put(path, file.endsWith(".zstd") ? Bun.zstdCompressSync(Buffer.from(source)) : source);
  return path;
}

function dryRun(f: ReturnType<typeof fixture>, ...args: string[]) {
  const result = cli(f, ["dream", "--root", f.root, "--dry-run", ...args]);
  expect(result.code).toBe(0);
  const digest = /^Digest: (.+)$/m.exec(result.out)?.[1];
  expect(digest).toBeDefined();
  const chunks = [...new Bun.Glob("chunk-*.md").scanSync(digest!)].sort().map((file) => readFileSync(join(digest!, file), "utf8"));
  return { ...result, chunks };
}

test("dream extracts only visible text from the three real transcript shapes", () => {
  const f = fixture();
  put(join(f.root, "projects", "CaseRepo", "MEMORY.md"));
  const piPath = transcript(f, ".pi/agent/sessions/test/a.jsonl", [
    header, pi("user", "Too early", "2026-11-16T23:59:59"),
    pi("user", [text("Pi user <system-reminder>hidden\ntext</system-reminder> stays"), { type: "image", text: "Hidden image" }]),
    pi("toolResult", [text("Hidden tool result")]),
    pi("assistant", [text("Pi answer\n\n## Heading\n\nStill the Pi answer"), { type: "thinking", text: "Hidden thinking" }, { type: "toolCall", text: "Hidden tool call" }]),
    pi("user", "Pi string message"),
    pi("user", "x".repeat(2010)),
  ]);
  transcript(f, ".pi/agent/sessions/test/tmp.jsonl", [{ ...header, cwd: "/private/tmp/run" }, pi("user", "Hidden tmp")]);
  transcript(f, ".pi/agent/sessions/test/tmp2.jsonl", [{ ...header, cwd: "/tmp/run" }, pi("user", "Hidden tmp")]);
  transcript(f, ".pi/agent/sessions/test/worker.jsonl", [header, pi("user", '<file name="brief">'), pi("assistant", [text("Hidden worker")])]);
  const time = Date.parse(`${stamp}Z`) + 1000;
  const dshRows = [
    { type: "session", cwd, createdAt: time },
    { type: "system/message", time, data: { content: [text("Hidden system")] } },
    { type: "user/message", time, data: { source: { kind: "agent-instructions" }, content: [text("Hidden injected instructions")] } },
    { type: "user/message", time, data: { source: { kind: "user" }, content: [text("DSH user")] } },
    { type: "assistant/message", time, data: { message: { content: [text("DSH answer"), { type: "tool-call", text: "Hidden DSH call" }] } } },
  ];
  transcript(f, ".dsh/sessions/test/main/session.v4.jsonl.zstd", dshRows);
  transcript(f, ".dsh/sessions/test/sub/session.v4.jsonl.zstd", [{ ...dshRows[0], origin: "subagent" }, ...dshRows.slice(1)]);
  const claude = (type: string, content: unknown, extra = {}) => ({ type, cwd, timestamp: "2026-11-17T12:00:02", message: { content }, ...extra });
  const human = { origin: { kind: "human" } };
  transcript(f, ".claude/projects/test/main.jsonl", [
    { type: "file-history-snapshot" },
    claude("user", "<task-notification>Hidden task</task-notification>", { origin: { kind: "task-notification" } }),
    claude("user", "This session is being continued from a previous conversation. Hidden summary.", { isCompactSummary: true }),
    claude("user", "<command-name>/compact</command-name>"),
    claude("user", "<local-command-stdout>Hidden output</local-command-stdout>"),
    claude("user", "Claude user <system-reminder>Hidden reminder</system-reminder>", human),
    claude("user", [text("Claude parts"), { type: "tool_result", content: "Hidden result" }], human),
    claude("user", "Hidden human sidechain", { ...human, isSidechain: true }),
    claude("assistant", [text("Hidden sidechain")], { isSidechain: true }),
    claude("assistant", [text("Claude answer")]),
  ]);
  transcript(f, ".claude/projects/test/subagents/sub.jsonl", [claude("user", "Hidden subfolder", human)]);
  const before = readFileSync(piPath);
  const { out, chunks } = dryRun(f, ...since);
  expect(out).toContain("Sessions: pi 1, DeepSeek Harness 1, Claude Code 1");
  expect(chunks).toHaveLength(1);
  const digest = chunks[0];
  expect(digest).toStartWith('Sessions start with a line "=== session: host | start | cwd | project ===".\n\n');
  expect(digest.match(/^=== session:.* ===$/gm)).toEqual([
    "=== session: pi | 2026-11-17 12:00:00 | /example/CaseRepo | CaseRepo ===",
    expect.stringContaining("DeepSeek Harness"),
    expect.stringContaining("Claude Code"),
  ]);
  expect(digest).toContain("**Assistant:**\n\nPi answer\n\n## Heading\n\nStill the Pi answer\n\n**User:**\n\nPi string message");
  for (const message of ["Pi user  stays", "Pi answer", "Pi string message", "DSH user", "DSH answer", "Claude user", "Claude parts", "Claude answer"]) {
    expect(digest).toContain(message);
  }
  expect(digest).not.toMatch(/Hidden|Too early|system-reminder|<command-name>|x{2001}/);
  expect(digest).toContain("[truncated]");
  expect(readFileSync(piPath)).toEqual(before);
  expect(existsSync(join(f.root, ".dream", "cursor.json"))).toBe(false);
});

test("dream keeps small sessions together and splits only oversized sessions between turns", () => {
  const f = fixture();
  for (const [label, count, hour] of [["alpha", 100, 12], ["beta", 100, 13], ["large", 160, 14]] as const) {
    const timestamp = `2026-11-17T${hour}:00:00`;
    const path = transcript(f, `.pi/agent/sessions/test/${label}.jsonl`, [{ ...header, timestamp }]);
    for (let i = 0; i < count; i++) appendFileSync(path, jsonl([pi("user", [text(`${label}-${i} ${"a".repeat(1970)}`)], timestamp)]));
  }
  const { chunks, out } = dryRun(f, ...since);
  expect(chunks).toHaveLength(4);
  expect(chunks.map((chunk) => chunk.match(/\*\*User:\*\*/g)?.length)).toEqual([100, 100, 150, 10]);
  expect(chunks.map((chunk) => chunk.split("\n").slice(0, 3))).toEqual(
    ["12:00:00", "13:00:00", "14:00:00", "14:00:00"].map((start) => [
      'Sessions start with a line "=== session: host | start | cwd | project ===".',
      "",
      `=== session: pi | 2026-11-17 ${start} | ${cwd} | global ===`,
    ]),
  );
  expect(chunks.every((chunk) => chunk.length <= 300_000)).toBe(true);
  expect(out).toContain(`${chunks.reduce((sum, chunk) => sum + chunk.length, 0)} characters, 4 chunks`);
});
