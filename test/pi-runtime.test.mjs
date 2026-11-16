import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { readDreamTemplate } from "../packages/core/index.js";

const runtime = process.env.PI_TEST_RUNTIME;

test("Pi loads the packaged /dream template with valid YAML metadata", {
  skip: runtime ? false : "Set PI_TEST_RUNTIME to an installed @earendil-works/pi-coding-agent package directory.",
}, async () => {
  const { loadPromptTemplates } = await import(pathToFileURL(
    resolve(runtime, "dist/core/prompt-templates.js"),
  ).href);
  const cwd = fileURLToPath(new URL("../", import.meta.url));
  const result = loadPromptTemplates({
    cwd,
    agentDir: resolve(cwd, ".unused-pi-agent"),
    promptPaths: [fileURLToPath(new URL("../packages/pi-memory/lib/core/dream.md", import.meta.url))],
    includeDefaults: false,
  });
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.templates.length, 1);
  assert.equal(result.templates[0].name, "dream");
  const expected = readDreamTemplate();
  assert.equal(result.templates[0].description, expected.description);
  assert.equal(result.templates[0].content.trimEnd(), expected.text);
});
