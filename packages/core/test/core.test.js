import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import { buildMemoryPrompt, readDreamTemplate } from "../index.js";

const overflowWarning = "(MEMORY.md is over 200 lines; the rest is not shown. Move outdated entries to cold storage to bring it back under 200 lines.)";
const fixedDate = () => new Date(2026, 10, 12, 0, 5);

function fixture(t) {
  const temporaryBase = realpathSync(tmpdir());
  const directory = mkdtempSync(join(temporaryBase, "memora-core-test-"));
  const root = join(directory, "memory");
  const cwd = join(directory, "project");
  mkdirSync(cwd);
  t.after(() => {
    // Only remove the exact canonical directory created by this test.
    assert.equal(dirname(directory), temporaryBase);
    assert.ok(basename(directory).startsWith("memora-core-test-"));
    assert.equal(realpathSync(directory), directory);
    rmSync(directory, { recursive: true, force: true });
  });
  return { directory, root, cwd };
}

function put(path, text = "") {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

// This is the documented on-disk project naming convention, not a core helper.
function projectFolder(root, project) {
  const name = process.platform === "win32"
    ? project.replaceAll("/", "-").replaceAll("\\", "-").replaceAll(":", "-")
    : project.replaceAll("/", "-");
  return join(root, "projects", name);
}

function indexes(prompt) {
  const state = prompt.slice(prompt.indexOf("\n\n## Current state\n\n"));
  const globalHeading = "### Global MEMORY.md\n\n";
  const projectHeading = "\n\n### Project MEMORY.md\n\n";
  const start = state.indexOf(globalHeading) + globalHeading.length;
  const split = state.indexOf(projectHeading, start);
  assert.ok(start >= globalHeading.length && split >= start, "both index headings must be present");
  return {
    global: state.slice(start, split),
    project: state.slice(split + projectHeading.length),
  };
}

function prompt(f, options = {}) {
  return buildMemoryPrompt({ root: f.root, cwd: f.cwd, today: fixedDate(), ...options });
}

test("missing, empty and whitespace-only indexes produce the original empty state", (t) => {
  const f = fixture(t);
  const empty = { global: "(no memories yet)", project: "(no memories yet)" };
  assert.deepEqual(indexes(prompt(f)), empty);
  assert.ok(prompt(f).includes(`- Global cold storage: ${join(f.root, "global", "archive")} (0 memories)`));
  assert.ok(prompt(f).includes(`- Project cold storage: ${join(projectFolder(f.root, f.cwd), "archive")} (0 memories)`));
  put(join(f.root, "global", "MEMORY.md"), "");
  put(join(projectFolder(f.root, f.cwd), "MEMORY.md"), " \n\t\n");
  assert.deepEqual(indexes(prompt(f)), empty);
});

test("index loading preserves leading text and removes only trailing whitespace", (t) => {
  const f = fixture(t);
  put(join(f.root, "global", "MEMORY.md"), "  - global entry\n\n  ");
  put(join(projectFolder(f.root, f.cwd), "MEMORY.md"), "\n- project entry\n");
  assert.deepEqual(indexes(prompt(f)), { global: "  - global entry", project: "\n- project entry" });
});

for (const [globalCount, projectCount] of [[200, 201], [201, 200]]) {
  test(`index limits are independent: global ${globalCount} lines, project ${projectCount} lines`, (t) => {
    const f = fixture(t);
    const globalLines = Array.from({ length: globalCount }, (_, i) => `global-line-${i + 1}`);
    const projectLines = Array.from({ length: projectCount }, (_, i) => `project-line-${i + 1}`);
    put(join(f.root, "global", "MEMORY.md"), `${globalLines.join("\n")}\n`);
    put(join(projectFolder(f.root, f.cwd), "MEMORY.md"), `${projectLines.join("\n")}\n`);
    const shown = indexes(prompt(f));
    for (const [scope, lines] of [["global", globalLines], ["project", projectLines]]) {
      const expected = lines.slice(0, 200).join("\n") + (lines.length > 200 ? `\n${overflowWarning}` : "");
      assert.equal(shown[scope], expected);
      assert.ok(!shown[scope].includes(`${scope}-line-201`));
    }
  });
}

test("global memory is shared while project indexes stay isolated", (t) => {
  const f = fixture(t);
  const other = join(f.directory, "other-project");
  mkdirSync(other);
  put(join(f.root, "global", "MEMORY.md"), "GLOBAL_SHARED");
  put(join(projectFolder(f.root, f.cwd), "MEMORY.md"), "PROJECT_ALPHA_ONLY");
  put(join(projectFolder(f.root, other), "MEMORY.md"), "PROJECT_BETA_ONLY");
  const alpha = prompt(f);
  const beta = prompt(f, { cwd: other });
  assert.deepEqual(indexes(alpha), { global: "GLOBAL_SHARED", project: "PROJECT_ALPHA_ONLY" });
  assert.deepEqual(indexes(beta), { global: "GLOBAL_SHARED", project: "PROJECT_BETA_ONLY" });
  assert.ok(!alpha.includes("PROJECT_BETA_ONLY"));
  assert.ok(!beta.includes("PROJECT_ALPHA_ONLY"));
});

test("without a Git marker the current working directory is the project root", (t) => {
  const f = fixture(t);
  const cwd = join(f.cwd, "src", "nested");
  mkdirSync(cwd, { recursive: true });
  put(join(projectFolder(f.root, f.cwd), "MEMORY.md"), "PARENT_MUST_NOT_BE_SELECTED");
  put(join(projectFolder(f.root, cwd), "MEMORY.md"), "CURRENT_DIRECTORY_SELECTED");
  const text = prompt(f, { cwd });
  assert.ok(text.includes(`(project: ${cwd})`));
  assert.equal(indexes(text).project, "CURRENT_DIRECTORY_SELECTED");
  assert.ok(!text.includes("PARENT_MUST_NOT_BE_SELECTED"));
});

test("the closest .git directory determines the project root", (t) => {
  const f = fixture(t);
  const nested = join(f.cwd, "nested-repository");
  const cwd = join(nested, "src");
  mkdirSync(join(f.cwd, ".git"));
  mkdirSync(join(nested, ".git"), { recursive: true });
  mkdirSync(cwd);
  put(join(projectFolder(f.root, f.cwd), "MEMORY.md"), "OUTER_REPOSITORY");
  put(join(projectFolder(f.root, nested), "MEMORY.md"), "NEAREST_REPOSITORY");
  const text = prompt(f, { cwd });
  assert.ok(text.includes(`(project: ${nested})`));
  assert.equal(indexes(text).project, "NEAREST_REPOSITORY");
  assert.ok(!text.includes("OUTER_REPOSITORY"));
});

test("a worktree .git file is a project marker and wins over an ancestor", (t) => {
  const f = fixture(t);
  const worktree = join(f.cwd, "worktree");
  const cwd = join(worktree, "src");
  mkdirSync(join(f.cwd, ".git"));
  mkdirSync(cwd, { recursive: true });
  put(join(worktree, ".git"), `gitdir: ${join(f.directory, "synthetic-git-metadata")}\n`);
  put(join(projectFolder(f.root, f.cwd), "MEMORY.md"), "OUTER_REPOSITORY");
  put(join(projectFolder(f.root, worktree), "MEMORY.md"), "WORKTREE_MEMORY");
  const text = prompt(f, { cwd });
  assert.ok(text.includes(`(project: ${worktree})`));
  assert.equal(indexes(text).project, "WORKTREE_MEMORY");
  assert.ok(!text.includes("OUTER_REPOSITORY"));
});

for (const scope of ["global", "project"]) {
  test(`${scope} index read failures other than ENOENT propagate`, (t) => {
    const f = fixture(t);
    const folder = scope === "global" ? join(f.root, "global") : projectFolder(f.root, f.cwd);
    // A directory at the index pathname produces EISDIR without permission or
    // user-account assumptions; no chmod or real files are needed.
    mkdirSync(join(folder, "MEMORY.md"), { recursive: true });
    assert.throws(() => prompt(f), { code: "EISDIR" });
  });

  test(`${scope} archive read failures other than ENOENT propagate`, (t) => {
    const f = fixture(t);
    const folder = scope === "global" ? join(f.root, "global") : projectFolder(f.root, f.cwd);
    put(join(folder, "archive"), "This fixture is a file, not an archive directory.");
    assert.throws(() => prompt(f), { code: "ENOTDIR" });
  });
}

test("cold storage counts only immediate lowercase .md names and injects no bodies", (t) => {
  const f = fixture(t);
  const global = join(f.root, "global");
  const project = projectFolder(f.root, f.cwd);
  put(join(global, "MEMORY.md"), "GLOBAL_INDEX_ONLY");
  put(join(project, "MEMORY.md"), "PROJECT_INDEX_ONLY");
  put(join(global, "hot.md"), "GLOBAL_HOT_BODY_MUST_STAY_OUT");
  put(join(project, "hot.md"), "PROJECT_HOT_BODY_MUST_STAY_OUT");
  for (const [folder, names] of [[global, ["one.md", "two.md"]], [project, ["three.md"]]]) {
    for (const name of names) put(join(folder, "archive", name), `COLD_BODY_MUST_STAY_OUT: ${name}`);
    put(join(folder, "archive", "ignored.txt"), "IGNORED_TEXT_BODY_MUST_STAY_OUT");
    put(join(folder, "archive", "ignored.MD"), "UPPERCASE_BODY_MUST_STAY_OUT");
    put(join(folder, "archive", "nested", "nested.md"), "NESTED_BODY_MUST_STAY_OUT");
  }
  const text = prompt(f);
  assert.ok(text.includes(`- Global cold storage: ${join(global, "archive")} (2 memories)`));
  assert.ok(text.includes(`- Project cold storage: ${join(project, "archive")} (1 memories)`));
  assert.deepEqual(indexes(text), { global: "GLOBAL_INDEX_ONLY", project: "PROJECT_INDEX_ONLY" });
  assert.ok(!text.includes("BODY_MUST_STAY_OUT"));
});

test("successive calls refresh local date, cwd, indexes and archive counts", (t) => {
  const f = fixture(t);
  const other = join(f.directory, "second-project");
  mkdirSync(other);
  put(join(f.root, "global", "MEMORY.md"), "GLOBAL_BEFORE");
  put(join(projectFolder(f.root, f.cwd), "MEMORY.md"), "PROJECT_BEFORE");
  const first = prompt(f, { today: new Date(2026, 10, 12, 23, 59) });
  put(join(f.root, "global", "MEMORY.md"), "GLOBAL_AFTER");
  put(join(projectFolder(f.root, other), "MEMORY.md"), "PROJECT_AFTER");
  put(join(f.root, "global", "archive", "newly-archived.md"), "ARCHIVED_BODY_MUST_STAY_OUT");
  const second = prompt(f, { cwd: other, today: new Date(2026, 10, 13, 0, 1) });
  assert.ok(first.includes("- Today is 2026-11-12"));
  assert.ok(second.includes("- Today is 2026-11-13"));
  assert.deepEqual(indexes(first), { global: "GLOBAL_BEFORE", project: "PROJECT_BEFORE" });
  assert.deepEqual(indexes(second), { global: "GLOBAL_AFTER", project: "PROJECT_AFTER" });
  assert.ok(second.includes(`(project: ${other})`));
  assert.ok(!second.includes(`(project: ${f.cwd})`));
  assert.ok(second.includes(`- Global cold storage: ${join(f.root, "global", "archive")} (1 memories)`));
  assert.ok(!second.includes("ARCHIVED_BODY_MUST_STAY_OUT"));

  put(join(projectFolder(f.root, other), "MEMORY.md"), "PROJECT_UPDATED_IN_PLACE");
  assert.equal(indexes(prompt(f, { cwd: other })).project, "PROJECT_UPDATED_IN_PLACE");
});

test("the entire guide and current-state layout are preserved literally", (t) => {
  const f = fixture(t);
  const cwd = join(f.directory, "项目 with {{literal-braces}}");
  mkdirSync(cwd);
  const global = join(f.root, "global");
  const project = projectFolder(f.root, cwd);
  const globalIndex = "- [偏好](preferences.md) — 回答简洁，保留 {{literal-text}}";
  const projectIndex = "- [上线](launch.md) — 2026-11-20 上线";
  put(join(global, "MEMORY.md"), `${globalIndex}\n\n`);
  put(join(project, "MEMORY.md"), `${projectIndex}\n`);
  put(join(global, "archive", "past.md"), "COLD_BODY_MUST_STAY_OUT");
  // Read the sole prompt source as expected data; never edit it or inject a
  // substitute guide path into the core public interface.
  const guide = readFileSync(new URL("../GUIDE.md", import.meta.url), "utf8").trimEnd();
  const expected = `${guide}

## Current state

- Today is 2026-11-12
- Global memory folder: ${global}
- Global cold storage: ${join(global, "archive")} (1 memories)
- Project memory folder: ${project} (project: ${cwd})
- Project cold storage: ${join(project, "archive")} (0 memories)

### Global MEMORY.md

${globalIndex}

### Project MEMORY.md

${projectIndex}`;
  assert.equal(prompt(f, { cwd }), expected);
});

test("dream returns the shared description and full body without frontmatter", () => {
  assert.deepEqual(readDreamTemplate(), {
    description: "Dream — tidy long-term memory; delete wrong ones, archive outdated ones, merge duplicates",
    text: 'Dream now: tidy up long-term memory. Follow the checklist in the "Dreaming" section of the long-term memory instructions step by step, then report as its step 5 says.',
  });
});
