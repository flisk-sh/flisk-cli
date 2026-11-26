// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it, vi, waitForTiltUnlessStartupFailed } from "../../test-support/up.js";

describe("flisk up after a readiness failure", () => {
  it("exits 1 without waiting for Tilt to exit", async () => {
    // Tilt keeps running after a readiness failure, so its exit never comes. The command must still exit.
    const tiltRun = new Promise<never>(() => {});
    const startupFailure = Promise.resolve();
    const exit = vi.fn((code: number) => {
      throw new Error(`exit ${code}`);
    }) as unknown as (code: number) => never;

    await expect(waitForTiltUnlessStartupFailed(tiltRun, startupFailure, exit)).rejects.toThrow(
      "exit 1",
    );
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("returns Tilt's result and does not exit when startup succeeds", async () => {
    const exit = vi.fn() as unknown as (code: number) => never;
    const startupFailure = new Promise<void>(() => {});

    await expect(
      waitForTiltUnlessStartupFailed(Promise.resolve({ exitCode: 0 }), startupFailure, exit),
    ).resolves.toEqual({ exitCode: 0 });
    expect(exit).not.toHaveBeenCalled();
  });
});
