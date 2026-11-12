import { join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildMemoryPrompt } from "./lib/core/index.js";

export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", (event, ctx) => {
    if (!ctx.hasUI) return;
    const root = resolve(process.env.PI_MEMORY_DIR ?? join(getAgentDir(), "memory"));
    event.systemPromptOptions.sections.memory = buildMemoryPrompt({ root, cwd: ctx.cwd });
  });
}
