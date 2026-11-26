// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { DOCTOR_FIXES, doctorCommand, formatDoctorSummary } from "../doctor.js";
import { REGISTERED_CONTAINER_CHECK_NAMES } from "./doctor/test-support.js";

describe("doctor module contract", () => {
  it("publishes the command and reporting helpers", () => {
    expect(typeof doctorCommand.parseAsync).toBe("function");
    expect(typeof formatDoctorSummary).toBe("function");
    expect(Object.keys(DOCTOR_FIXES).length).toBeGreaterThan(0);
  });

  it("derives registered check names from the runtime registry", () => {
    expect(REGISTERED_CONTAINER_CHECK_NAMES).toContain("Docker Compose");
    expect(REGISTERED_CONTAINER_CHECK_NAMES).toContain("checkDockerCompose");
  });
});
