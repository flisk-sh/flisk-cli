// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";

import { type DemoState, formatElapsed, frameToPlain, renderDemoFrame } from "../frame.js";

function demoState(patch: Partial<DemoState> = {}): DemoState {
  return {
    title: "Flisk demo",
    subtitle: "restaurant ops · 6 services · 4 stacks",
    phases: [
      { id: "fetch", label: "Fetching the demo", status: "done", elapsedMs: 900 },
      { id: "config", label: "Generating project config", status: "done", elapsedMs: 12_400 },
      { id: "install", label: "Installing dependencies", status: "active" },
      { id: "start", label: "Starting services", status: "pending" },
    ],
    servicesReady: 3,
    servicesTotal: 6,
    servicesBuilding: 2,
    detail: "240 config files generated",
    elapsedMs: 21_100,
    ...patch,
  };
}

describe("formatElapsed", () => {
  it.each([
    [0, "0.0s"],
    [900, "0.9s"],
    [9_999, "10.0s"],
    [10_000, "10s"],
    [59_500, "60s"],
    [60_000, "1m 0s"],
    [72_000, "1m 12s"],
    [-5, "0.0s"],
    [Number.NaN, "0.0s"],
    [Number.POSITIVE_INFINITY, "0.0s"],
  ])("formats %i ms as %s", (ms, expected) => {
    expect(formatElapsed(ms)).toBe(expected);
  });
});

describe("renderDemoFrame golden frames", () => {
  it("matches the golden progress frame at 80 columns", () => {
    expect(frameToPlain(renderDemoFrame(demoState(), 80))).toEqual([
      " Flisk demo                                                                   ",
      " restaurant ops · 6 services · 4 stacks                                       ",
      "                                                                              ",
      " ✔  Fetching the demo                                                     0.9s",
      " ✔  Generating project config                                              12s",
      " ◐  Installing dependencies                                                   ",
      " ○  Starting services                                                         ",
      "                                                                              ",
      " ──────────────────────────────────────────────────────────────────────────── ",
      " 240 config files generated                                                   ",
      " 3 of 6 services ready · 2 building                                        21s",
      "                                                                              ",
    ]);
  });

  it("matches the golden failure frame", () => {
    const state = demoState({
      phases: demoState().phases.map((phase) =>
        phase.status === "active" ? { ...phase, status: "failed" as const } : phase,
      ),
      failure: {
        message: "The stack did not come up.",
        fix: "Run `flisk up` in the project folder to see the full output.",
        logPath: "/Users/me/.flisk/logs/demo.log",
      },
    });
    expect(frameToPlain(renderDemoFrame(state, 80))).toEqual([
      " ✖  Installing dependencies                                                21s",
      "                                                                              ",
      " The stack did not come up.                                                   ",
      " Run `flisk up` in the project folder to see the full output.                 ",
      "                                                                              ",
      " ──────────────────────────────────────────────────────────────────────────── ",
      " 240 config files generated                                                   ",
      " log: /Users/me/.flisk/logs/demo.log                                          ",
      "                                                                              ",
      "                                                                              ",
      "                                                                              ",
      "                                                                              ",
    ]);
  });

  it("matches the golden finished frame with the Discord and star rows", () => {
    const state = demoState({
      done: {
        urls: ["app.flisk-demo.localhost/reservation-app", "app.flisk-demo.localhost/floor-app"],
        summary: "6 services · Postgres · Traefik",
        hint: "Edit a file — the browser updates.",
        version: "1.4.72",
        discordUrl: "discord.gg/qMu5Xn8Kaq",
        starUrl: "github.com/flisk-sh/flisk-cli",
      },
    });
    expect(frameToPlain(renderDemoFrame(state, 80))).toEqual([
      " ✔  Your stack is running                                                  21s",
      " restaurant ops · 6 services · 4 stacks                                       ",
      "                                                                              ",
      "     app.flisk-demo.localhost/reservation-app                                 ",
      "     app.flisk-demo.localhost/floor-app                                       ",
      "                                                                              ",
      " ──────────────────────────────────────────────────────────────────────────── ",
      " 6 services · Postgres · Traefik                                              ",
      " Edit a file — the browser updates.                                           ",
      " flisk 1.4.72 · MIT · no telemetry · signed release: docs/security.md         ",
      " Questions? Join us on Discord: discord.gg/qMu5Xn8Kaq                         ",
      " Like it? A star helps: github.com/flisk-sh/flisk-cli                         ",
    ]);
  });

  it("matches the golden finished frame without the interactive extras", () => {
    const state = demoState({
      done: {
        urls: ["localhost:3000"],
        summary: "2 services",
        hint: "Edit a file.",
        version: "1.4.20",
      },
    });
    expect(frameToPlain(renderDemoFrame(state, 80))).toEqual([
      " ✔  Your stack is running                                                  21s",
      " restaurant ops · 6 services · 4 stacks                                       ",
      "                                                                              ",
      "     localhost:3000                                                           ",
      "                                                                              ",
      " ──────────────────────────────────────────────────────────────────────────── ",
      " 2 services                                                                   ",
      " Edit a file.                                                                 ",
      "                                                                              ",
      " flisk 1.4.20 · MIT · no telemetry · signed release: docs/security.md         ",
      "                                                                              ",
      "                                                                              ",
    ]);
  });

  it("matches the golden progress frame in a narrow terminal", () => {
    expect(frameToPlain(renderDemoFrame(demoState(), 40))).toEqual([
      " Flisk demo                            ",
      " restaurant ops · 6 services · 4 stacks",
      "                                       ",
      " ✔  Fetching the demo              0.9s",
      " ✔  Generating project config       12s",
      " ◐  Installing dependencies            ",
      " ○  Starting services                  ",
      "                                       ",
      " ───────────────────────────────────── ",
      " 240 config files generated            ",
      " 3 of 6 services ready · 2 building 21s",
      "                                       ",
    ]);
  });
});
