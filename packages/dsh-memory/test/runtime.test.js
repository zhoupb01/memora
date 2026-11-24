import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const runtimePath = process.env.DSH_TEST_RUNTIME;
const sectionName = "dsh-memory:memory";

test("isolated Cordis runtime integration", {
  skip: runtimePath ? false : "Set DSH_TEST_RUNTIME to an extracted DSH runtime directory or its node_modules; no profile is loaded.",
}, async (t) => {
  const supplied = await realpath(resolve(runtimePath));
  const runtimeRoot = basename(supplied) === "node_modules" ? dirname(supplied) : supplied;
  const modulesRoot = await realpath(join(runtimeRoot, "node_modules"));
  const requireRuntime = createRequire(join(runtimeRoot, "__dsh_memory_runtime_test__.cjs"));
  const load = async (name) => {
    const entry = await realpath(requireRuntime.resolve(name));
    const local = relative(modulesRoot, entry);
    assert.ok(local && local !== ".." && !local.startsWith(`..${sep}`));
    return import(pathToFileURL(entry).href);
  };
  const [{ Context, Service }, { SystemPrompt, renderPrompt }, { CommandRuntime },
    { Session, SESSION_FORMAT_VERSION, snapshotSessionEvent }, { AgentRegistry, assembleContextFor },
    { SessionProjectionRegistry }] = await Promise.all([
    load("@deepseek-ai/cordis"),
    load("@deepseek-ai/dsh-system-prompt"),
    load("@deepseek-ai/dsh-commands"),
    load("@deepseek-ai/dsh-session"),
    load("@deepseek-ai/dsh-agent"),
    load("@deepseek-ai/dsh-session-projection"),
  ]);
  const memoryPlugin = await import("../index.js");

  const temporaryBase = await realpath(tmpdir());
  const directory = await mkdtemp(join(temporaryBase, "dsh-memory-runtime-test-"));
  const ctx = new Context();
  t.after(async () => {
    try {
      await ctx.fiber.dispose();
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  const root = join(directory, "synthetic-memory");
  const alpha = join(directory, "project-alpha");
  await mkdir(join(alpha, ".git"), { recursive: true });
  await mkdir(join(root, "projects", "project-alpha"), { recursive: true });
  await writeFile(join(root, "projects", "project-alpha", "note.md"), "---\nname: Alpha\ndescription: ALPHA_ONLY {{keep_literal}}\ntype: project\n---\nBody\n");

  const directories = new Map();
  class TestWorkingDirectory extends Service {
    constructor(c) { super(c, "workingDirectory"); }
    get(session) { return directories.get(session); }
  }
  await ctx.plugin(SessionProjectionRegistry);
  await ctx.plugin(AgentRegistry);
  await ctx.plugin(TestWorkingDirectory);
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false });
  await ctx.plugin(CommandRuntime);

  const session = Session.create("a1", [], { version: SESSION_FORMAT_VERSION, id: "a1", createdAt: Date.now(), isSeeded: false, cwd: directory });
  const received = [];
  const agent = {
    id: "a1",
    session,
    followup(msg) {
      snapshotSessionEvent({ type: "user/message", seq: 0, time: Date.now(), data: msg, surfaceOp: "append" });
      received.push(msg);
    },
  };
  directories.set(session, alpha);
  await ctx.agents.register(agent);
  await ctx.plugin(memoryPlugin, { directory: root });

  const assembled = await ctx.systemPrompt.assemble(assembleContextFor(agent));
  const rendered = renderPrompt(assembled);
  assert.ok(rendered.includes("ALPHA_ONLY {{keep_literal}}"));

  const exec = await ctx.commands.execute(agent, "/dream --dry-run", [], new AbortController().signal);
  assert.deepEqual(exec.result, { kind: "success" });
  assert.equal(received.length, 1);
});
