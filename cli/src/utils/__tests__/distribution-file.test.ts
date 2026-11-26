// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTempProject, makeResource } from "../../test-support/index.js";
import { CHANNELS, DISTRIBUTION_FILE, type DistributionFile } from "../distribution/channels.js";
import {
  createInitialDistribution,
  distributionWarnings,
  mergeDistribution,
  readDistributionFile,
} from "../distribution/file.js";
import { FliskError } from "../errors.js";

function projectWithDistribution(content: string): string {
  return createTempProject({ files: { [DISTRIBUTION_FILE]: content } });
}

function writeDistribution(root: string, content: string): void {
  fs.writeFileSync(path.join(root, DISTRIBUTION_FILE), content);
}

describe("readDistributionFile", () => {
  it("returns null when the project has no distribution.json", () => {
    expect(readDistributionFile(createTempProject({}))).toBeNull();
  });

  it("parses a valid file and coerces schemaVersion to 1", () => {
    const root = projectWithDistribution(
      JSON.stringify({
        schemaVersion: 9,
        owner: "Flisk",
        apps: {
          api: { tagline: "T", channels: { npm: { status: "live", url: "https://x" } } },
        },
      }),
    );
    const dist = readDistributionFile(root);
    expect(dist?.schemaVersion).toBe(1);
    expect(dist?.owner).toBe("Flisk");
    expect(dist?.apps.api?.channels?.npm).toEqual({ status: "live", url: "https://x" });
  });

  it("defaults apps to an empty object when the file omits it", () => {
    expect(readDistributionFile(projectWithDistribution('{"owner":"Flisk"}'))?.apps).toEqual({});
  });

  it("treats a null apps member as an empty object", () => {
    expect(readDistributionFile(projectWithDistribution('{"apps":null}'))?.apps).toEqual({});
  });

  it("throws FliskError when the file is not valid JSON", () => {
    const root = createTempProject({});
    writeDistribution(root, "{ not json");
    expect(() => readDistributionFile(root)).toThrow(FliskError);
    expect(() => readDistributionFile(root)).toThrow(/not valid JSON/);
  });

  it("throws FliskError when the root is not a JSON object", () => {
    const root = createTempProject({});
    for (const content of ["[]", "null", '"text"', "42"]) {
      writeDistribution(root, content);
      expect(() => readDistributionFile(root)).toThrow(/must hold a JSON object/);
    }
  });

  it("throws FliskError when apps is not an object", () => {
    const root = createTempProject({});
    for (const apps of ['"x"', "[]", "42"]) {
      writeDistribution(root, JSON.stringify({ apps: JSON.parse(apps) }));
      expect(() => readDistributionFile(root)).toThrow(/"apps" must be an object/);
    }
  });

  it("throws FliskError when an app is not an object", () => {
    const root = createTempProject({});
    for (const app of ['"x"', "[]", "null"]) {
      writeDistribution(root, JSON.stringify({ apps: { api: JSON.parse(app) } }));
      expect(() => readDistributionFile(root)).toThrow(/app api must be an object/);
    }
  });

  it("throws FliskError when channels is not an object", () => {
    const root = createTempProject({});
    for (const channels of ['"npm"', "[]", "42"]) {
      writeDistribution(
        root,
        JSON.stringify({ apps: { api: { channels: JSON.parse(channels) } } }),
      );
      expect(() => readDistributionFile(root)).toThrow(/"channels" must be an object/);
    }
  });

  it("throws FliskError when a channel entry has an unknown status", () => {
    const root = projectWithDistribution(
      JSON.stringify({ apps: { api: { channels: { npm: { status: "done" } } } } }),
    );
    expect(() => readDistributionFile(root)).toThrow(FliskError);
    expect(() => readDistributionFile(root)).toThrow(/api \/ npm has status "done"/);
  });

  it("throws FliskError when a channel entry has no status", () => {
    const root = projectWithDistribution(
      JSON.stringify({ apps: { api: { channels: { npm: {} } } } }),
    );
    expect(() => readDistributionFile(root)).toThrow(/api \/ npm has status undefined/);
  });
});

describe("distributionWarnings", () => {
  it("returns an empty list for null and for files with only known channels", () => {
    expect(distributionWarnings(null)).toEqual([]);
    const clean = projectWithDistribution(
      JSON.stringify({ apps: { api: { channels: { npm: { status: "todo" } } } } }),
    );
    expect(distributionWarnings(readDistributionFile(clean))).toEqual([]);
  });

  it("flags unknown channel ids sorted by app name then channel id", () => {
    const root = projectWithDistribution(
      JSON.stringify({
        apps: {
          beta: {
            channels: { "zzz-bogus": { status: "todo" }, "aaa-bogus": { status: "todo" } },
          },
          alpha: { channels: { "mmm-bogus": { status: "todo" } } },
        },
      }),
    );
    const warnings = distributionWarnings(readDistributionFile(root));
    expect(warnings).toHaveLength(3);
    expect(warnings.map((w) => w.match(/unknown channel "([^"]+)"/)?.[1])).toEqual([
      "mmm-bogus",
      "aaa-bogus",
      "zzz-bogus",
    ]);
    expect(warnings[0]).toContain('alpha has unknown channel "mmm-bogus"');
    expect(warnings[0]).toContain("Known channels:");
  });
});

describe("mergeDistribution", () => {
  it("keeps existing entries, adds missing apps and channels, and sorts app keys", () => {
    const existing: DistributionFile = {
      schemaVersion: 1,
      owner: "Flisk",
      apps: {
        zebra: {
          tagline: "keep me",
          channels: {
            npm: { status: "live", url: "https://x", date: "2026-01-01" },
            "custom-chan": { status: "draft", note: "hand added" },
          },
        },
        alpha: { channels: {} },
      },
    };
    const resources = [makeResource("mid", "backend"), makeResource("zebra", "mcp")];
    const merged = mergeDistribution(existing, resources);

    expect(Object.keys(merged.apps)).toEqual(["alpha", "mid", "zebra"]);
    expect(merged.owner).toBe("Flisk");
    expect(merged.schemaVersion).toBe(1);

    expect(merged.apps.zebra?.tagline).toBe("keep me");
    expect(merged.apps.zebra?.channels?.npm).toEqual({
      status: "live",
      url: "https://x",
      date: "2026-01-01",
    });
    expect(merged.apps.zebra?.channels?.["custom-chan"]).toEqual({
      status: "draft",
      note: "hand added",
    });
    expect(Object.keys(merged.apps.zebra?.channels ?? {})).toHaveLength(CHANNELS.length + 1);
    expect(merged.apps.zebra?.channels?.["mcp-registry"]?.status).toBe("todo");

    expect(merged.apps.mid?.name).toBe("mid");
    expect(Object.keys(merged.apps.mid?.channels ?? {})).toHaveLength(CHANNELS.length);
    expect(merged.apps.mid?.channels?.npm?.status).toBe("todo");
    expect(merged.apps.mid?.channels?.["mcp-registry"]?.status).toBe("n/a");

    expect(merged.apps.alpha?.channels).toEqual({});

    expect(Object.keys(existing.apps.zebra?.channels ?? {})).toEqual(["npm", "custom-chan"]);
  });

  it("prefers existing channel entries over fresh defaults", () => {
    const existing: DistributionFile = {
      schemaVersion: 1,
      apps: { helper: { channels: { npm: { status: "live" } } } },
    };
    const merged = mergeDistribution(existing, [makeResource("helper", "mcp")]);
    expect(merged.apps.helper?.channels?.npm?.status).toBe("live");
    expect(merged.apps.helper?.channels?.smithery?.status).toBe("todo");
    expect(Object.keys(merged.apps.helper?.channels ?? {})).toHaveLength(CHANNELS.length);
  });
});

describe("createInitialDistribution", () => {
  it("sorts apps by resource name and gives every app every channel", () => {
    const dist = createInitialDistribution([
      makeResource("zebra", "backend"),
      makeResource("alpha", "mcp"),
      makeResource("mid", "frontend"),
    ]);
    expect(dist.schemaVersion).toBe(1);
    expect(Object.keys(dist.apps)).toEqual(["alpha", "mid", "zebra"]);
    for (const [name, app] of Object.entries(dist.apps)) {
      expect(app.name).toBe(name);
      expect(app.tagline).toBe("");
      expect(app.description).toBe("");
      expect(Object.keys(app.channels ?? {})).toEqual(CHANNELS.map((c) => c.id));
      for (const entry of Object.values(app.channels ?? {})) {
        expect(Object.keys(entry)).toEqual(["status"]);
      }
    }
  });

  it("marks MCP-only channels n/a for non-MCP resources and todo for MCP ones", () => {
    const dist = createInitialDistribution([
      makeResource("api", "backend"),
      makeResource("helper", "mcp"),
    ]);
    for (const channel of CHANNELS) {
      const expected = channel.isMcpOnly ? "n/a" : "todo";
      expect(dist.apps.api?.channels?.[channel.id]?.status).toBe(expected);
      expect(dist.apps.helper?.channels?.[channel.id]?.status).toBe("todo");
    }
  });
});
