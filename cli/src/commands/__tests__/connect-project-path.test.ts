import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  createTempDir,
  createTempProject,
  parseEnvelope,
  runFlisk,
} from "../../test-support/index.js";

it("previews writes in the explicit project directory", () => {
  const root = createTempProject();
  const cwd = createTempDir("connect-from");
  const result = runFlisk(["connect", "claude", "--project", root, "--dry-run", "--json"], { cwd });
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(JSON.stringify(parseEnvelope(result.stdout).data)).toContain(join(root, ".mcp.json"));
  expect(existsSync(join(root, ".mcp.json"))).toBe(false);
  const bare = runFlisk(["connect", "claude", "--project", "--dry-run", "--json"], { cwd: root });
  expect(bare.status, bare.stdout + bare.stderr).toBe(0);
});

it("rejects a file path and writes nothing", () => {
  const root = createTempProject();
  const file = join(root, "afile.txt");
  writeFileSync(file, "x");
  const result = runFlisk(["connect", "claude", "--project", file], {
    cwd: createTempDir("connect-from"),
  });
  expect(result.status, result.stdout + result.stderr).not.toBe(0);
  expect(result.stderr).toContain(`No Flisk project at ${file} (not an existing directory)`);
  expect(result.stderr).toContain("flisk connect --project <path>");
  expect(existsSync(join(root, ".mcp.json"))).toBe(false);
  expect(existsSync(join(root, ".claude"))).toBe(false);
});

it("rejects a nonexistent path with the same message", () => {
  const missing = join(createTempDir("connect-noparent-"), "missing");
  const result = runFlisk(["connect", "claude", "--project", missing], {
    cwd: createTempDir("connect-from"),
  });
  expect(result.status, result.stdout + result.stderr).not.toBe(0);
  expect(result.stderr).toContain(`No Flisk project at ${missing} (not an existing directory)`);
});

it("rejects a directory without a project with the shared message", () => {
  const empty = createTempDir("connect-noproject-");
  const result = runFlisk(["connect", "claude", "--project", empty], {
    cwd: createTempDir("connect-from"),
  });
  expect(result.status, result.stdout + result.stderr).not.toBe(0);
  expect(result.stderr).toContain(`No Flisk project at ${empty} (no .flisk/project.json found)`);
  expect(result.stderr).toContain("flisk connect --project <path>");
});

it("reports a file path rejection as a JSON envelope", () => {
  const root = createTempProject();
  const file = join(root, "afile.txt");
  writeFileSync(file, "x");
  const result = runFlisk(["connect", "claude", "--project", file, "--json"], {
    cwd: createTempDir("connect-from"),
  });
  expect(result.status, result.stdout + result.stderr).not.toBe(0);
  const envelope = parseEnvelope(result.stdout);
  expect(envelope.data).toBeNull();
  expect(envelope.errors[0]?.message).toBe(
    `No Flisk project at ${file} (not an existing directory)`,
  );
  expect(existsSync(join(root, ".mcp.json"))).toBe(false);
});
