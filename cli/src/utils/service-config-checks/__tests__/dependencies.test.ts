// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { checkCircularDependencies, checkDependsOnShape } from "../dependencies.js";
import { tempProject } from "./helpers.js";

const project = tempProject("flisk-dependency-checks-");
const { service } = project;

describe("the two dependsOn checks on one project", () => {
  it("both pass for a flat dependency list", () => {
    service("db");
    service("api", { port: 4001, dependsOn: ["db"] });
    service("worker", { port: 4002, dependsOn: ["api"] });
    expect(checkDependsOnShape(project.root).didPass).toBe(true);
    expect(checkCircularDependencies(project.root).didPass).toBe(true);
  });

  it("a cycle fails checkCircularDependencies while the shape check still passes", () => {
    service("api", { dependsOn: ["worker"] });
    service("worker", { port: 4001, dependsOn: ["api"] });
    expect(checkDependsOnShape(project.root).didPass).toBe(true);
    const cycles = checkCircularDependencies(project.root);
    expect(cycles.didPass).toBe(false);
    expect(cycles.message).toContain("api -> worker -> api");
  });

  it("a malformed dependsOn fails the shape check without confusing the cycle check", () => {
    service("api", { dependsOn: "worker" });
    const shape = checkDependsOnShape(project.root);
    expect(shape.didPass).toBe(false);
    expect(shape.message).toContain('dependsOn "worker"');
    expect(shape.message).toContain("expected an array of service names");
    expect(() => checkCircularDependencies(project.root)).not.toThrow();
    expect(checkCircularDependencies(project.root).didPass).toBe(true);
  });
});

describe("checkDependsOnShape", () => {
  it.each([["worker"], [7], [{ a: 1 }], [["api", 2]]])("rejects dependsOn %j", (dependsOn) => {
    service("api", { dependsOn });
    expect(checkDependsOnShape(project.root).didPass).toBe(false);
  });

  it("accepts a missing or empty dependsOn", () => {
    service("api", { dependsOn: [] });
    service("db", { port: 4001 });
    expect(checkDependsOnShape(project.root).didPass).toBe(true);
  });
});

describe("checkCircularDependencies", () => {
  it("catches a service that depends on itself", () => {
    service("api", { dependsOn: ["api"] });
    const result = checkCircularDependencies(project.root);
    expect(result.didPass).toBe(false);
    expect(result.message).toContain("api -> api");
  });

  it("reports a three-service loop once, starting from the alphabetically first name", () => {
    service("c", { dependsOn: ["a"] });
    service("a", { port: 4001, dependsOn: ["b"] });
    service("b", { port: 4002, dependsOn: ["c"] });
    const result = checkCircularDependencies(project.root);
    expect(result.didPass).toBe(false);
    expect(result.message).toContain("a -> b -> c -> a");
    expect(result.message.match(/circular dependency a ->/g)).toHaveLength(1);
  });

  it("passes on a diamond, where every service is reached twice but none loops", () => {
    service("db");
    service("api", { port: 4001, dependsOn: ["db"] });
    service("worker", { port: 4002, dependsOn: ["db"] });
    service("web", { port: 4003, dependsOn: ["api", "worker"] });
    expect(checkCircularDependencies(project.root).didPass).toBe(true);
  });

  it("ignores a dependsOn entry that names no resource, leaving it to the unknown-name check", () => {
    service("api", { dependsOn: ["ghost"] });
    expect(checkCircularDependencies(project.root).didPass).toBe(true);
  });

  it("follows Compose-style { name, condition } entries, which are valid shape", () => {
    service("api", { dependsOn: [{ name: "worker", condition: "service_healthy" }] });
    service("worker", { port: 4001, dependsOn: ["api"] });
    expect(checkDependsOnShape(project.root).didPass).toBe(true);
    const cycles = checkCircularDependencies(project.root);
    expect(cycles.didPass).toBe(false);
    expect(cycles.message).toContain("api -> worker -> api");
  });
});
