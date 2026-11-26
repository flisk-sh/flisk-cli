// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { CHANNELS, type DistributionFile } from "../distribution/channels.js";
import { buildStatusGrid, formatStatusGrid, type StatusGrid } from "../distribution/status.js";

const dist = (apps: DistributionFile["apps"]): DistributionFile => ({
  schemaVersion: 1,
  apps,
});

describe("buildStatusGrid", () => {
  it("sorts apps and keeps catalog channel order", () => {
    const grid = buildStatusGrid(
      dist({
        zebra: { channels: {} },
        alpha: { channels: { npm: { status: "live", url: "https://x" } } },
      }),
    );
    expect(grid.apps).toEqual(["alpha", "zebra"]);
    expect(grid.channels).toHaveLength(CHANNELS.length);
    expect(grid.channels.map((c) => c.id)).toEqual(CHANNELS.map((c) => c.id));
    expect(grid.channels.map((c) => c.name)).toEqual(CHANNELS.map((c) => c.name));
  });

  it("defaults missing channel cells to todo and keeps existing entries", () => {
    const grid = buildStatusGrid(
      dist({
        alpha: { channels: { npm: { status: "live", url: "https://x", date: "2026-01-01" } } },
        beta: { channels: {} },
      }),
    );
    const npm = grid.channels.find((c) => c.id === "npm");
    expect(npm?.cells.alpha).toEqual({ status: "live", url: "https://x", date: "2026-01-01" });
    expect(npm?.cells.beta).toEqual({ status: "todo" });
    const glame = grid.channels.find((c) => c.id === "glama");
    expect(glame?.cells.alpha).toEqual({ status: "todo" });
    expect(glame?.cells.beta).toEqual({ status: "todo" });
  });

  it("appends unknown channel ids after the catalog, sorted, named by id", () => {
    const grid = buildStatusGrid(
      dist({
        alpha: {
          channels: {
            "zzz-custom": { status: "draft" },
            "aaa-custom": { status: "live" },
            npm: { status: "todo" },
          },
        },
        beta: { channels: {} },
      }),
    );
    expect(grid.channels).toHaveLength(CHANNELS.length + 2);
    expect(grid.channels[CHANNELS.length - 1]?.id).toBe("awesome-lists");
    expect(grid.channels.slice(CHANNELS.length).map((c) => [c.id, c.name])).toEqual([
      ["aaa-custom", "aaa-custom"],
      ["zzz-custom", "zzz-custom"],
    ]);
    const custom = grid.channels.find((c) => c.id === "aaa-custom");
    expect(custom?.cells.alpha).toEqual({ status: "live" });
    expect(custom?.cells.beta).toEqual({ status: "todo" });
  });

  it("gives every channel row an entry for every app", () => {
    const grid = buildStatusGrid(
      dist({
        alpha: { channels: { npm: { status: "live" } } },
        beta: { channels: { toolradar: { status: "review" } } },
      }),
    );
    for (const channel of grid.channels) {
      expect(Object.keys(channel.cells).sort()).toEqual(grid.apps);
    }
  });
});

describe("formatStatusGrid", () => {
  it("emits the legend, a header row, a separator and one row per channel", () => {
    const grid: StatusGrid = {
      apps: ["alpha"],
      channels: [
        { id: "npm", name: "npm", cells: { alpha: { status: "live" } } },
        { id: "custom-x", name: "custom-x", cells: { alpha: { status: "todo" } } },
      ],
    };
    expect(formatStatusGrid(grid)).toBe(
      [
        "✅ live · ⏳ review · 🟡 draft · ⛔ blocked · ⬜ todo · — n/a",
        "",
        "| Channel | alpha |",
        "| --- | --- |",
        "| npm | ✅ |",
        "| custom-x | ⬜ |",
      ].join("\n"),
    );
  });

  it("renders each cell with the icon for its status across every app", () => {
    const grid = buildStatusGrid(
      dist({
        alpha: { channels: { npm: { status: "live" }, toolradar: { status: "review" } } },
        beta: { channels: { npm: { status: "blocked" }, toolradar: { status: "draft" } } },
      }),
    );
    const lines = formatStatusGrid(grid).split("\n");
    expect(lines[0]).toBe("✅ live · ⏳ review · 🟡 draft · ⛔ blocked · ⬜ todo · — n/a");
    expect(lines[2]).toBe("| Channel | alpha | beta |");
    expect(lines[3]).toBe("| --- | --- | --- |");
    expect(lines.find((l) => l.startsWith("| npm |"))).toBe("| npm | ✅ | ⛔ |");
    expect(lines.find((l) => l.startsWith("| Toolradar |"))).toBe("| Toolradar | ⏳ | 🟡 |");
    expect(lines.find((l) => l.startsWith("| Glama |"))).toBe("| Glama | ⬜ | ⬜ |");
    expect(lines.find((l) => l.startsWith("| Awesome lists |"))).toBe(
      "| Awesome lists | ⬜ | ⬜ |",
    );
    expect(lines.filter((l) => l.startsWith("|"))).toHaveLength(grid.channels.length + 2);
  });
});
