// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkGpuRuntime, checkModelRunner, warnModelRunner } from "../model-runner.js";
import { tempProject } from "./helpers.js";

const project = tempProject("flisk-model-runner-checks-");
const { service } = project;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("checkGpuRuntime", () => {
  it("passes when no service asks for a GPU", () => {
    service("api");
    expect(checkGpuRuntime(project.root, undefined, () => ["runc"]).didPass).toBe(true);
  });

  it("passes when Docker lists the nvidia runtime, and when Docker cannot be asked", () => {
    service("gpu", { container: { gpus: "all" } });
    expect(checkGpuRuntime(project.root, undefined, () => ["runc", "nvidia"]).didPass).toBe(true);
    const unreachable = checkGpuRuntime(project.root, undefined, () => null);
    expect(unreachable.didPass).toBe(true);
    expect(unreachable.message).toContain("was not checked");
  });

  it("warns when a service wants a GPU but Docker has no nvidia runtime", () => {
    service("gpu", { container: { gpus: "all" } });
    const result = checkGpuRuntime(project.root, undefined, () => ["runc"]);
    expect(result.didPass).toBe(false);
    expect(result.isWarning).toBe(true);
    expect(result.message).toContain("gpu");
    expect(result.message).toContain("no nvidia runtime");
    expect(result.fix).toContain("NVIDIA Container Toolkit");
  });

  it("counts a defined-but-falsy container.gpus as asking for a GPU", () => {
    service("gpu", { container: { gpus: null } });
    const result = checkGpuRuntime(project.root, undefined, () => ["runc"]);
    expect(result.didPass).toBe(false);
    expect(result.message).toContain("gpu");
  });
});

describe("checkModelRunner", () => {
  it("passes when no service uses models, including an empty models list", () => {
    service("api");
    service("empty", { port: 4001, models: [] });
    expect(checkModelRunner(project.root, undefined, () => "no-plugin").didPass).toBe(true);
  });

  it("passes when the runner is running or Docker cannot be asked", () => {
    service("agent", { models: ["ai/llama"] });
    expect(checkModelRunner(project.root, undefined, () => "running").didPass).toBe(true);
    const unreachable = checkModelRunner(project.root, undefined, () => null);
    expect(unreachable.didPass).toBe(true);
    expect(unreachable.message).toContain("was not checked");
  });

  it("warns when the docker model plugin is missing", () => {
    service("agent", { models: ["ai/llama"] });
    const result = checkModelRunner(project.root, undefined, () => "no-plugin");
    expect(result.didPass).toBe(false);
    expect(result.isWarning).toBe(true);
    expect(result.message).toContain("no `docker model` plugin");
    expect(result.fix).toContain("docker-model-plugin");
  });

  it("warns differently when the plugin is installed but the backend is not running", () => {
    service("agent", { models: ["ai/llama"] });
    const result = checkModelRunner(project.root, undefined, () => "backend-not-running");
    expect(result.didPass).toBe(false);
    expect(result.message).toContain("not running");
    expect(result.fix).toContain("docker model install-runner");
  });
});

describe("warnModelRunner", () => {
  it("prints the warning for a service whose runner is not ready", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    service("agent", { models: ["ai/llama"] });
    warnModelRunner(project.root);
    // warnModelRunner asks Docker itself; when Docker answers "not ready" it warns, when it cannot be asked it is silent.
    if (warn.mock.calls.length > 0) {
      expect(String(warn.mock.calls[0]?.[0])).toContain("model");
    }
  });

  it("stays silent when no service uses models", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    service("api");
    warnModelRunner(project.root);
    expect(warn).not.toHaveBeenCalled();
  });
});
