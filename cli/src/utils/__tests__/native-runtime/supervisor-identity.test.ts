// biome-ignore-all lint/suspicious/noTemplateCurlyInString: literal shell and migrator references are test fixtures
// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { native } from "../../test-support/native-runtime.js";

describe("native run supervisor identity", () => {
  native.nativeTestContext();

  it("accepts the recorded process and rejects a reused pid", async () => {
    const startTime = await native.processStartTime(process.pid);
    expect(startTime).toBeDefined();
    const state = {
      pid: process.pid,
      pidStartTime: startTime,
      startedAt: new Date().toISOString(),
      services: {},
    };
    expect(await native.isNativeRunSupervisorAlive(state)).toBe(true);
    expect(await native.isNativeRunSupervisorAlive({ ...state, pidStartTime: "reused-pid" })).toBe(
      false,
    );
  });
});
