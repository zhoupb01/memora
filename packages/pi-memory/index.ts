import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildMemoryPrompt, resolveMemoryRoot } from "./lib/core/index.js";

process.env.MEMORA_DREAM_SCRIPT = fileURLToPath(new URL("./lib/core/dream-cli.js", import.meta.url));

export default function (pi: ExtensionAPI) {
  let cached: { cwd: string; sessionId?: string; prompt: string } | undefined;
  pi.on("session_start", () => { cached = undefined; });
  pi.on("before_agent_start", (event, ctx) => {
    if (!ctx.hasUI) return;
    const cwd = ctx.cwd;
    const sessionId = ctx.sessionManager?.getSessionId?.();
    if (!cached || cached.cwd !== cwd || cached.sessionId !== sessionId) {
      cached = { cwd, sessionId, prompt: buildMemoryPrompt({ root: resolveMemoryRoot(), cwd }) };
    }
    event.systemPromptOptions.sections.memory = cached.prompt;
  });
}
