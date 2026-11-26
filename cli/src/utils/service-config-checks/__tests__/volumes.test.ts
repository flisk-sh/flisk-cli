// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkVolumes } from "../volumes.js";
import { tempProject } from "./helpers.js";

const project = tempProject("flisk-volume-checks-");
const { service } = project;

const byo = { appType: "bring-your-own", image: "example/x:1" };

describe("checkVolumes", () => {
  it("fails for a bind mount that climbs out of the project", () => {
    service("api", { ...byo, volumes: [{ source: "../../../../etc", target: "/host-etc" }] });
    const result = checkVolumes(project.root);
    expect(result.didPass).toBe(false);
    expect(result.message).toContain("must stay inside the project");
    expect(result.message).toContain(join("services", "app", "api", "service.json"));
    expect(result.fix).toContain("named volume");
  });

  it("reports an envFile that escapes the project the same way", () => {
    service("api", { ...byo, envFile: ["../../../../etc/flisk-env"] });
    const result = checkVolumes(project.root);
    expect(result.didPass).toBe(false);
    expect(result.message).toContain("must stay inside the project");
  });

  it("passes when a service has neither volumes nor envFile", () => {
    service("api");
    expect(checkVolumes(project.root).didPass).toBe(true);
  });

  it("passes for an envFile that stays inside the project", () => {
    service("api", { ...byo, envFile: ["../../app.env"] });
    expect(checkVolumes(project.root).didPass).toBe(true);
  });
});
