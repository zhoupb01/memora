import { readFileSync } from "node:fs";
import { isMap, parseDocument, stringify } from "yaml";

export const noteTypes = ["user", "feedback", "project", "reference"];

export function isMapping(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function oneLine(value) {
  return typeof value === "string" && value.trim() !== "" && !/[\r\n]/.test(value);
}

export function readNote(path) {
  const bytes = readFileSync(path);
  // Match delimiters in a 1-char-per-byte view so the body is never re-encoded.
  const text = bytes.toString("latin1");
  const header = /^---\r?\n([\s\S]*?)^---(?:\r?\n|$)/m.exec(text);
  if (!header || header.index !== 0) {
    const issue = /^---\r?\n/.test(text) ? "missing closing frontmatter delimiter" : "missing frontmatter";
    return { body: bytes, issue };
  }

  const body = bytes.subarray(header[0].length);
  const yamlText = Buffer.from(header[1], "latin1").toString("utf8");
  const document = parseDocument(yamlText);
  if (document.errors.length) {
    return { body, issue: `invalid YAML (${document.errors[0].code || document.errors[0].message})` };
  }
  if (!isMap(document.contents)) {
    return { body, issue: "frontmatter is not a mapping" };
  }
  let data;
  try {
    data = document.toJS();
  } catch (error) {
    return { body, issue: `invalid YAML (${error instanceof Error ? error.message : error})` };
  }
  if (!isMapping(data)) {
    return { body, issue: "frontmatter is not a mapping" };
  }
  return { body, fields: data };
}

export function stringifyFrontmatter(fields) {
  return stringify(fields, { lineWidth: 0 });
}
