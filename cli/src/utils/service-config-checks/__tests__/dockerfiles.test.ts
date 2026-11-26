// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkCustomDockerfiles } from "../dockerfiles.js";
import { tempProject } from "./helpers.js";

const project = tempProject("flisk-dockerfile-checks-");
const { service } = project;

describe("checkCustomDockerfiles", () => {
  it("passes when no service declares a dockerfile", () => {
    service("api");
    expect(checkCustomDockerfiles(project.root).didPass).toBe(true);
  });

  it("passes when the declared dockerfile exists next to service.json", () => {
    service("api", { dockerfile: "Dockerfile.custom" });
    writeFileSync(
      join(project.root, "services", "app", "api", "Dockerfile.custom"),
      "FROM scratch\n",
    );
    expect(checkCustomDockerfiles(project.root).didPass).toBe(true);
  });

  it("fails when the declared dockerfile is missing, naming the service file", () => {
    service("api", { dockerfile: "Dockerfile.custom" });
    const result = checkCustomDockerfiles(project.root);
    expect(result.didPass).toBe(false);
    expect(result.message).toContain(join("services", "app", "api", "service.json"));
    expect(result.message).toContain("dockerfile");
    expect(result.fix).toContain("generated Dockerfile");
  });

  it("resolves the dockerfile against buildContext", () => {
    service("api", { dockerfile: "Dockerfile", buildContext: "ctx" });
    const dir = join(project.root, "services", "app", "api", "ctx");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "Dockerfile"), "FROM scratch\n");
    expect(checkCustomDockerfiles(project.root).didPass).toBe(true);
  });

  it("treats a directory at the dockerfile path as missing, like the loader's test -f", () => {
    service("api", { dockerfile: "Dockerfile.dir" });
    mkdirSync(join(project.root, "services", "app", "api", "Dockerfile.dir"), { recursive: true });
    expect(checkCustomDockerfiles(project.root).didPass).toBe(false);
  });

  it("still requires the file when an image is also set, unlike checkDockerfilePorts", () => {
    service("api", { dockerfile: "Dockerfile.custom", image: "example/x:1" });
    expect(checkCustomDockerfiles(project.root).didPass).toBe(false);
  });

  it("ignores an empty dockerfile value", () => {
    service("api", { dockerfile: "" });
    expect(checkCustomDockerfiles(project.root).didPass).toBe(true);
  });
});
