import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildMemoryPrompt, resolveMemoryRoot } from "./lib/core/index.js";

process.env.MEMORA_DREAM_SCRIPT = fileURLToPath(new URL("./lib/core/dream-cli.js", import.meta.url));

export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", (event, ctx) => {
    if (!ctx.hasUI) return;
    const root = resolveMemoryRoot();
    event.systemPromptOptions.sections.memory = buildMemoryPrompt({ root, cwd: ctx.cwd });
  });
}
