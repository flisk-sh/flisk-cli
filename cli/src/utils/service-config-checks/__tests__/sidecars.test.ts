// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { checkSidecars } from "../sidecars.js";
import { tempProject } from "./helpers.js";

const project = tempProject("flisk-sidecar-checks-");
const { service } = project;

const byo = { appType: "bring-your-own", image: "example/x:1" };

describe("checkSidecars", () => {
  it("passes with no sidecars, and for a sidecar of a resource in its stack", () => {
    service("api");
    expect(checkSidecars(project.root).didPass).toBe(true);
    service("host", { ...byo });
    service("sidecar", { port: 4001, ...byo, sidecarOf: "host" });
    expect(checkSidecars(project.root).didPass).toBe(true);
  });

  it("ignores an empty sidecarOf", () => {
    service("api", { sidecarOf: "" });
    expect(checkSidecars(project.root).didPass).toBe(true);
  });

  it("passes for a service that is its own sidecar host", () => {
    service("api", { ...byo, sidecarOf: "api" });
    expect(checkSidecars(project.root).didPass).toBe(true);
  });

  it("counts several bad sidecarOf entries together", () => {
    service("a", { ...byo, sidecarOf: "ghost1" });
    service("b", { port: 4001, ...byo, sidecarOf: "ghost2" });
    const result = checkSidecars(project.root);
    expect(result.didPass).toBe(false);
    expect(result.message).toContain("2 invalid sidecarOf");
  });
});
