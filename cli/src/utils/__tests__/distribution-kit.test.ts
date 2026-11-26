// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTempDir, createTempProject, makeResource } from "../../test-support/index.js";
import type { DistributionFile } from "../distribution/channels.js";
import { buildKit, slugify, URL_PLACEHOLDER, writeKit } from "../distribution/kit.js";
import { FliskError } from "../errors.js";
import { discoverResourcesFromRoot } from "../services.js";

describe("slugify", () => {
  it("lowercases and collapses non-alphanumeric runs into single dashes", () => {
    expect(slugify("My_Helper.App")).toBe("my-helper-app");
    expect(slugify("a__b--c")).toBe("a-b-c");
    expect(slugify("UPPER lower 123")).toBe("upper-lower-123");
  });

  it("trims leading and trailing dashes", () => {
    expect(slugify("  padded  ")).toBe("padded");
    expect(slugify("-already-dashed-")).toBe("already-dashed");
    expect(slugify("!!!")).toBe("");
    expect(slugify("")).toBe("");
  });

  it("drops characters outside a-z0-9", () => {
    expect(slugify("Café au lait")).toBe("caf-au-lait");
    expect(slugify("App.v2_beta")).toBe("app-v2-beta");
  });
});

describe("buildKit warnings", () => {
  it("warns when tagline or description is missing", () => {
    const kit = buildKit(makeResource("helper", "mcp"), { schemaVersion: 1, apps: {} });
    expect(kit.warnings).toContain('No tagline: add "tagline" for helper in distribution.json.');
    expect(kit.warnings).toContain(
      'No description: add "description" for helper in distribution.json.',
    );
  });

  it("warns when the tagline exceeds the OpenAI and marketplace limits", () => {
    const medium = {
      schemaVersion: 1 as const,
      apps: { helper: { tagline: "t".repeat(40), description: "d" } },
    };
    const mediumKit = buildKit(makeResource("helper", "mcp"), medium);
    expect(
      mediumKit.warnings.some((w) => w.includes("OpenAI allows 30 for shortDescription")),
    ).toBe(true);
    expect(mediumKit.warnings.some((w) => w.includes("Product Hunt and Toolradar"))).toBe(false);

    const long = {
      schemaVersion: 1 as const,
      apps: { helper: { tagline: "t".repeat(61), description: "d" } },
    };
    const longKit = buildKit(makeResource("helper", "mcp"), long);
    expect(longKit.warnings).toContain(
      "Tagline is 61 characters; Product Hunt and Toolradar allow 60.",
    );
    expect(longKit.warnings).toContain(
      "Tagline is 61 characters; OpenAI allows 30 for shortDescription.",
    );
  });

  it("warns about a non-https URL for an MCP resource only", () => {
    const insecure: DistributionFile = {
      schemaVersion: 1,
      apps: { helper: { url: "http://helper.example.com/mcp" } },
    };
    const mcpKit = buildKit(makeResource("helper", "mcp"), insecure);
    expect(mcpKit.warnings.some((w) => w.includes("is not https"))).toBe(true);

    const webKit = buildKit(makeResource("api", "backend"), {
      schemaVersion: 1,
      apps: { api: { url: "http://api.example.com" } },
    });
    expect(webKit.warnings.some((w) => w.includes("is not https"))).toBe(false);
    expect(webKit.warnings.some((w) => w.includes("No public URL"))).toBe(false);
  });

  it("warns about missing public URL only for MCP resources", () => {
    const mcpKit = buildKit(makeResource("helper", "mcp"), { schemaVersion: 1, apps: {} });
    expect(mcpKit.warnings.some((w) => w.includes("No public URL"))).toBe(true);
    const webKit = buildKit(makeResource("api", "backend"), { schemaVersion: 1, apps: {} });
    expect(webKit.warnings.some((w) => w.includes("No public URL"))).toBe(false);
    expect(webKit.warnings.some((w) => w.includes(URL_PLACEHOLDER))).toBe(false);
  });

  it("warns about missing githubOwner and owner for MCP listings", () => {
    const dist: DistributionFile = {
      schemaVersion: 1,
      apps: {
        helper: {
          tagline: "t",
          description: "d",
          url: "https://helper.example.com/mcp",
        },
      },
    };
    const mcpKit = buildKit(makeResource("helper", "mcp"), dist);
    expect(mcpKit.warnings).toEqual([
      'No GitHub owner: add "githubOwner" to distribution.json; the MCP Registry name is io.github.<githubOwner>/helper.',
      'No owner: add "owner" to distribution.json for the plugin author.',
    ]);

    const webKit = buildKit(makeResource("helper", "backend"), dist);
    expect(webKit.warnings).toEqual([
      'No owner: add "owner" to distribution.json for the plugin author.',
    ]);
  });

  it("warns on description, registry description and name length limits for MCP", () => {
    const dist: DistributionFile = {
      schemaVersion: 1,
      apps: {
        helper: {
          name: "N".repeat(31),
          tagline: "t".repeat(20),
          description: "d".repeat(150),
          url: "https://helper.example.com/mcp",
        },
      },
    };
    const warnings = buildKit(makeResource("helper", "mcp"), dist).warnings.join("\n");
    expect(warnings).toContain("server.json description is 150 characters");
    expect(warnings).toContain("MCP Registry allows 100");
    expect(warnings).toContain("Name is 31 characters; OpenAI allows 30 for displayName.");
  });
});

describe("buildKit files", () => {
  it("writes plugin.json, .mcp.json, server.json and listing.md for an MCP resource", () => {
    const root = createTempProject({
      resources: { helper: { appType: "mcp", port: 4100, healthCheckPath: "/healthz" } },
    });
    fs.mkdirSync(path.join(root, "services", "helper", "src"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "services", "helper", "src", "server.ts"),
      'server.registerTool("plan_app", {});\nserver.registerPrompt("build_my_app", {});\n',
    );
    const helper = discoverResourcesFromRoot(root).find((r) => r.name === "helper");
    if (!helper) throw new Error("no helper");
    const dist: DistributionFile = {
      schemaVersion: 1,
      owner: "Flisk",
      githubOwner: "flisk-sh",
      apps: {
        helper: {
          name: "Helper",
          tagline: "Plan an app",
          description: "Plans an app.",
          url: "https://helper.example.com/mcp",
          version: "1.0.0",
        },
      },
    };
    const kit = buildKit(helper, dist);
    expect(kit.resource).toBe("helper");
    expect(kit.files.map((f) => f.path)).toEqual([
      ".claude-plugin/plugin.json",
      ".mcp.json",
      "server.json",
      "listing.md",
    ]);
    expect(kit.warnings).toEqual([]);

    const plugin = JSON.parse(kit.files[0]?.content ?? "{}");
    expect(plugin).toMatchObject({
      name: "helper",
      displayName: "Helper",
      version: "1.0.0",
      description: "Plans an app.",
      author: { name: "Flisk" },
      license: "MIT",
    });
    expect(plugin.keywords).toEqual(["helper", "mcp"]);

    const mcpJson = JSON.parse(kit.files[1]?.content ?? "{}");
    expect(mcpJson.mcpServers.helper).toEqual({
      type: "http",
      url: "https://helper.example.com/mcp",
    });

    const server = JSON.parse(kit.files[2]?.content ?? "{}");
    expect(server.name).toBe("io.github.flisk-sh/helper");
    expect(server.description).toBe("Plans an app.");
    expect(server.remotes).toEqual([
      { type: "streamable-http", url: "https://helper.example.com/mcp" },
    ]);

    const listing = kit.files[3]?.content ?? "";
    expect(listing).toContain("# Helper");
    expect(listing).toContain("`plan_app`");
    expect(listing).toContain("`build_my_app`");
    expect(listing).toContain("- URL: https://helper.example.com/mcp");
    expect(listing).toContain("- Health check: /healthz");
    expect(listing).toContain("### ⬜ Official MCP Registry");
  });

  it("omits MCP files for a non-MCP resource and marks MCP-only channels n/a", () => {
    const kit = buildKit(makeResource("api", "backend"), null);
    expect(kit.files.map((f) => f.path)).toEqual([".claude-plugin/plugin.json", "listing.md"]);
    const plugin = JSON.parse(kit.files[0]?.content ?? "{}");
    expect(plugin.keywords).toEqual(["api"]);

    const listing = kit.files[1]?.content ?? "";
    expect(listing).toContain("### — Claude directory (connector)");
    expect(listing).toContain("- Not for this resource: it lists MCP servers only.");
    expect(listing).toContain("### ⬜ npm");
    expect(listing).toContain("How to submit: npm publish from the package folder.");
    expect(listing).toContain("- Not an MCP resource.");
    expect(listing).not.toContain("## Server");
  });
});

describe("writeKit", () => {
  it("writes files under outDir and returns the written paths", () => {
    const kit = buildKit(makeResource("api", "backend"), null);
    const outDir = createTempDir();
    const written = writeKit(kit, outDir, false);
    expect(written).toEqual(kit.files.map((f) => path.join(outDir, f.path)));
    for (const file of kit.files) {
      expect(fs.readFileSync(path.join(outDir, file.path), "utf-8")).toBe(file.content);
    }
    expect(fs.existsSync(path.join(outDir, ".claude-plugin", "plugin.json"))).toBe(true);
  });

  it("throws FliskError when kit files exist and isForced is false", () => {
    const kit = buildKit(makeResource("api", "backend"), null);
    const outDir = createTempDir();
    writeKit(kit, outDir, false);
    fs.writeFileSync(path.join(outDir, "listing.md"), "edited by hand");
    expect(() => writeKit(kit, outDir, false)).toThrow(FliskError);
    expect(() => writeKit(kit, outDir, false)).toThrow(/already exists/);
    expect(fs.readFileSync(path.join(outDir, "listing.md"), "utf-8")).toBe("edited by hand");
  });

  it("throws when only some kit files exist", () => {
    const kit = buildKit(makeResource("api", "backend"), null);
    const outDir = createTempDir();
    fs.mkdirSync(path.join(outDir, ".claude-plugin"), { recursive: true });
    fs.writeFileSync(path.join(outDir, "listing.md"), "hand written");
    expect(() => writeKit(kit, outDir, false)).toThrow(/listing\.md/);
    expect(fs.readFileSync(path.join(outDir, "listing.md"), "utf-8")).toBe("hand written");
  });

  it("overwrites existing files when isForced is true", () => {
    const kit = buildKit(makeResource("api", "backend"), null);
    const outDir = createTempDir();
    writeKit(kit, outDir, false);
    fs.writeFileSync(path.join(outDir, "listing.md"), "edited by hand");
    const written = writeKit(kit, outDir, true);
    expect(written).toHaveLength(kit.files.length);
    expect(fs.readFileSync(path.join(outDir, "listing.md"), "utf-8")).toBe(kit.files[1]?.content);
  });
});
