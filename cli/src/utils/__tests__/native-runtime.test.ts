// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { NativeSupervisor, planNativeRun } from "../native-runtime.js";

describe("native runtime module contract", () => {
  it("publishes the planner and supervisor", () => {
    expect(typeof planNativeRun).toBe("function");
    expect(typeof NativeSupervisor).toBe("function");
  });
});
