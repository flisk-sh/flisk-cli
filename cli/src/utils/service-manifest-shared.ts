// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

// Pieces of the service.json checks that more than one validator module needs.

/**
 * A name in `secrets.required` / `secrets.optional` that `params` or `env` also sets to a literal: the literal reaches the
 * container, so the secret in `.env` is silently never used (an admin account created with "changeme").
 */
export const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Line breaks (including the Unicode ones YAML 1.1 honours) and other control characters. */
export function hasLineBreakOrControl(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code === 0x7f || code === 0x85 || code === 0x2028 || code === 0x2029) {
      return true;
    }
  }
  return false;
}

/** Plain text that is safe inside a JSON (double-quoted YAML) string: no line break or control character. */
export const isPlainText = (value: unknown): value is string =>
  typeof value === "string" && !hasLineBreakOrControl(value);

const RESOURCE_FILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const RESOURCE_FILE_PATH_PATTERN =
  /^(?!\.$)(?:[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*|\.{1,2}(?:\/[A-Za-z0-9_.-]+)+)$/;
const SECRET_CONFIG_FILE_KEYS = ["name", "source", "target", "uid", "gid", "mode"];
const CONTAINER_TARGET_PATTERN = /^\/[A-Za-z0-9_./-]*$/;

/** One entry of `secrets.files` or `configs`: both fields hold the same { name, source, target, uid?, gid?, mode? } file record. */
export function validateSecretConfigFileEntry(
  entry: unknown,
  field: string,
  kind: "secret" | "config",
): string[] {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return [
      `${field}: expected an object like { "name": "...", "source": "...", "target": "..." }`,
    ];
  }
  const errors: string[] = [];
  const rec = entry as Record<string, unknown>;
  for (const key of Object.keys(rec)) {
    if (!SECRET_CONFIG_FILE_KEYS.includes(key)) {
      errors.push(`${field}.${key}: unknown option (use ${SECRET_CONFIG_FILE_KEYS.join(", ")})`);
    }
  }
  const name = rec.name;
  if (typeof name !== "string" || !RESOURCE_FILE_NAME_PATTERN.test(name)) {
    errors.push(
      `${field}.name: ${JSON.stringify(name)} is not a valid ${kind} identifier name (letters, digits, dashes, dots and underscores)`,
    );
  }
  const source = rec.source;
  if (
    typeof source !== "string" ||
    !RESOURCE_FILE_PATH_PATTERN.test(source) ||
    source.includes("/../") ||
    source.endsWith("/..")
  ) {
    errors.push(
      `${field}.source: expected a relative path inside the project such as ./config or ./file.txt`,
    );
  }
  const target = rec.target;
  if (
    target !== undefined &&
    (typeof target !== "string" || !CONTAINER_TARGET_PATTERN.test(target))
  ) {
    errors.push(`${field}.target: expected an absolute container path such as /etc/config`);
  }
  const uid = rec.uid;
  if (uid !== undefined && typeof uid !== "string" && typeof uid !== "number") {
    errors.push(`${field}.uid: expected a string or number user ID`);
  }
  const gid = rec.gid;
  if (gid !== undefined && typeof gid !== "string" && typeof gid !== "number") {
    errors.push(`${field}.gid: expected a string or number group ID`);
  }
  const mode = rec.mode;
  const numericModeOk =
    typeof mode === "number" && Number.isInteger(mode) && mode >= 0 && mode <= 0o7777;
  const stringModeOk = typeof mode === "string" && /^0?[0-7]{3,4}$/.test(mode);
  if (mode !== undefined && !numericModeOk && !stringModeOk) {
    errors.push(`${field}.mode: expected an octal file mode such as 0440, "0440" or 288`);
  }
  return errors;
}
