import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { apply as installDsh, Config } from "../packages/dsh-memory/index.js";
import installPi from "../packages/pi-memory/index.ts";
import { createFixture, put } from "./fixture.mjs";

const agyDir = fileURLToPath(new URL("../packages/agy-memory", import.meta.url));

test("all three adapters contain identical bundled core, prompts, and LICENSE", () => {
  const base = new URL("../packages/pi-memory/", import.meta.url);
  for (const adapter of ["dsh-memory", "agy-memory"]) {
    for (const file of ["index.js", "dream-cli.js", "CONTRACT.md", "DREAM.md"]) {
      const a = readFileSync(new URL(`lib/core/${file}`, base));
      const b = readFileSync(new URL(`../packages/${adapter}/lib/core/${file}`, import.meta.url));
      assert.deepEqual(b, a, `${adapter}/lib/core/${file} differs from pi-memory`);
    }
    assert.deepEqual(
      readFileSync(new URL(`../packages/${adapter}/LICENSE`, import.meta.url)),
      readFileSync(new URL("../LICENSE", import.meta.url)),
    );
  }
});

test("pi, DSH, and agy adapters produce identical startup memory prompts and auto-sync notes", (t) => {
  const f = createFixture(t);
  const repo = join(f.cwd, "shared-app");
  mkdirSync(join(repo, ".git"), { recursive: true });
  put(join(f.root, "global", "rule.md"), "---\nname: Rule\ndescription: Short replies\ntype: feedback\nsection: 工作\n---\nBody\n");
  put(join(f.root, "projects", "shared-app", "NOW.md"), "---\nname: 现在做到哪\ndescription: Ship plugins\ntype: project\n---\nDetailed NOW body\n");

  const prevEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, MEMORA_DIR: process.env.MEMORA_DIR };
  process.env.HOME = process.env.USERPROFILE = f.home;
  process.env.MEMORA_DIR = f.root;
  t.after(() => {
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  // 1. pi-memory
  const listeners = [];
  installPi({ on: (name, fn) => listeners.push({ name, fn }) });
  assert.equal(listeners.length, 1);
  assert.equal(listeners[0].name, "before_agent_start");
  const piEvent = { systemPromptOptions: { sections: { keep: "ok" } } };
  listeners[0].fn(piEvent, { hasUI: true, cwd: repo });
  const piPrompt = piEvent.systemPromptOptions.sections.memory;
  assert.equal(piEvent.systemPromptOptions.sections.keep, "ok");

  // Non-UI headless pi calls (e.g. dream runner) do not inject memory
  const headlessEvent = { systemPromptOptions: { sections: {} } };
  listeners[0].fn(headlessEvent, { hasUI: false, cwd: repo });
  assert.equal(headlessEvent.systemPromptOptions.sections.memory, undefined);

  // 2. dsh-memory
  const agent = { id: "main", session: { header: {} } };
  const sections = [];
  let dshCommand;
  installDsh({
    agents: new Map([[agent.id, agent]]),
    workingDirectory: { get: () => repo },
    systemPrompt: { section: (s) => sections.push(s) },
    commands: { register: (c) => { dshCommand = c; } },
  }, Config({}));
  const dshPrompt = sections.find((s) => s.name === "dsh-memory:memory")?.text({ agent });

  // 3. agy-memory (execute real session-start.js and stop.js hooks via node)
  const agyStart = spawnSync("node", ["./session-start.js"], {
    cwd: agyDir,
    input: JSON.stringify({ cwd: repo, workspacePaths: [repo], hookEventName: "SessionStart" }),
    encoding: "utf8",
    env: { ...process.env, HOME: f.home, MEMORA_DIR: f.root },
  });
  assert.equal(agyStart.status, 0, agyStart.stderr);
  const agyPayload = JSON.parse(agyStart.stdout);
  const agyPrompt = agyPayload.injectSteps?.[0]?.systemMessage?.systemMessage;

  assert.equal(typeof piPrompt, "string");
  assert.equal(piPrompt, dshPrompt);
  assert.equal(piPrompt, agyPrompt);
  assert.ok(piPrompt.includes("- [Rule](rule.md) — Short replies"));
  assert.ok(piPrompt.includes("- [现在做到哪](NOW.md) — Ship plugins"));
  assert.ok(!piPrompt.includes("Detailed NOW body"));

  // Verify agy Stop hook syncs newly written notes and returns {"decision":"allow"}
  put(join(f.root, "projects", "shared-app", "added.md"), "---\nname: Added\ndescription: Synced on stop\ntype: project\n---\nBody\n");
  const agyStop = spawnSync("node", ["./stop.js"], {
    cwd: agyDir,
    input: JSON.stringify({ cwd: repo, hookEventName: "Stop", terminationReason: "NO_TOOL_CALL" }),
    encoding: "utf8",
    env: { ...process.env, HOME: f.home, MEMORA_DIR: f.root },
  });
  assert.equal(agyStop.status, 0, agyStop.stderr);
  assert.deepEqual(JSON.parse(agyStop.stdout), { decision: "allow" });
  assert.ok(readFileSync(join(f.root, "projects", "shared-app", "MEMORY.md"), "utf8").includes("[Added](added.md)"));

  // Verify DSH /dream command accepts valid flags and rejects subagents/bad args
  const received = [];
  agent.followup = (msg) => received.push(msg);
  const okEmpty = dshCommand.handler({ agent, rawInput: "", attachments: [], signal: new AbortController().signal });
  const okFlags = dshCommand.handler({ agent, rawInput: "--dry-run --since 2026-11-20 --model test/m", attachments: [], signal: new AbortController().signal });
  assert.deepEqual(okEmpty, { kind: "success" });
  assert.deepEqual(okFlags, { kind: "success" });
  assert.equal(received.length, 2);
  assert.match(received[1].content[0].text, /dream-cli\.js.*"--dry-run"|--dry-run.*--since "2026-11-20" --model "test\/m"/);

  const badArg = dshCommand.handler({ agent, rawInput: "unexpected", attachments: [], signal: new AbortController().signal });
  assert.equal(badArg.kind, "error");
  const badDate = dshCommand.handler({ agent, rawInput: "--since 2026-02-30", attachments: [], signal: new AbortController().signal });
  assert.equal(badDate.kind, "error");
  assert.match(badDate.text, /--since must be a valid local date/);

  // Verify pi manifest and agy skill files exist
  const piManifest = JSON.parse(readFileSync(new URL("../packages/pi-memory/package.json", import.meta.url), "utf8"));
  for (const rel of [...piManifest.pi.extensions, ...piManifest.pi.prompts]) {
    assert.ok(statSync(new URL(rel, new URL("../packages/pi-memory/", import.meta.url))).isFile());
  }
  assert.ok(statSync(join(agyDir, "skills", "dream", "SKILL.md")).isFile());

  // Verify bundled dream-cli.js runs standalone via node
  const dreamCli = join(agyDir, "lib", "core", "dream-cli.js");
  const cliRun = spawnSync("node", [dreamCli, "--dry-run", "--root", f.root], {
    encoding: "utf8",
    env: { ...process.env, HOME: f.home },
  });
  assert.equal(cliRun.status, 0, cliRun.stderr);
  assert.ok(cliRun.stdout.includes("Sessions: pi 0, DeepSeek Harness 0, Claude Code 0"));
});
