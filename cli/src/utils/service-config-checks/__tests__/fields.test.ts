// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkServiceFields } from "../fields.js";
import { checkServicePorts } from "../ports.js";
import { tempProject } from "./helpers.js";

const project = tempProject("flisk-field-checks-");
const { service } = project;

describe("checkServiceFields", () => {
  it("passes for a well-formed service.json", () => {
    service("api");
    expect(checkServiceFields(project.root).didPass).toBe(true);
  });

  it("reports an invalid field with the file and the reason", () => {
    service("api", { buildContext: "/srv/api", dockerfile: "Dockerfile" });
    const result = checkServiceFields(project.root);
    expect(result.didPass).toBe(false);
    expect(result.message).toContain(join("services", "app", "api", "service.json"));
    expect(result.message).toContain("buildContext");
    expect(result.fix).toContain("schema");
  });

  it("reports an appName that is not Docker-safe, even one inherited from the directory", () => {
    service("My App", { appName: "My App" }, "app/my-app");
    const result = checkServiceFields(project.root);
    expect(result.didPass).toBe(false);
    expect(result.message).toContain("appName");
  });

  it("collects problems from every service instead of stopping at the first", () => {
    service("a", { buildContext: "/abs/a", dockerfile: "Dockerfile" });
    service("b", { port: 4001, buildContext: "/abs/b", dockerfile: "Dockerfile" });
    const result = checkServiceFields(project.root);
    expect(result.didPass).toBe(false);
    expect(result.message).toContain(join("app", "a", "service.json"));
    expect(result.message).toContain(join("app", "b", "service.json"));
  });

  it("leaves a missing schemaVersion or required field to their own checks", () => {
    service("api", { appName: undefined });
    const result = checkServiceFields(project.root);
    expect(result.didPass).toBe(true);
  });

  it("reports a wrong-typed port here, which checkServicePorts also reports by design", () => {
    service("api", { port: "4000" });
    expect(checkServiceFields(project.root).didPass).toBe(false);
    expect(checkServicePorts(project.root).didPass).toBe(false);
  });

  it("reports an invalid restart value on service.json", () => {
    service("api", { restart: "never" });
    const result = checkServiceFields(project.root);
    expect(result.didPass).toBe(false);
    expect(result.message).toContain("restart: expected one of");
  });
});
