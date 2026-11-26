// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it, vi } from "vitest";
import { runFirstRunMigration } from "../first-run.js";

const preflight = vi.hoisted(() => ({
  runColdPreflight: vi.fn(),
  formatColdPreflight: vi.fn(() => "machine checks"),
}));

vi.mock("../../utils/cold-preflight.js", () => ({
  runColdPreflight: preflight.runColdPreflight,
  formatColdPreflight: preflight.formatColdPreflight,
}));

afterEach(() => {
  vi.restoreAllMocks();
  preflight.runColdPreflight.mockReset();
});

describe("runFirstRunMigration", () => {
  it("continues boot when argv carries a command", async () => {
    expect(await runFirstRunMigration(["node", "flisk", "status"])).toBeUndefined();
    expect(preflight.runColdPreflight).not.toHaveBeenCalled();
  });

  it("continues boot when argv carries only a flag", async () => {
    expect(await runFirstRunMigration(["node", "flisk", "--help"])).toBeUndefined();
    expect(preflight.runColdPreflight).not.toHaveBeenCalled();
  });

  it("reports the machine checks and the next commands on a bare run, exit 0 when they pass", async () => {
    preflight.runColdPreflight.mockResolvedValue({ ok: true });
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });

    expect(await runFirstRunMigration(["node", "flisk"])).toBe(0);

    const output = lines.join("\n");
    expect(output).toContain("machine checks");
    expect(output).toContain("Commands: flisk doctor | flisk project --yes | flisk --help");
    expect(output).toContain("@flisk-sh/flisk@latest demo");
    expect(output).toContain("restaurant --project=my-stack");
  });

  it("exits 1 when the machine checks fail, after printing them", async () => {
    preflight.runColdPreflight.mockResolvedValue({ ok: false });
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });

    expect(await runFirstRunMigration(["node", "flisk"])).toBe(1);
    expect(lines.join("\n")).toContain("machine checks");
  });
});
