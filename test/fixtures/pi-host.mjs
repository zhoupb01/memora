import { dirname } from "node:path";

// The real pi host is intentionally never loaded by the parity suite. A missing
// override must fail here instead of resolving the developer's real agent home.
export function getAgentDir() {
  const memoryRoot = process.env.PI_MEMORY_DIR;
  if (!memoryRoot) {
    throw new Error("The pi parity fixture requires PI_MEMORY_DIR; real agent homes are unavailable.");
  }
  return dirname(memoryRoot);
}
