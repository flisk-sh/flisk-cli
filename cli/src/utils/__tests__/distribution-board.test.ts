// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTempProject } from "../../test-support/index.js";
import { BOARD_COLUMNS, buildBoard, formatBoard } from "../distribution/board.js";
import type { DistributionFile } from "../distribution/channels.js";
import { discoverResourcesFromRoot } from "../services.js";

function project(): string {
  const root = createTempProject({
    resources: {
      helper: { appType: "mcp", port: 4100, healthCheckPath: "/healthz" },
      api: { appType: "backend", port: 3100, dependsOn: ["helper"] },
    },
  });
  fs.mkdirSync(path.join(root, "services", "helper", "src"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "services", "helper", "src", "server.ts"),
    'server.registerTool("plan_app", {});\nserver.registerTool("check_site", {});\nserver.registerPrompt("build_my_app", {});\n',
  );
  return root;
}

const dist: DistributionFile = {
  schemaVersion: 1,
  owner: "Flisk",
  githubOwner: "flisk-sh",
  audience: "Indie developers",
  launch: "2026-11-01",
  why: "Less busywork",
  promise: "Free to try",
  license: "MIT",
  release: "tag v*",
  support: "hello@example.com",
  apps: {
    helper: {
      name: "Helper",
      tagline: "Plans an app",
      description: "Plans an app in one sentence.",
      url: "https://helper.example.com/mcp",
      version: "1.2.3",
      bestFor: ["indie devs"],
      reviewerNotes: "Try the demo first",
      channels: {
        "claude-directory": {
          status: "live",
          url: "https://claude.ai/directory/helper",
          date: "2026-10-30",
        },
        toolradar: { status: "review", date: "2026-10-31" },
        glama: { status: "blocked", note: "waiting on DNS" },
        npm: { status: "todo" },
        smithery: { status: "n/a" },
      },
    },
    api: { channels: { "docker-hub": { status: "draft" } } },
  },
};

describe("buildBoard", () => {
  it("fills cells from service.json and marks distribution cells missing without a file", () => {
    const board = buildBoard(discoverResourcesFromRoot(project()), null);
    expect(board.rows).toHaveLength(6);
    for (const row of board.rows) {
      expect(Object.keys(row.cells)).toEqual([...BOARD_COLUMNS]);
    }
    expect(board.rows[0]?.cells.What).toEqual({
      text: "2 resources: api (backend), helper (mcp)",
      isMissing: false,
    });
    expect(board.rows[0]?.cells.How).toEqual({
      text: "Missing: no distribution.json; run flisk distribute status --init",
      isMissing: true,
    });
    expect(board.rows[0]?.cells.Where.isMissing).toBe(true);
    expect(board.rows[0]?.cells.Who.isMissing).toBe(true);
    expect(board.rows[2]?.cells.How.text).toBe("MCP routes: helper /mcp");
    expect(board.rows[2]?.cells.Where.text).toBe("api:3100, helper:4100");
    expect(board.rows[2]?.cells.When.text).toBe("api: after helper");
    expect(board.rows[2]?.cells.Why.text).toBe("helper: /healthz");
    expect(board.rows[4]?.cells.What.text).toBe("helper/check_site, helper/plan_app");
    expect(board.rows[4]?.cells.How.text).toBe("helper/build_my_app");
    expect(board.rows[4]?.cells.Where.isMissing).toBe(true);
    expect(board.rows[5]?.cells.What.isMissing).toBe(true);
  });

  it("fills distribution cells from the file and excludes todo and n/a channels", () => {
    const board = buildBoard(discoverResourcesFromRoot(project()), dist);
    expect(board.rows[0]?.cells.How).toEqual({ text: "Free to try", isMissing: false });
    expect(board.rows[0]?.cells.Where.text).toBe(
      "Claude directory (connector), Docker Hub, Glama, Toolradar",
    );
    expect(board.rows[0]?.cells.Who.text).toBe("Indie developers");
    expect(board.rows[0]?.cells.When.text).toBe("2026-11-01");
    expect(board.rows[0]?.cells.Why.text).toBe("Less busywork");
    expect(board.rows[1]?.cells.What.text).toBe("helper: Plans an app");
    expect(board.rows[1]?.cells.How.text).toBe("helper: Plans an app in one sentence.");
    expect(board.rows[1]?.cells.Where.text).toBe("helper: https://helper.example.com/mcp");
    expect(board.rows[1]?.cells.Who.text).toBe("Flisk");
    expect(board.rows[1]?.cells.When.text).toBe("helper: 1.2.3");
    expect(board.rows[1]?.cells.Why.text).toBe("helper: indie devs");
    expect(board.rows[2]?.cells.What.text).toBe("backend, mcp");
    expect(board.rows[2]?.cells.Who.isMissing).toBe(false);
    expect(board.rows[2]?.cells.Who.text).toContain("other services over HTTP");
    expect(board.rows[3]?.cells.Who.text).toBe("flisk-sh");
    expect(board.rows[3]?.cells.When.text).toBe("tag v*");
    expect(board.rows[3]?.cells.Why.text).toBe("MIT");
    expect(board.rows[3]?.cells.Where.text).toBe(
      'Missing: add "repository" to each app in distribution.json',
    );
    expect(board.rows[4]?.cells.Where.text).toBe("Claude directory (connector), Toolradar");
    expect(board.rows[4]?.cells.When.text).toBe("2026-10-31");
    expect(board.rows[4]?.cells.Why.text).toBe("helper/glama: waiting on DNS");
    expect(board.rows[5]?.cells.What.text).toBe("1 live listings");
    expect(board.rows[5]?.cells.How.text).toBe("1 in review");
    expect(board.rows[5]?.cells.Where.text).toBe("https://claude.ai/directory/helper");
    expect(board.rows[5]?.cells.Who.text).toBe("hello@example.com");
    expect(board.rows[5]?.cells.When.text).toBe("2026-10-30");
    expect(board.rows[5]?.cells.Why).toEqual({
      text: "Missing: no note on a live channel entry",
      isMissing: true,
    });
  });

  it("points missing cells at the field to add when the file exists but is empty", () => {
    const empty: DistributionFile = { schemaVersion: 1, apps: {} };
    const board = buildBoard(discoverResourcesFromRoot(project()), empty);
    expect(board.rows[0]?.cells.How.text).toBe('Missing: add "promise" to distribution.json');
    expect(board.rows[0]?.cells.Who.text).toBe('Missing: add "audience" to distribution.json');
    expect(board.rows[0]?.cells.Where.text).toBe("Missing: no channel is planned for any app");
    expect(board.rows[1]?.cells.What.text).toBe(
      'Missing: add "tagline" to each app in distribution.json',
    );
    expect(board.rows[3]?.cells.Who.text).toBe('Missing: add "githubOwner" to distribution.json');
    expect(board.rows[4]?.cells.When.text).toBe("Missing: no dates in the channel entries");
    expect(board.rows[5]?.cells.What.text).toBe("Missing: no live listing yet");
    expect(board.rows[5]?.cells.How.text).toBe("Missing: no listing in review");
  });

  it("marks every cell missing when there are no resources and no file", () => {
    const board = buildBoard([], null);
    for (const row of board.rows) {
      for (const cell of Object.values(row.cells)) {
        expect(cell.isMissing).toBe(true);
        expect(cell.text.startsWith("Missing: ")).toBe(true);
      }
    }
  });
});

describe("formatBoard", () => {
  it("prints a header, one perspective row per BOARD_ROWS entry and six question columns", () => {
    const board = buildBoard(discoverResourcesFromRoot(project()), dist);
    const lines = formatBoard(board).split("\n");
    expect(lines[0]).toBe(
      "Zachman board: rows are the six perspectives, columns the six questions",
    );
    expect(lines[1]).toBe("");
    let cursor = 2;
    for (const row of board.rows) {
      expect(lines[cursor]).toBe(`${row.perspective} / ${row.view}  (stage: ${row.stage})`);
      cursor += 1;
      for (const column of BOARD_COLUMNS) {
        const cell = row.cells[column];
        expect(lines[cursor]).toBe(
          `  ${column.padEnd(6)} ${cell.isMissing ? "⬜" : "✅"} ${cell.text}`,
        );
        cursor += 1;
      }
      expect(lines[cursor]).toBe("");
      cursor += 1;
    }
    expect(cursor).toBe(lines.length);
    expect(lines.at(-1)).toBe("");
  });
});
