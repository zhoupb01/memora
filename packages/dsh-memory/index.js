import { randomUUID } from "node:crypto";
import Schema from "@deepseek-ai/schemastery";
import { buildMemoryPrompt, readTidyTemplate, resolveMemoryRoot } from "./memory.js";

// The command surface is the interactive-profile boundary. In minimal/headless
// compositions without it, Cordis leaves this plugin inactive.
export const inject = ["agents", "systemPrompt", "workingDirectory", "commands"];

export const Config = Schema.object({
  directory: Schema.string().default("").description(
    "Memory root. Empty uses DSH_MEMORY_DIR, then $DSH_HOME/memory or ~/.dsh/memory. Supports ~/.",
  ),
});

export function apply(ctx, config) {
  const root = resolveMemoryRoot(config.directory);
  const eligible = (agent) => Boolean(
    agent && agent.session.header.origin !== "subagent" && ctx.agents.roots().includes(agent),
  );

  // Global provider, agent-specific computation: no per-agent mutable cache,
  // lifecycle listeners, or registrations that can outlive this plugin.
  ctx.systemPrompt.section({
    name: "dsh-memory:memory",
    order: 10300,
    interpolate: false,
    text: ({ agent }) => eligible(agent)
      ? buildMemoryPrompt({ root, cwd: ctx.workingDirectory.get(agent.session) })
      : "",
  });

  const template = readTidyTemplate();
  ctx.commands.register({
    name: "tidy",
    description: template.description,
    handler: ({ agent, rawInput, signal }) => {
      signal.throwIfAborted();
      if (!eligible(agent)) {
        return { kind: "error", text: "Long-term memory is available in top-level interactive sessions only." };
      }
      if (rawInput.trim()) return { kind: "error", text: "Usage: /tidy" };

      // A human slash command becomes a normal, identified user message. Use
      // the public UserMessage shape; followup records it in the durable inbox.
      agent.followup(Object.freeze({
        id: randomUUID(),
        role: "user",
        source: Object.freeze({ kind: "user" }),
        content: Object.freeze([Object.freeze({ type: "text", text: readTidyTemplate().text })]),
      }));
      return { kind: "success" };
    },
  });
}
