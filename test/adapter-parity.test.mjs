import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import test from "node:test";
import { buildMemoryPrompt } from "../packages/dsh-memory/memory.js";

// Load the actual TypeScript extension through Node's built-in type stripping.
// Only the host dependency is replaced; no adapter implementation is copied.
const hostFixture = new URL("./fixtures/pi-host.mjs", import.meta.url);
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@earendil-works/pi-coding-agent") {
      return { url: hostFixture.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
let installPi;
try {
  ({ default: installPi } = await import("../packages/pi-memory/index.ts"));
} finally {
  hooks.deregister();
}

const listeners = [];
installPi({ on: (name, listener) => listeners.push({ name, listener }) });
assert.equal(listeners.length, 1);
assert.equal(listeners[0].name, "before_agent_start");
const beforeAgentStart = listeners[0].listener;
const fixedNow = new Date(2026, 10, 12, 12, 0, 0).getTime();
const overflow = "(MEMORY.md is over 200 lines; the rest is not shown. Move outdated entries to cold storage to bring it back under 200 lines.)";

function fixture(t) {
  const temporaryBase = realpathSync(tmpdir());
  const directory = mkdtempSync(join(temporaryBase, "pi-dsh-adapter-parity-"));
  const originalMemoryDir = process.env.PI_MEMORY_DIR;
  const memoryRoot = join(directory, "memory");
  process.env.PI_MEMORY_DIR = memoryRoot;
  t.after(() => {
    if (originalMemoryDir === undefined) delete process.env.PI_MEMORY_DIR;
    else process.env.PI_MEMORY_DIR = originalMemoryDir;
    // Only remove the exact mkdtemp directory, never a caller-supplied path or
    // an unverified computed parent. A replaced/symlinked target fails closed.
    assert.equal(dirname(directory), temporaryBase);
    assert.ok(basename(directory).startsWith("pi-dsh-adapter-parity-"));
    assert.equal(realpathSync(directory), directory);
    rmSync(directory, { recursive: true });
  });
  t.mock.timers.enable({ apis: ["Date"], now: fixedNow });

  function contained(path) {
    const suffix = relative(directory, resolve(path));
    assert.ok(suffix !== ".." && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix));
    return path;
  }
  function mkdir(path) {
    mkdirSync(contained(path), { recursive: true });
    return path;
  }
  function put(path, content = "") {
    mkdir(dirname(path));
    writeFileSync(contained(path), content);
    return path;
  }
  // Project folder names are part of the shared on-disk format.
  const projectFolder = (cwd) => join(memoryRoot, "projects", process.platform === "win32"
    ? cwd.replaceAll("/", "-").replaceAll("\\", "-").replaceAll(":", "-")
    : cwd.replaceAll("/", "-"));
  const globalFolder = join(memoryRoot, "global");
  const event = () => ({ systemPromptOptions: { sections: { unrelated: "preserve this section" } } });
  function compare(cwd, input = event()) {
    beforeAgentStart(input, { hasUI: true, cwd });
    const piText = input.systemPromptOptions.sections.memory;
    const dshText = buildMemoryPrompt({ root: memoryRoot, cwd, today: new Date() });
    assert.equal(typeof piText, "string");
    assert.ok(piText.startsWith("# Long-term memory\n"));
    assert.equal(piText, dshText, "the real pi callback and DSH builder must produce identical complete text");
    assert.equal(input.systemPromptOptions.sections.unrelated, "preserve this section");
    assert.deepEqual(Object.keys(input.systemPromptOptions.sections).sort(), ["memory", "unrelated"]);
    return piText;
  }
  return { directory, memoryRoot, globalFolder, projectFolder, mkdir, put, event, compare };
}

// Environment and Date are process-global, so subtests run sequentially and
// restore their state. Both adapters now use the same built core implementation.
test("pi and DSH runtime prompt parity", {
  concurrency: false,
}, async (t) => {
  await t.test("missing indexes and archives use the same empty state and cwd fallback", (t) => {
    const f = fixture(t);
    const cwd = f.mkdir(join(f.directory, "no-git", "nested"));
    // Prove this case is actually testing the no-Git branch, even when TMPDIR
    // was configured by the caller; never create markers outside the fixture.
    for (let path = cwd; ; path = dirname(path)) {
      assert.ok(!existsSync(join(path, ".git")), `no-Git fixture has a .git ancestor: ${path}`);
      if (dirname(path) === path) break;
    }
    const prompt = f.compare(cwd);
    assert.ok(prompt.includes(`(project: ${cwd})`));
    assert.equal(prompt.split("(no memories yet)").length - 1, 2);
    assert.equal(prompt.split("(0 memories)").length - 1, 2);
    assert.ok(prompt.includes("- Today is 2026-11-12"));
  });

  await t.test("global and nearest-project indexes preserve Unicode, whitespace and literal braces", (t) => {
    const f = fixture(t);
    const project = f.mkdir(join(f.directory, "project with {{braces}}"));
    f.mkdir(join(project, ".git"));
    const cwd = f.mkdir(join(project, "src", "nested"));
    f.put(join(f.globalFolder, "MEMORY.md"), "- [偏好](brief.md) — 全局中文 {{literal}}\n\n");
    f.put(join(f.projectFolder(project), "MEMORY.md"), "- [演示](demo.md) — 2026-11-20 项目演示\n\n");
    f.put(join(f.globalFolder, "brief.md"), "HOT_BODY_IS_NOT_AN_INDEX");
    f.put(join(f.projectFolder(project), "demo.md"), "PROJECT_BODY_IS_NOT_AN_INDEX");
    const prompt = f.compare(cwd);
    assert.ok(prompt.includes("### Global MEMORY.md\n\n- [偏好](brief.md) — 全局中文 {{literal}}\n\n### Project MEMORY.md"));
    assert.ok(prompt.endsWith("- [演示](demo.md) — 2026-11-20 项目演示"));
    assert.ok(prompt.includes(`(project: ${project})`));
    assert.ok(!prompt.includes("HOT_BODY_IS_NOT_AN_INDEX"));
    assert.ok(!prompt.includes("PROJECT_BODY_IS_NOT_AN_INDEX"));
  });

  await t.test("each index independently keeps 200 lines and adds the exact overflow warning", (t) => {
    const f = fixture(t);
    const cwd = f.mkdir(join(f.directory, "index-limits"));
    f.mkdir(join(cwd, ".git"));
    const globalLines = Array.from({ length: 200 }, (_, i) => `GLOBAL_LINE_${i + 1}`);
    const projectLines = Array.from({ length: 200 }, (_, i) => `PROJECT_LINE_${i + 1}`);
    const globalIndex = join(f.globalFolder, "MEMORY.md");
    const projectIndex = join(f.projectFolder(cwd), "MEMORY.md");
    f.put(globalIndex, `${globalLines.join("\n")}\n\n`);
    f.put(projectIndex, `${projectLines.join("\n")}\n`);
    const exact = f.compare(cwd);
    assert.ok(exact.includes("GLOBAL_LINE_200"));
    assert.ok(exact.includes("PROJECT_LINE_200"));
    assert.ok(!exact.includes(overflow));

    f.put(globalIndex, `${globalLines.join("\n")}\nGLOBAL_LINE_201`);
    f.put(projectIndex, `${projectLines.join("\n")}\nPROJECT_LINE_201\nPROJECT_LINE_202`);
    const truncated = f.compare(cwd);
    assert.equal(truncated.split(overflow).length - 1, 2);
    assert.ok(truncated.includes(`GLOBAL_LINE_200\n${overflow}`));
    assert.ok(truncated.includes(`PROJECT_LINE_200\n${overflow}`));
    assert.ok(!truncated.includes("GLOBAL_LINE_201"));
    assert.ok(!truncated.includes("PROJECT_LINE_201"));
    assert.ok(!truncated.includes("PROJECT_LINE_202"));
  });

  await t.test("cold storage counts only immediate lowercase .md names without injecting bodies", (t) => {
    const f = fixture(t);
    const cwd = f.mkdir(join(f.directory, "cold-storage"));
    f.mkdir(join(cwd, ".git"));
    const globalArchive = join(f.globalFolder, "archive");
    const projectArchive = join(f.projectFolder(cwd), "archive");
    f.put(join(globalArchive, "one.md"), "GLOBAL_COLD_BODY_ONE");
    f.put(join(globalArchive, "two.md"), "GLOBAL_COLD_BODY_TWO");
    f.put(join(globalArchive, "ignore.MD"), "UPPERCASE_COLD_BODY");
    f.put(join(globalArchive, "ignore.txt"), "TEXT_COLD_BODY");
    f.put(join(globalArchive, "nested", "hidden.md"), "NESTED_COLD_BODY");
    f.put(join(projectArchive, "old.md"), "PROJECT_COLD_BODY");
    const prompt = f.compare(cwd);
    assert.ok(prompt.includes(`- Global cold storage: ${globalArchive} (2 memories)`));
    assert.ok(prompt.includes(`- Project cold storage: ${projectArchive} (1 memories)`));
    assert.ok(!prompt.includes("COLD_BODY"));
  });

  await t.test("the same pi callback refreshes indexes, archive counts, cwd and date", (t) => {
    const f = fixture(t);
    const alpha = f.mkdir(join(f.directory, "alpha"));
    const beta = f.mkdir(join(f.directory, "beta"));
    for (const cwd of [alpha, beta]) f.mkdir(join(cwd, ".git"));
    const event = f.event();
    f.put(join(f.globalFolder, "MEMORY.md"), "GLOBAL_BEFORE");
    f.put(join(f.projectFolder(alpha), "MEMORY.md"), "ALPHA_ONLY");
    f.put(join(f.projectFolder(beta), "MEMORY.md"), "BETA_BEFORE");
    assert.ok(f.compare(alpha, event).includes("ALPHA_ONLY"));
    const switched = f.compare(beta, event);
    assert.ok(switched.includes("BETA_BEFORE"));
    assert.ok(!switched.includes("ALPHA_ONLY"));

    f.put(join(f.globalFolder, "MEMORY.md"), "GLOBAL_AFTER");
    f.put(join(f.projectFolder(beta), "MEMORY.md"), "BETA_AFTER");
    f.put(join(f.projectFolder(beta), "archive", "new.md"), "ARCHIVE_BODY");
    t.mock.timers.setTime(new Date(2026, 10, 13, 0, 5, 0).getTime());
    const updated = f.compare(beta, event);
    assert.ok(updated.includes("GLOBAL_AFTER"));
    assert.ok(updated.includes("BETA_AFTER"));
    assert.ok(!updated.includes("GLOBAL_BEFORE"));
    assert.ok(!updated.includes("BETA_BEFORE"));
    assert.ok(updated.includes(`- Project cold storage: ${join(f.projectFolder(beta), "archive")} (1 memories)`));
    assert.ok(updated.includes("- Today is 2026-11-13"));
    assert.ok(!updated.includes("- Today is 2026-11-12"));
    assert.equal(updated.split("## Current state").length - 1, 1);
  });

  await t.test("a nearer .git file selects a worktree root ahead of an outer repository", (t) => {
    const f = fixture(t);
    const outer = f.mkdir(join(f.directory, "outer"));
    f.mkdir(join(outer, ".git"));
    const worktree = f.mkdir(join(outer, "worktree"));
    f.put(join(worktree, ".git"), `gitdir: ${join(f.directory, "synthetic-git-metadata")}\n`);
    const cwd = f.mkdir(join(worktree, "src"));
    f.put(join(f.projectFolder(outer), "MEMORY.md"), "OUTER_SHOULD_NOT_APPEAR");
    f.put(join(f.projectFolder(worktree), "MEMORY.md"), "WORKTREE_SHOULD_APPEAR");
    f.put(join(f.projectFolder(cwd), "MEMORY.md"), "CWD_SHOULD_NOT_APPEAR");
    const prompt = f.compare(cwd);
    assert.ok(prompt.includes(`(project: ${worktree})`));
    assert.ok(prompt.includes("WORKTREE_SHOULD_APPEAR"));
    assert.ok(!prompt.includes("OUTER_SHOULD_NOT_APPEAR"));
    assert.ok(!prompt.includes("CWD_SHOULD_NOT_APPEAR"));
  });

  await t.test("pi without hasUI leaves all sections untouched and never resolves a real home", (t) => {
    const f = fixture(t);
    delete process.env.PI_MEMORY_DIR;
    for (const hasUI of [false, undefined]) {
      const event = f.event();
      const original = structuredClone(event);
      beforeAgentStart(event, {
        hasUI,
        get cwd() { throw new Error("noninteractive pi must not inspect cwd"); },
      });
      assert.deepEqual(event, original);
    }
    // Also prove the host import was intercepted: interactive use with no
    // override fails in the controlled fixture instead of touching real home.
    assert.throws(() => beforeAgentStart(f.event(), { hasUI: true, cwd: f.directory }), /pi parity fixture requires PI_MEMORY_DIR/);
  });
});
