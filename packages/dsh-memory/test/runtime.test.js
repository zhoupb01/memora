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
const tidyDescription = "Tidy long-term memory — delete wrong ones, archive outdated ones, merge duplicates";
const tidyText = 'Tidy up long-term memory now. Follow the checklist in the "Tidying" section of the long-term memory instructions step by step, then report as its step 5 says.';

// Opt in to an external, already installed runtime. Never fall back to a real
// profile, download packages, or load the plugin at all when this is skipped.
test("isolated Cordis runtime integration", {
  skip: runtimePath ? false : "Set DSH_TEST_RUNTIME to an extracted DSH runtime directory or its node_modules; no profile is loaded.",
}, async (t) => {
  const supplied = await realpath(resolve(runtimePath));
  const runtimeRoot = basename(supplied) === "node_modules" ? dirname(supplied) : supplied;
  const modulesRoot = await realpath(join(runtimeRoot, "node_modules"));
  const requireRuntime = createRequire(join(runtimeRoot, "__dsh_memory_runtime_test__.cjs"));
  const load = async (name) => {
    try {
      const entry = await realpath(requireRuntime.resolve(name));
      const local = relative(modulesRoot, entry);
      assert.ok(local && local !== ".." && !local.startsWith(`..${sep}`), `${name} must resolve inside DSH_TEST_RUNTIME/node_modules`);
      return await import(pathToFileURL(entry).href);
    } catch (cause) {
      throw new Error(`DSH_TEST_RUNTIME cannot load ${name}; provide a complete extracted runtime (no automatic installation).`, { cause });
    }
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
  const runtimeVersion = requireRuntime("@deepseek-ai/dsh-system-prompt/package.json").version;
  t.diagnostic(`Runtime: DSH ${runtimeVersion}; Cordis ${requireRuntime("@deepseek-ai/cordis/package.json").version}`);
  const memoryPlugin = await import("../index.js");

  async function fixture(t, { commands = true } = {}) {
    // Both cwd and memory are synthetic. An explicit directory config prevents
    // resolveMemoryRoot from reading DSH_MEMORY_DIR, DSH_HOME or ~/.dsh/memory.
    const temporaryBase = await realpath(tmpdir());
    const directory = await mkdtemp(join(temporaryBase, "dsh-memory-runtime-test-"));
    const ctx = new Context();
    t.after(async () => {
      try {
        await ctx.fiber.dispose();
      } finally {
        // Verify the exact mkdtemp target before recursive cleanup.
        assert.equal(dirname(directory), temporaryBase);
        assert.ok(basename(directory).startsWith("dsh-memory-runtime-test-"));
        assert.equal(await realpath(directory), directory);
        await rm(directory, { recursive: true });
      }
    });
    const root = join(directory, "synthetic-memory");
    const alpha = join(directory, "project-alpha");
    const beta = join(directory, "project-beta");
    const alphaCwd = join(alpha, "src", "nested");
    const betaCwd = join(beta, "src");
    await Promise.all([
      mkdir(join(alpha, ".git"), { recursive: true }),
      mkdir(join(beta, ".git"), { recursive: true }),
      mkdir(alphaCwd, { recursive: true }),
      mkdir(betaCwd, { recursive: true }),
    ]);
    // Folder naming is part of the public pi-memory compatibility contract.
    const projectFolder = (path) => join(root, "projects", path.replaceAll("/", "-").replaceAll("\\", "-").replaceAll(":", "-"));
    const globalIndex = join(root, "global", "MEMORY.md");
    const alphaIndex = join(projectFolder(alpha), "MEMORY.md");
    const betaIndex = join(projectFolder(beta), "MEMORY.md");
    for (const [path, text] of [
      [globalIndex, "Synthetic global memory {{keep_literal}}."],
      [alphaIndex, "ALPHA_ONLY synthetic project memory."],
      [betaIndex, "BETA_ONLY synthetic project memory."],
    ]) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, text);
    }

    const directories = new Map();
    const cwdReads = [];
    // Agent membership uses the real registry. Only working-directory lookup
    // and followup delivery are controlled; no model or profile is attached.
    class TestWorkingDirectory extends Service {
      constructor(ctx) { super(ctx, "workingDirectory"); }
      get(session) {
        assert.ok(directories.has(session), "cwd must belong to this fixture");
        cwdReads.push(session);
        return directories.get(session);
      }
    }
    await ctx.plugin(SessionProjectionRegistry);
    await ctx.plugin(AgentRegistry);
    await ctx.plugin(TestWorkingDirectory);
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false });
    if (commands) await ctx.plugin(CommandRuntime);

    async function agent({ cwd = alphaCwd, origin, registered = true, parentSession,
      id = `memory-test-${randomUUID()}` } = {}) {
      const session = Session.create(id, [], {
        version: SESSION_FORMAT_VERSION,
        id,
        createdAt: Date.now(),
        isSeeded: false,
        // Deliberately different from effective cwd: header cwd is not current.
        cwd: directory,
        ...(origin ? { origin } : {}),
        ...(parentSession ? { parentSession } : {}),
      });
      const received = [];
      const agent = {
        id,
        session,
        followup(message) {
          // Validate with the real Session import boundary before recording the
          // durable inbox shape. This adapter intentionally does not wake a loop.
          snapshotSessionEvent({ type: "user/message", seq: 0, time: Date.now(), data: message, surfaceOp: "append" });
          session.append("agent/inbox/spliced", {
            target: "next-turn", start: received.length, inserted: [message],
          });
          received.push(message);
        },
      };
      directories.set(session, cwd);
      const dispose = registered ? await ctx.agents.register(agent) : undefined;
      return { agent, received, dispose };
    }
    const mount = async () => {
      const plugin = ctx.plugin(memoryPlugin, { directory: root });
      await plugin;
      return plugin;
    };
    const assemble = (agent) => ctx.systemPrompt.assemble(agent ? assembleContextFor(agent) : {});
    const execute = (agent, line = "/tidy", attachments = [], signal = new AbortController().signal) =>
      ctx.commands.execute(agent, line, attachments, signal);
    return { ctx, root, alpha, beta, alphaCwd, betaCwd, alphaIndex, betaIndex, directory,
      directories, cwdReads, agent, mount, assemble, execute };
  }

  await t.test("section uses each agent's current cwd, refreshes memory, and preserves literal text", async (t) => {
    const f = await fixture(t);
    const { agent: first } = await f.agent();
    const { agent: second } = await f.agent({ cwd: f.betaCwd });
    await f.mount();
    const firstAssembly = await f.assemble(first);
    const firstSection = firstAssembly.sections.find(({ name }) => name === sectionName);
    assert.ok(firstSection);
    assert.equal(firstSection.interpolate, false);
    assert.ok(firstSection.text.includes("Synthetic global memory {{keep_literal}}."));
    assert.ok(firstSection.text.includes("ALPHA_ONLY"));
    assert.ok(!firstSection.text.includes("BETA_ONLY"));
    assert.ok(firstSection.text.includes(`(project: ${f.alpha})`));
    assert.ok(renderPrompt(firstAssembly).includes("{{keep_literal}}"));
    const secondAssembly = await f.assemble(second);
    assert.ok(renderPrompt(secondAssembly).includes("BETA_ONLY"));
    assert.ok(!renderPrompt(secondAssembly).includes("ALPHA_ONLY"));

    f.directories.set(first.session, f.betaCwd);
    await writeFile(f.betaIndex, "BETA_CHANGED synthetic project memory.");
    const changed = renderPrompt(await f.assemble(first));
    assert.ok(changed.includes("BETA_CHANGED"));
    assert.ok(changed.includes(`(project: ${f.beta})`));
    assert.ok(!changed.includes("ALPHA_ONLY"));
    assert.deepEqual(f.cwdReads, [first.session, second.session, first.session]);
    assert.equal(first.session.header.cwd, f.directory);
  });

  await t.test("agentless, child, resumed subagent and unregistered assemblies skip memory", async (t) => {
    const f = await fixture(t);
    const { agent: child } = await f.agent({ origin: "subagent", parentSession: "synthetic-parent" });
    const { agent: resumedSubagent } = await f.agent({ origin: "subagent" });
    const { agent: unregistered } = await f.agent({ registered: false });
    const { agent: removed, dispose } = await f.agent();
    await dispose();
    const { agent: replacement } = await f.agent({ id: removed.id });
    const { agent: resumedFork } = await f.agent({ parentSession: "synthetic-parent" });
    await f.mount();
    for (const agent of [undefined, child, resumedSubagent, unregistered, removed]) {
      const assembly = await f.assemble(agent);
      assert.equal(assembly.sections.find(({ name }) => name === sectionName)?.text, "");
      assert.equal(renderPrompt(assembly), "");
    }
    assert.deepEqual(f.cwdReads, [], "skipped agents must not resolve or read memory");
    assert.ok(renderPrompt(await f.assemble(resumedFork)).includes("ALPHA_ONLY"));
    assert.ok(renderPrompt(await f.assemble(replacement)).includes("ALPHA_ONLY"));
  });

  await t.test("/tidy is discoverable and sends identified UserMessages accepted by Session persistence/replay", async (t) => {
    const f = await fixture(t);
    const { agent, received } = await f.agent();
    await f.mount();
    assert.deepEqual(f.ctx.commands.list(agent), [{ name: "tidy", description: tidyDescription }]);
    assert.equal(typeof f.ctx.commands.find(agent, "tidy")?.handler, "function");
    const startSeq = agent.session.seq;
    const first = await f.execute(agent);
    const second = await f.execute(agent, "/tidy  \t");
    assert.deepEqual(first.result, { kind: "success" });
    assert.deepEqual(second.result, { kind: "success" });
    assert.equal(received.length, 2);
    assert.notEqual(received[0].id, received[1].id);
    for (const message of received) {
      assert.equal(typeof message.id, "string");
      assert.ok(message.id.length > 0);
      assert.deepEqual(message, { id: message.id, role: "user", source: { kind: "user" }, content: [{ type: "text", text: tidyText }] });
    }
    const events = agent.session.snapshotEvents(startSeq);
    assert.deepEqual(events.map(({ type }) => type), [
      "command/run", "agent/inbox/spliced", "command/done",
      "command/run", "agent/inbox/spliced", "command/done",
    ]);
    for (const [offset, execution] of [[0, first], [3, second]]) {
      assert.equal(events[offset].data.name, "tidy");
      assert.deepEqual(events[offset].data.source, { kind: "user" });
      assert.equal(events[offset].data.commandId, execution.commandId);
      assert.equal(events[offset + 2].data.commandId, execution.commandId);
      assert.equal(events[offset + 2].data.kind, "success");
      assert.equal(events[offset + 1].data.target, "next-turn");
    }

    // Exercise actual JSON storage/reload in the fixture, without composing a
    // persistence service or accessing the current profile's Session store.
    const log = join(f.directory, "synthetic-session.jsonl");
    assert.ok(!relative(f.directory, log).startsWith(`..${sep}`));
    await writeFile(log, [agent.session.header, ...agent.session.snapshotEvents()].map((entry) => JSON.stringify(entry)).join("\n"));
    const [header, ...restoredEvents] = (await readFile(log, "utf8")).split("\n").map((line) => JSON.parse(line));
    const restored = Session.create(agent.id, restoredEvents, header);
    const pending = restored.snapshotEvents().filter(({ type }) => type === "agent/inbox/spliced").flatMap(({ data }) => data.inserted);
    assert.deepEqual(pending, received);
    // Session's inbox is JSON data; validate the eventual user/message boundary
    // too, where the runtime enforces id, role, source, and content fields.
    for (const message of pending) restored.append("user/message", message, { surfaceOp: "append" });
    const replayed = Session.create(agent.id, JSON.parse(JSON.stringify(restored.snapshotEvents())), header);
    assert.deepEqual(replayed.deriveMessages(), received);
  });

  await t.test("/tidy rejects children, arguments, attachments and cancellation without followups", async (t) => {
    const f = await fixture(t);
    const root = await f.agent();
    const child = await f.agent({ origin: "subagent", parentSession: root.agent.id });
    const resumedSubagent = await f.agent({ origin: "subagent" });
    const removed = await f.agent();
    await removed.dispose();
    await f.agent({ id: removed.agent.id });
    await f.mount();
    for (const { agent } of [child, resumedSubagent, removed]) {
      const { result } = await f.execute(agent);
      assert.equal(result.kind, "error");
      assert.match(result.text, /top-level interactive sessions/);
    }
    assert.deepEqual((await f.execute(root.agent, "/tidy extra")).result, { kind: "error", text: "Usage: /tidy" });
    assert.equal((await f.execute(root.agent, "/tidy", [{ type: "file", receiptId: "synthetic-receipt" }])).result.kind, "error");
    await assert.rejects(f.execute(root.agent, "/tidy", [], AbortSignal.abort(new Error("synthetic cancellation"))), /synthetic cancellation/);
    assert.deepEqual([root.received, child.received, resumedSubagent.received, removed.received], [[], [], [], []]);
  });

  await t.test("plugin unload removes only its section and command and permits clean remount", async (t) => {
    const f = await fixture(t);
    const { agent, received } = await f.agent();
    await f.ctx.plugin({ inject: ["systemPrompt", "commands"], apply(ctx) {
      ctx.systemPrompt.section({ name: "fixture:unrelated", order: 1, text: "Unrelated section" });
      ctx.commands.register({ name: "unrelated", description: "Unrelated command", handler: () => ({ kind: "success" }) });
    } });
    const plugin = await f.mount();
    assert.ok(renderPrompt(await f.assemble(agent)).includes("ALPHA_ONLY"));
    await plugin.dispose();
    assert.deepEqual((await f.assemble(agent)).sections.filter(({ text }) => text), [{ name: "fixture:unrelated", text: "Unrelated section" }]);
    assert.deepEqual(f.ctx.commands.list(agent).map(({ name }) => name), ["unrelated"]);
    assert.equal(f.ctx.commands.find(agent, "tidy"), undefined);
    const count = agent.session.seq;
    assert.equal(await f.execute(agent), undefined);
    assert.equal(agent.session.seq, count);
    assert.deepEqual(received, []);
    const remounted = await f.mount();
    assert.equal((await f.assemble(agent)).sections.filter(({ name }) => name === sectionName).length, 1);
    assert.equal(f.ctx.commands.list(agent).filter(({ name }) => name === "tidy").length, 1);
    assert.equal((await f.execute(agent)).result.kind, "success");
    assert.equal(received.length, 1);
    await remounted.dispose();
    assert.ok(!(await f.assemble(agent)).sections.some(({ name }) => name === sectionName));
  });

  await t.test("missing Commands keeps the plugin inactive in a minimal composition", async (t) => {
    const f = await fixture(t, { commands: false });
    const { agent } = await f.agent();
    // Do not await a fiber deliberately waiting for its hard dependency.
    const plugin = f.ctx.plugin(memoryPlugin, { directory: f.root });
    await Promise.resolve();
    assert.equal(f.ctx.get("commands"), undefined);
    assert.ok(!(await f.assemble(agent)).sections.some(({ name }) => name === sectionName));
    assert.deepEqual(f.cwdReads, []);
    await plugin.dispose();
  });
});
