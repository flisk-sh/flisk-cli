// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTempProject } from "../../test-support/index.js";
import * as boardModule from "../distribution/board.js";
import * as channelsModule from "../distribution/channels.js";
import * as fileModule from "../distribution/file.js";
import * as kitModule from "../distribution/kit.js";
import * as statusModule from "../distribution/status.js";
import * as toolsModule from "../distribution/tools.js";
import * as barrel from "../distribution.js";
import { discoverResourcesFromRoot } from "../services.js";

describe("distribution contract", () => {
  it("round-trips createInitialDistribution through file, grid, board and kit", () => {
    const root = createTempProject({
      resources: {
        helper: { appType: "mcp", port: 4100, healthCheckPath: "/healthz" },
        api: { appType: "backend", port: 3100, dependsOn: ["helper"] },
      },
    });
    fs.mkdirSync(path.join(root, "services", "helper", "src"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "services", "helper", "src", "server.ts"),
      'server.registerTool("plan_app", {});\nserver.registerPrompt("build_my_app", {});\n',
    );
    const resources = discoverResourcesFromRoot(root);
    expect(resources.map((r) => r.name).sort()).toEqual(["api", "helper"]);

    const initial = barrel.createInitialDistribution(resources);
    expect(Object.keys(initial.apps)).toEqual(["api", "helper"]);
    expect(initial.apps.api?.channels?.["mcp-registry"]?.status).toBe("n/a");
    expect(initial.apps.helper?.channels?.["mcp-registry"]?.status).toBe("todo");

    fs.writeFileSync(
      path.join(root, barrel.DISTRIBUTION_FILE),
      `${JSON.stringify(initial, null, 2)}\n`,
    );
    const read = barrel.readDistributionFile(root);
    if (!read) throw new Error("expected distribution.json to load");
    expect(read).toEqual(initial);
    expect(read.apps).toEqual(initial.apps);

    const merged = barrel.mergeDistribution(read, resources);
    expect(merged).toEqual(initial);
    expect(barrel.mergeDistribution(merged, resources)).toEqual(merged);

    const grid = barrel.buildStatusGrid(read);
    expect(grid.apps).toEqual(["api", "helper"]);
    expect(grid.channels).toHaveLength(channelsModule.CHANNELS.length);
    const registry = grid.channels.find((c) => c.id === "mcp-registry");
    expect(registry?.cells.api?.status).toBe("n/a");
    expect(registry?.cells.helper?.status).toBe("todo");
    const npm = grid.channels.find((c) => c.id === "npm");
    expect(npm?.cells.api?.status).toBe("todo");
    expect(npm?.cells.helper?.status).toBe("todo");
    expect(barrel.formatStatusGrid(grid)).toContain("| Official MCP Registry | — | ⬜ |");

    const board = barrel.buildBoard(resources, read);
    expect(board.rows).toHaveLength(6);
    expect(board.rows[0]?.cells.What.isMissing).toBe(false);
    expect(board.rows[0]?.cells.Where.text).toBe("Missing: no channel is planned for any app");
    expect(board.rows[4]?.cells.Where.text).toBe("Missing: no channel is live or in review");
    expect(board.rows[4]?.cells.What.text).toContain("helper/plan_app");
    expect(board.rows[5]?.cells.What.text).toBe("Missing: no live listing yet");
    expect(board.rows[1]?.cells.What.isMissing).toBe(true);

    const helper = resources.find((r) => r.name === "helper");
    if (!helper) throw new Error("no helper resource");
    const kit = barrel.buildKit(helper, read);
    expect(kit.files.map((f) => f.path)).toEqual([
      ".claude-plugin/plugin.json",
      ".mcp.json",
      "server.json",
      "listing.md",
    ]);
    const listing = kit.files.find((f) => f.path === "listing.md")?.content ?? "";
    expect(listing).toContain("### ⬜ Official MCP Registry");
    expect(listing).toContain("`plan_app`");
    expect(listing).not.toContain("### — Official MCP Registry");
    const serverJson = JSON.parse(kit.files.find((f) => f.path === "server.json")?.content ?? "{}");
    expect(serverJson.name).toBe("io.github.REPLACE-ME/helper");
    expect(kit.warnings.some((w) => w.includes('add "githubOwner"'))).toBe(true);
    expect(kit.warnings.some((w) => w.includes('add "owner"'))).toBe(true);
  });

  it("re-exports identical bindings for every runtime export", () => {
    const pairs: [string, unknown, unknown][] = [
      ["CHANNELS", barrel.CHANNELS, channelsModule.CHANNELS],
      ["CHANNEL_STATUSES", barrel.CHANNEL_STATUSES, channelsModule.CHANNEL_STATUSES],
      ["DISTRIBUTION_FILE", barrel.DISTRIBUTION_FILE, channelsModule.DISTRIBUTION_FILE],
      [
        "OPENAI_LONG_DESCRIPTION_LIMIT",
        barrel.OPENAI_LONG_DESCRIPTION_LIMIT,
        channelsModule.OPENAI_LONG_DESCRIPTION_LIMIT,
      ],
      ["OPENAI_NAME_LIMIT", barrel.OPENAI_NAME_LIMIT, channelsModule.OPENAI_NAME_LIMIT],
      [
        "OPENAI_SHORT_DESCRIPTION_LIMIT",
        barrel.OPENAI_SHORT_DESCRIPTION_LIMIT,
        channelsModule.OPENAI_SHORT_DESCRIPTION_LIMIT,
      ],
      [
        "PRODUCT_HUNT_DESCRIPTION_LIMIT",
        barrel.PRODUCT_HUNT_DESCRIPTION_LIMIT,
        channelsModule.PRODUCT_HUNT_DESCRIPTION_LIMIT,
      ],
      [
        "REGISTRY_DESCRIPTION_LIMIT",
        barrel.REGISTRY_DESCRIPTION_LIMIT,
        channelsModule.REGISTRY_DESCRIPTION_LIMIT,
      ],
      ["STATUS_ICONS", barrel.STATUS_ICONS, channelsModule.STATUS_ICONS],
      ["TAGLINE_LIMIT", barrel.TAGLINE_LIMIT, channelsModule.TAGLINE_LIMIT],
      [
        "createInitialDistribution",
        barrel.createInitialDistribution,
        fileModule.createInitialDistribution,
      ],
      ["distributionWarnings", barrel.distributionWarnings, fileModule.distributionWarnings],
      ["mergeDistribution", barrel.mergeDistribution, fileModule.mergeDistribution],
      ["readDistributionFile", barrel.readDistributionFile, fileModule.readDistributionFile],
      ["isMcpResource", barrel.isMcpResource, toolsModule.isMcpResource],
      ["readToolsAndPrompts", barrel.readToolsAndPrompts, toolsModule.readToolsAndPrompts],
      ["BOARD_COLUMNS", barrel.BOARD_COLUMNS, boardModule.BOARD_COLUMNS],
      ["BOARD_ROWS", barrel.BOARD_ROWS, boardModule.BOARD_ROWS],
      ["buildBoard", barrel.buildBoard, boardModule.buildBoard],
      ["formatBoard", barrel.formatBoard, boardModule.formatBoard],
      ["buildStatusGrid", barrel.buildStatusGrid, statusModule.buildStatusGrid],
      ["formatStatusGrid", barrel.formatStatusGrid, statusModule.formatStatusGrid],
      ["buildKit", barrel.buildKit, kitModule.buildKit],
      ["slugify", barrel.slugify, kitModule.slugify],
      ["URL_PLACEHOLDER", barrel.URL_PLACEHOLDER, kitModule.URL_PLACEHOLDER],
      ["writeKit", barrel.writeKit, kitModule.writeKit],
    ];
    for (const [name, viaBarrel, direct] of pairs) {
      expect(viaBarrel, name).toBe(direct);
    }
    expect(Object.keys(barrel).sort()).toEqual(pairs.map(([name]) => name).sort());
  });
});
