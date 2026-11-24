import { readFileSync } from "node:fs";
import { buildMemoryPrompt, resolveMemoryRoot } from "./lib/core/index.js";

const raw = readFileSync(0, "utf8").trim();
const input = raw ? JSON.parse(raw) : {};
const cwd = input.cwd || input.workspacePaths?.[0] || process.cwd();
const root = resolveMemoryRoot();
const prompt = buildMemoryPrompt({ root, cwd });

process.stdout.write(`${JSON.stringify({
  injectSteps: [
    {
      systemMessage: {
        systemMessage: prompt,
      },
    },
  ],
})}\n`);
