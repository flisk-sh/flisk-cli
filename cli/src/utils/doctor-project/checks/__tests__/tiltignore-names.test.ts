// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { checkTiltIgnoredResourceNames } from "../tiltignore-names.js";
import { useTempProject } from "./fixtures.js";

describe("checkTiltIgnoredResourceNames", () => {
  const tempProject = useTempProject();

  function newProject() {
    return tempProject({
      projectJson: { discovery: { paths: ["services/*/*"] } },
      files: { Tiltfile: "" },
    });
  }

  it("passes when no resource path component is ignored by Tilt", () => {
    const project = newProject();
    project.writeService("shop/orders-api", { appType: "worker", stack: "shop" });

    const result = checkTiltIgnoredResourceNames();

    expect(result.didPass).toBe(true);
    expect(result.message).toContain("No resource paths");
  });

  it("flags an existing resource whose folder name Tilt ignores", () => {
    const project = newProject();
    project.writeService("shop/logs", { appType: "worker", stack: "shop" });

    const result = checkTiltIgnoredResourceNames();

    expect(result.didPass).toBe(false);
    expect(result.message).toContain("services/shop/logs");
    expect(result.message).toContain("Tilt will not watch");
    expect(result.fix).toContain("Rename each resource or stack folder");
  });

  it("flags a stack folder that Tilt ignores too", () => {
    const project = newProject();
    project.writeService("logs/orders-api", { appType: "worker", stack: "logs" });

    expect(checkTiltIgnoredResourceNames().didPass).toBe(false);
  });
});
