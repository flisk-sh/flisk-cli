// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  backupProjectJson,
  formatProjectConfigChanges,
  projectConfigChanges,
} from "../force-reset.js";

describe("projectConfigChanges", () => {
  it("reports the leaf paths --force resets, including arrays and scalars", () => {
    const changes = projectConfigChanges(
      {
        discovery: { paths: ["apps/*/*", "services/*/*"] },
        phases: { beta: { enabledStacks: ["billing"] } },
        project: { version: "9.9.9" },
      },
      {
        discovery: { paths: ["services/*/*"] },
        phases: { beta: { enabledStacks: [] } },
        project: { version: "1.0.0-alpha" },
      },
    );

    expect(changes.map((change) => change.path)).toEqual([
      "discovery.paths",
      "phases.beta.enabledStacks",
      "project.version",
    ]);
    expect(changes[0]?.before).toEqual(["apps/*/*", "services/*/*"]);
    expect(changes[1]?.after).toEqual([]);
  });

  it("ignores formatting and key order but notices added and removed keys", () => {
    expect(
      projectConfigChanges(
        JSON.parse('{"version":"1","project":{"name":"a","version":"1"},"overrides":{}}'),
        JSON.parse('{"overrides":{},"version":"1","project":{"version":"1","name":"a"}}'),
      ),
    ).toEqual([]);

    const changes = projectConfigChanges({ a: 1, b: 2 }, { a: 1, c: 3 });
    expect(changes).toEqual([
      { path: "b", before: 2, after: undefined },
      { path: "c", before: undefined, after: 3 },
    ]);
  });
});

describe("formatProjectConfigChanges", () => {
  it("prints readable before/after values and caps the list", () => {
    const changes = Array.from({ length: 10 }, (_, index) => ({
      path: `key${index}`,
      before: 1,
      after: 2,
    }));

    const lines = formatProjectConfigChanges(changes, 2);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("key0: 1 -> 2");
    expect(lines[2]).toContain("8 more keys");
    expect(formatProjectConfigChanges(changes.slice(0, 1))[0]).toBe("key0: 1 -> 2");
  });

  it("renders array values as a list", () => {
    expect(
      formatProjectConfigChanges([
        { path: "discovery.paths", before: ["apps/*/*"], after: ["services/*/*"] },
      ]),
    ).toEqual(["discovery.paths: [apps/*/*] -> [services/*/*]"]);
  });
});

describe("backupProjectJson", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "project-backup-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("writes the raw previous file next to project.json", () => {
    const configPath = join(root, "project.json");
    const original = '{\n  "project": { "name": "before" }\n}\n';
    writeFileSync(configPath, original);

    const backup = backupProjectJson(configPath);

    expect(backup).toBe(`${configPath}.bak`);
    expect(readFileSync(backup, "utf-8")).toBe(original);
  });
});
