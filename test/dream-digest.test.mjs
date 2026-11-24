import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { zstdCompressSync } from "node:zlib";
import test from "node:test";
import { buildDreamFollowup, dream } from "../packages/core/src/index.js";
import { createFixture, createStream, put } from "./fixture.mjs";

const stamp = "2026-11-17T12:00:00";
const cwd = "/example/CaseRepo";
const header = { type: "session", cwd, timestamp: `${stamp}Z` };
const text = (t) => ({ type: "text", text: t });
const piMsg = (role, content, timestamp = stamp) => ({ type: "message", timestamp, message: { role, content } });
const jsonl = (rows) => rows.map((row) => JSON.stringify(row)).join("\n") + "\n";

function transcript(f, rel, rows) {
  const path = join(f.home, rel);
  const raw = Buffer.from(jsonl(rows), "utf8");
  return put(path, rel.endsWith(".zstd") ? zstdCompressSync(raw) : raw);
}

function dryRun(f, since) {
  const out = createStream();
  const err = createStream();
  dream({ root: f.root, dryRun: true, since }, undefined, f.home, { stdout: out, stderr: err });
  const digestDir = /^Digest: (.+)$/m.exec(out.text)?.[1];
  assert.ok(digestDir, `missing digest dir in:\n${out.text}`);
  const chunks = readdirSync(digestDir).sort().map((file) => readFileSync(join(digestDir, file), "utf8"));
  return { out: out.text, chunks };
}

test("dream extracts visible conversation across pi, DSH (.zstd), and Claude Code while filtering noise", (t) => {
  const f = createFixture(t);
  mkdirSync(join(f.root, "projects", "CaseRepo"), { recursive: true });
  const piPath = transcript(f, ".pi/agent/sessions/test/main.jsonl", [
    header,
    piMsg("user", [text("Too early")], "2026-11-16T23:59:59"),
    piMsg("user", [text("Pi user <system-reminder>Hidden\ntext</system-reminder> stays"), { type: "image", data: "Hidden image" }]),
    piMsg("toolResult", [text("Hidden result")]),
    piMsg("assistant", [text("Pi answer\n\n## Heading\n\nStill the Pi answer"), { type: "thinking", text: "Hidden thinking" }, { type: "toolCall", text: "Hidden tool call" }]),
    piMsg("user", "Pi string message"),
    piMsg("user", "x".repeat(2010)),
  ]);
  transcript(f, ".pi/agent/sessions/test/tmp.jsonl", [{ ...header, cwd: "/private/tmp/run" }, piMsg("user", "Hidden tmp")]);
  transcript(f, ".pi/agent/sessions/test/tmp2.jsonl", [{ ...header, cwd: "/tmp/run" }, piMsg("user", "Hidden tmp")]);
  transcript(f, ".pi/agent/sessions/test/worker.jsonl", [header, piMsg("user", '<file name="brief">'), piMsg("assistant", [text("Hidden worker")])]);

  const time = Date.parse(`${stamp}Z`) + 1000;
  const dshRows = [
    { type: "session", cwd, createdAt: time },
    { type: "system/message", time, data: { content: [text("Hidden system")] } },
    { type: "user/message", time, data: { source: { kind: "agent-instructions" }, content: [text("Hidden injected instructions")] } },
    { type: "user/message", time, data: { source: { kind: "user" }, content: [text("DSH user")] } },
    { type: "user/message", time, data: { source: { kind: "user" }, content: [text(buildDreamFollowup({ script: "Hidden", root: f.root }))] } },
    { type: "user/message", time, data: { source: { kind: "user" }, content: [text("Run `node --version` too")] } },
    { type: "assistant/message", time, data: { message: { content: [text("DSH answer"), { type: "tool-call", text: "Hidden DSH call" }] } } },
  ];
  transcript(f, ".dsh/sessions/test/main/session.v4.jsonl.zstd", dshRows);
  transcript(f, ".dsh/sessions/test/sub/session.v4.jsonl.zstd", [{ ...dshRows[0], origin: "subagent" }, ...dshRows.slice(1)]);

  const claude = (type, content, extra = {}) => ({ type, cwd, timestamp: "2026-11-17T12:00:02", message: { content }, ...extra });
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
  const { out, chunks } = dryRun(f, "2026-11-17");
  assert.ok(out.includes("Sessions: pi 1, DeepSeek Harness 1, Claude Code 1"));
  assert.equal(chunks.length, 1);
  const digest = chunks[0];
  assert.ok(digest.startsWith('Sessions start with a line "=== session: host | start | cwd | project ===".\n\n'));
  const headers = digest.match(/^=== session:.* ===$/gm);
  assert.equal(headers.length, 3);
  assert.equal(headers[0], "=== session: pi | 2026-11-17 12:00:00 | /example/CaseRepo | CaseRepo ===");
  assert.ok(digest.includes("**Assistant:**\n\nPi answer\n\n## Heading\n\nStill the Pi answer\n\n**User:**\n\nPi string message"));
  assert.ok(digest.includes("Run `node --version` too"));
  assert.match(headers[1], /DeepSeek Harness/);
  assert.match(headers[2], /Claude Code/);
  for (const msg of ["Pi user  stays", "Pi answer", "Pi string message", "DSH user", "DSH answer", "Claude user", "Claude parts", "Claude answer"]) {
    assert.ok(digest.includes(msg), `missing ${msg}`);
  }
  assert.doesNotMatch(digest, /Hidden|Too early|system-reminder|<command-name>|x{2001}/);
  assert.ok(digest.includes("[truncated]"));
  assert.deepEqual(readFileSync(piPath), before);
  assert.equal(existsSync(join(f.root, ".dream", "cursor.json")), false);
});

test("dream follows symlinks in literal, wildcard directory and transcript paths", (t) => {
  const f = createFixture(t);
  const file = transcript(f, "data/rows", [header, piMsg("user", "Linked turn")]);
  const sessions = join(f.home, "storage/agent/sessions");
  mkdirSync(sessions, { recursive: true });
  symlinkSync(join(f.home, "storage"), join(f.home, ".pi"));
  symlinkSync(join(f.home, "data"), join(sessions, "linked"));
  symlinkSync(file, join(f.home, "data/main.jsonl"));
  assert.match(dryRun(f, "2026-11-17").chunks.join(""), /Linked turn/);
});

test("dream keeps small sessions together and splits oversized sessions between turns", (t) => {
  const f = createFixture(t);
  for (const [label, count, hour] of [["alpha", 100, 12], ["beta", 100, 13], ["large", 160, 14]]) {
    const timestamp = `2026-11-17T${hour}:00:00`;
    const path = transcript(f, `.pi/agent/sessions/test/${label}.jsonl`, [{ ...header, timestamp }]);
    for (let i = 0; i < count; i++) {
      appendFileSync(path, jsonl([piMsg("user", [text(`${label}-${i} ${"a".repeat(1970)}`)], timestamp)]));
    }
  }
  const { chunks, out } = dryRun(f, "2026-11-17");
  assert.equal(chunks.length, 4);
  assert.deepEqual(chunks.map((c) => c.match(/\*\*User:\*\*/g)?.length), [100, 100, 150, 10]);
  assert.deepEqual(chunks.map((chunk) => chunk.split("\n").slice(0, 3)),
    [12, 13, 14, 14].map((hour) => [
      'Sessions start with a line "=== session: host | start | cwd | project ===".', "",
      `=== session: pi | 2026-11-17 ${hour}:00:00 | ${cwd} | global ===`,
    ]));
  assert.ok(chunks.every((c) => c.length <= 300_000));
  assert.ok(out.includes(`${chunks.reduce((sum, c) => sum + c.length, 0)} characters, 4 chunks`));
});
