// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it, stopTiltForUp, vi } from "../../test-support/up.js";

describe("Tilt force startup", () => {
  it("stops Tilt without printing in quiet mode", async () => {
    const stop = vi.fn();
    const log = vi.fn();
    const wait = vi.fn(async (_milliseconds: number) => {});

    await stopTiltForUp({ force: true, quiet: true, port: 10350 }, { stop, log, wait });

    expect(stop).toHaveBeenCalledWith(10350);
    expect(log).not.toHaveBeenCalled();
    expect(wait).toHaveBeenCalledWith(2000);
  });

  it("prints and stops Tilt when force is set without quiet", async () => {
    const stop = vi.fn();
    const log = vi.fn();
    const wait = vi.fn(async (_milliseconds: number) => {});

    await stopTiltForUp({ force: true, quiet: false, port: 10351 }, { stop, log, wait });

    expect(stop).toHaveBeenCalledWith(10351);
    expect(log).toHaveBeenCalledWith("Force flag set - stopping Tilt on port 10351 if running...");
    expect(wait).toHaveBeenCalledWith(2000);
  });

  it("does not stop Tilt when force is unset", async () => {
    const stop = vi.fn();
    const log = vi.fn();
    const wait = vi.fn(async (_milliseconds: number) => {});

    await stopTiltForUp({ force: false, quiet: false, port: 10350 }, { stop, log, wait });

    expect(stop).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(wait).not.toHaveBeenCalled();
  });
});
