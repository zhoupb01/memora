import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { resolveMemoryRoot } from "../memory.js";

// Host-specific policy stays in the DSH adapter; the core never reads these env vars.
test("DSH memory root priority, home expansion, and empty environment", () => {
  const home = resolve("test-home");
  assert.equal(resolveMemoryRoot(undefined, {}, home), join(home, ".dsh", "memory"));
  assert.equal(resolveMemoryRoot("", { DSH_HOME: "~/custom" }, home), join(home, "custom", "memory"));
  assert.equal(resolveMemoryRoot("", { DSH_HOME: " ", DSH_MEMORY_DIR: " " }, home), join(home, ".dsh", "memory"));
  assert.equal(resolveMemoryRoot("", { DSH_MEMORY_DIR: "~/shared", DSH_HOME: "~/unused" }, home), join(home, "shared"));
  assert.equal(resolveMemoryRoot("~/explicit", { DSH_MEMORY_DIR: "~/unused" }, home), join(home, "explicit"));
});
