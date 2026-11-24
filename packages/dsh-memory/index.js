import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import Schema from "@deepseek-ai/schemastery";
import {
  buildDreamFollowup,
  buildMemoryPrompt,
  dreamCommandDescription,
  dreamCommandUsage,
  parseDreamCommandInput,
  resolveMemoryRoot,
} from "./lib/core/index.js";

const dreamScript = fileURLToPath(new URL("./lib/core/dream-cli.js", import.meta.url));

// The command surface is the interactive-profile boundary. In minimal/headless
// compositions without it, Cordis leaves this plugin inactive.
export const inject = ["agents", "systemPrompt", "workingDirectory", "commands"];

export const Config = Schema.object({
  directory: Schema.string().default("").description(
    "Memory root. Empty uses MEMORA_DIR, then ~/.agents/memory. Supports ~ and ~/.",
  ),
});

export function apply(ctx, config) {
  const root = resolveMemoryRoot(config.directory);
  const cache = new WeakMap();
  const eligible = (agent) => Boolean(
    agent && agent.session.header.origin !== "subagent" && ctx.agents.get(agent.id) === agent,
  );

  ctx.systemPrompt.section({
    name: "dsh-memory:memory",
    order: 10300,
    interpolate: false,
    text: ({ agent }) => {
      if (!eligible(agent)) return "";
      const cwd = ctx.workingDirectory.get(agent.session);
      const cached = cache.get(agent.session);
      if (cached && cached.cwd === cwd) return cached.prompt;
      const prompt = buildMemoryPrompt({ root, cwd });
      cache.set(agent.session, { cwd, prompt });
      return prompt;
    },
  });

  ctx.commands.register({
    name: "dream",
    description: dreamCommandDescription,
    handler: ({ agent, rawInput, attachments, signal }) => {
      signal.throwIfAborted();
      if (!eligible(agent)) {
        return { kind: "error", text: "Long-term memory is available in top-level interactive sessions only." };
      }
      if (attachments?.length) {
        return { kind: "error", text: dreamCommandUsage };
      }
      const parsed = parseDreamCommandInput(rawInput);
      if (!parsed.ok) {
        return { kind: "error", text: parsed.error };
      }

      const text = buildDreamFollowup({ script: dreamScript, root, args: parsed.args });
      agent.followup(Object.freeze({
        id: randomUUID(),
        role: "user",
        source: Object.freeze({ kind: "user" }),
        content: Object.freeze([Object.freeze({ type: "text", text })]),
      }));
      return { kind: "success" };
    },
  });
}
