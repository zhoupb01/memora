import { readFileSync } from "node:fs";
import { isMap, parseDocument } from "yaml";

export const noteTypes = ["user", "feedback", "project", "reference"] as const;

export function readNote(path: string) {
  const bytes = readFileSync(path);
  // Match delimiters in a one-character-per-byte view so the body is never re-encoded.
  const text = bytes.toString("latin1");
  const header = /^---\r?\n([\s\S]*?)^---(?:\r?\n|$)/m.exec(text);
  if (!header || header.index !== 0) {
    const issue = /^---\r?\n/.test(text) ? "missing closing frontmatter delimiter" : "missing frontmatter";
    return { body: bytes, issue };
  }

  const body = bytes.subarray(header[0].length);
  const yaml = Buffer.from(header[1], "latin1").toString("utf8");
  const document = parseDocument(yaml);
  if (document.errors.length) return { body, issue: `invalid YAML (${document.errors[0].code})` };
  if (!isMap(document.contents)) return { body, issue: "frontmatter is not a mapping" };
  let data: unknown;
  try {
    data = document.toJS();
  } catch (error) {
    return { body, issue: `invalid YAML (${error instanceof Error ? error.message : error})` };
  }
  if (!isMapping(data)) return { body, issue: "frontmatter is not a mapping" };
  return { body, fields: data };
}

export function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function oneLine(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && !/[\r\n]/.test(value);
}
