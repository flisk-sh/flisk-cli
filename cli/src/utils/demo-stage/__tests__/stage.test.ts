// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";

import type { DemoState } from "../frame.js";
import { createDemoStage, type RepaintScheduler } from "../stage.js";

function pendingState(patch: Partial<DemoState> = {}): DemoState {
  return {
    title: "Flisk demo",
    subtitle: "restaurant ops",
    phases: [
      { id: "fetch", label: "Fetching the demo", status: "done", elapsedMs: 900 },
      { id: "start", label: "Starting services", status: "active" },
    ],
    servicesReady: 0,
    servicesTotal: 2,
    servicesBuilding: 0,
    elapsedMs: 0,
    ...patch,
  };
}

type CapturedStream = NodeJS.WriteStream & { output(): string; writes: number };

function captureStream(isTTY: boolean, columns = 80): CapturedStream {
  const chunks: string[] = [];
  const stream = {
    isTTY,
    columns,
    writes: 0,
    write(chunk: string) {
      stream.writes += 1;
      chunks.push(String(chunk));
      return true;
    },
    output() {
      return chunks.join("");
    },
  };
  return stream as unknown as CapturedStream;
}

/** A repaint scheduler the test drives by hand: `fire()` runs one cadence tick. */
function manualRepaint() {
  let tick: (() => void) | undefined;
  let cancelled = false;
  const schedule: RepaintScheduler = (onTick) => {
    tick = onTick;
    return () => {
      cancelled = true;
      tick = undefined;
    };
  };
  return { schedule, fire: () => tick?.(), wasCancelled: () => cancelled };
}

describe("createDemoStage with an injected clock and repaint schedule", () => {
  it("repaints on the cadence tick and skips a tick whose frame did not change", () => {
    let clock = 0;
    const repaint = manualRepaint();
    const stream = captureStream(true);
    const stage = createDemoStage(pendingState(), stream, () => clock, repaint.schedule);

    const initialWrites = stream.writes;
    expect(initialWrites).toBeGreaterThan(0);

    // A tick with no state change and no clock advance produces an identical frame: nothing to paint.
    repaint.fire();
    expect(stream.writes).toBe(initialWrites);

    // The clock advancing changes the elapsed cell, so the next tick repaints.
    clock = 5_000;
    repaint.fire();
    expect(stream.writes).toBeGreaterThan(initialWrites);
    expect(stream.output()).toContain("5.0s");
    stage.stop();
  });

  it("starts the repaint schedule and cancels it on stop", () => {
    const repaint = manualRepaint();
    const stream = captureStream(true);
    const stage = createDemoStage(pendingState(), stream, () => 0, repaint.schedule);
    expect(repaint.wasCancelled()).toBe(false);
    stage.stop();
    expect(repaint.wasCancelled()).toBe(true);
  });

  it("does not schedule repaints on a terminal without a TTY", () => {
    const repaint = manualRepaint();
    let scheduled = false;
    const stream = captureStream(false);
    const stage = createDemoStage(
      pendingState(),
      stream,
      () => 0,
      (tick) => {
        scheduled = true;
        return repaint.schedule(tick);
      },
    );
    stage.update({ servicesReady: 1 });
    stage.stop();
    expect(scheduled).toBe(false);
    expect(stream.output()).toContain("1 of 2 services ready");
    expect(stream.writes).toBeGreaterThan(0);
  });

  it("orders steps and freezes the clock on failure", () => {
    let clock = 1_000;
    const stream = captureStream(true);
    const stage = createDemoStage(pendingState(), stream, () => clock, manualRepaint().schedule);

    clock = 30_000;
    stage.fail("The stack did not come up.", "Run flisk up.");

    // The failure fixes elapsedMs on the state, so a later tick cannot move it.
    clock = 99_000;
    stage.update({ detail: "cleaning up" });
    stage.stop();

    const output = stream.output();
    expect(output).toContain("✖  Starting services");
    expect(output).toContain("The stack did not come up.");
    expect(output).toContain("29s");
    expect(output).not.toContain("1m 38s");
  });

  it("freezes the elapsed time the moment finish runs", () => {
    let clock = 0;
    const stream = captureStream(true);
    const stage = createDemoStage(pendingState(), stream, () => clock, manualRepaint().schedule);

    clock = 90_000;
    stage.finish({
      urls: ["localhost:3000"],
      summary: "2 services",
      hint: "Edit a file.",
      version: "1.4.72",
    });
    stage.stop();

    expect(stream.output()).toContain("1m 30s");
  });

  it("keeps the previous phases when an update patch omits them", () => {
    const stream = captureStream(true);
    const stage = createDemoStage(pendingState(), stream, () => 0, manualRepaint().schedule);
    stage.update({ detail: "312 files" });
    stage.stop();

    const output = stream.output();
    expect(output).toContain("◐  Starting services");
    expect(output).toContain("312 files");
  });
});
