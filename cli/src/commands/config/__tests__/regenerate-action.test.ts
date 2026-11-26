// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureExit,
  createTempDir,
  createTempProject,
  parseEnvelope,
} from "../../../test-support/index.js";
import { MASTER_CONFIG_FILES } from "../../../utils/constants.js";
import { ProcessExitError } from "../../../utils/errors.js";
import { regenerateAction } from "../regenerate-action.js";
import { configProjectJson, inProject } from "./helpers.js";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Every file under the project root (relative path to content), so a dry run is proved to write nothing anywhere. */
function snapshotTree(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files[path.relative(root, full)] = fs.readFileSync(full, "utf-8");
    }
  };
  walk(root);
  return files;
}

function captureLogs(): string[] {
  const logs: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
  return logs;
}

describe("regenerateAction", () => {
  it("--dry-run prints the grouped plan and writes nothing", async () => {
    const root = createTempProject({ projectJson: configProjectJson("action-dry") });
    const logs = captureLogs();
    const before = snapshotTree(root);

    await inProject(root, () => regenerateAction({ dryRun: true }));

    const out = logs.join("\n");
    expect(out).toContain("Dry run - comparing current files with new configuration");
    expect(out).toContain("Status: NEW");
    expect(out).toContain("Run without --dry-run to apply these changes.");
    expect(fs.existsSync(path.join(root, ".flisk", ".flisk-out", "Tiltfile"))).toBe(false);
    expect(snapshotTree(root)).toEqual(before);
  });

  it("writes every master file and reports success", async () => {
    const root = createTempProject({ projectJson: configProjectJson("action-run") });
    const logs = captureLogs();

    await inProject(root, () => regenerateAction({}));

    expect(logs.join("\n")).toContain("Configuration regenerated!");
    for (const file of MASTER_CONFIG_FILES) {
      expect(fs.existsSync(path.join(root, ".flisk", ".flisk-out", file))).toBe(true);
    }
  });

  it("--json prints one envelope with each master file's change and writes files", async () => {
    const root = createTempProject({ projectJson: configProjectJson("action-json") });
    let stdout = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await inProject(root, () => regenerateAction({ json: true }));

    const envelope = parseEnvelope(stdout);
    expect(envelope.data).toMatchObject({ dryRun: false, hasChanges: true });
    expect(envelope.data.changes).toHaveLength(MASTER_CONFIG_FILES.length);
    expect(
      envelope.data.changes.every((change: { status: string }) => change.status === "new"),
    ).toBe(true);
    expect(fs.existsSync(path.join(root, ".flisk", ".flisk-out", "Tiltfile"))).toBe(true);
  });

  it("--json --dry-run reports the plan without writing files", async () => {
    const root = createTempProject({ projectJson: configProjectJson("action-json-dry") });
    let stdout = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const before = snapshotTree(root);

    await inProject(root, () => regenerateAction({ json: true, dryRun: true }));

    const envelope = parseEnvelope(stdout);
    expect(envelope.data).toMatchObject({ dryRun: true, hasChanges: true });
    expect(fs.existsSync(path.join(root, ".flisk", ".flisk-out", "Tiltfile"))).toBe(false);
    expect(snapshotTree(root)).toEqual(before);
  });

  it("outside a project exits 1 with the project-root error", async () => {
    const dir = createTempDir();
    const exit = captureExit();
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      errors.push(String(chunk));
      return true;
    });

    await expect(inProject(dir, () => regenerateAction({}))).rejects.toThrow(ProcessExitError);

    exit.expectExit(1);
    expect(errors.join("\n")).toContain("Could not find project root");
  });
});
