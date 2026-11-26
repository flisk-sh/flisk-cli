// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readProjectConfig } from "../../../generator/template-engine.js";
import { captureExit, createTempDir, createTempProject } from "../../../test-support/index.js";
import { FliskError, ProcessExitError } from "../../../utils/errors.js";
import { infraToggleCommand, isOptionalInfraKey, toggleInfraService } from "../infra-toggle.js";
import { configProjectJson, inProject, readProjectJson } from "./helpers.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("isOptionalInfraKey", () => {
  it("accepts keys of optional_infra and rejects anything else", () => {
    const root = createTempProject({ projectJson: configProjectJson() });
    const config = readProjectConfig(root);

    expect(isOptionalInfraKey("monitoring", config)).toBe(true);
    expect(isOptionalInfraKey("verdaccio", config)).toBe(true);
    expect(isOptionalInfraKey("kafka", config)).toBe(false);
    expect(isOptionalInfraKey("optional_infra", config)).toBe(false);
    expect(isOptionalInfraKey("toString", config)).toBe(false);
    expect(isOptionalInfraKey("constructor", config)).toBe(false);
  });
});

describe("toggleInfraService", () => {
  it("enables a service and persists it to project.json", async () => {
    const root = createTempProject({ projectJson: configProjectJson("toggle-enable") });
    vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await inProject(root, () => toggleInfraService("monitoring", true));

    expect(result).toEqual({
      data: { service: "monitoring", enabled: true, wasEnabled: false },
    });
    expect(readProjectJson(root).optional_infra.monitoring).toBe(true);
  });

  it("disables a service that was enabled", async () => {
    const root = createTempProject({
      projectJson: configProjectJson("toggle-disable", { elk: true }),
    });
    vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await inProject(root, () => toggleInfraService("elk", false));

    expect(result).toEqual({ data: { service: "elk", enabled: false, wasEnabled: true } });
    expect(readProjectJson(root).optional_infra.elk).toBe(false);
  });

  it("dry-run reports the planned change and leaves project.json byte-identical", async () => {
    const root = createTempProject({ projectJson: configProjectJson("toggle-dry") });
    const configPath = path.join(root, ".flisk", "project.json");
    const before = fs.readFileSync(configPath, "utf8");
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });

    const result = await inProject(root, () =>
      toggleInfraService("monitoring", true, { dryRun: true }),
    );

    expect(result).toEqual({
      data: {
        dryRun: true,
        service: "monitoring",
        enabled: true,
        wasEnabled: false,
        changed: true,
      },
    });
    expect(logs.join("\n")).toContain("Would enable monitoring.");
    expect(fs.readFileSync(configPath, "utf8")).toBe(before);
  });

  it("dry-run reports no change when the service is already in the target state", async () => {
    const root = createTempProject({ projectJson: configProjectJson("toggle-dry-same") });
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });

    const result = await inProject(root, () =>
      toggleInfraService("monitoring", false, { dryRun: true }),
    );

    expect(result).toMatchObject({ data: { changed: false } });
    expect(logs.join("\n")).toContain("No change: monitoring is already disabled.");
  });

  it("rejects an unknown service name and writes nothing", async () => {
    const root = createTempProject({ projectJson: configProjectJson("toggle-bad") });
    const configPath = path.join(root, ".flisk", "project.json");
    const before = fs.readFileSync(configPath);
    const exit = captureExit();
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      errors.push(String(chunk));
      return true;
    });

    await expect(inProject(root, () => toggleInfraService("kafka", true))).rejects.toThrow(
      ProcessExitError,
    );

    exit.expectExit(1);
    expect(errors.join("\n")).toContain(
      "Invalid service. Must be one of: monitoring, elk, debezium, golden_image, verdaccio",
    );
    expect(fs.readFileSync(configPath)).toEqual(before);
  });

  it("rejects an unknown service name with a FliskError under --json", async () => {
    const root = createTempProject({ projectJson: configProjectJson("toggle-bad-json") });

    await expect(
      inProject(root, () => toggleInfraService("kafka", true, { json: true })),
    ).rejects.toThrow(FliskError);
    await expect(
      inProject(root, () => toggleInfraService("kafka", true, { json: true })),
    ).rejects.toThrow("Invalid service. Must be one of:");
  });

  it("refuses to enable verdaccio without a license and leaves project.json unchanged", async () => {
    vi.stubEnv("FLISK_LICENSE_KEY", "");
    const root = createTempProject({ projectJson: configProjectJson("toggle-verdaccio") });
    const configPath = path.join(root, ".flisk", "project.json");
    const before = fs.readFileSync(configPath);

    await expect(inProject(root, () => toggleInfraService("verdaccio", true))).rejects.toThrow(
      "Verdaccio is a Premium feature",
    );
    expect(fs.readFileSync(configPath)).toEqual(before);
  });

  it("lets verdaccio be disabled without a license", async () => {
    vi.stubEnv("FLISK_LICENSE_KEY", "");
    const root = createTempProject({
      projectJson: configProjectJson("toggle-verdaccio-off", { verdaccio: true }),
    });
    vi.spyOn(console, "log").mockImplementation(() => {});

    await inProject(root, () => toggleInfraService("verdaccio", false));

    expect(readProjectJson(root).optional_infra.verdaccio).toBe(false);
  });

  it("throws the project-root error outside a project under --json", async () => {
    const dir = createTempDir();

    await expect(
      inProject(dir, () => toggleInfraService("monitoring", true, { json: true })),
    ).rejects.toThrow("Could not find project root");
  });

  it("exits 1 outside a project without --json", async () => {
    const dir = createTempDir();
    const exit = captureExit();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(inProject(dir, () => toggleInfraService("monitoring", true))).rejects.toThrow(
      ProcessExitError,
    );

    exit.expectExit(1);
  });
});

describe("infraToggleCommand", () => {
  it("builds enable-infra and disable-infra with the same flags", () => {
    const enable = infraToggleCommand("enable-infra", true);
    const disable = infraToggleCommand("disable-infra", false);

    expect(enable.name()).toBe("enable-infra");
    expect(enable.description()).toBe("Enable optional infrastructure service");
    expect(disable.name()).toBe("disable-infra");
    expect(disable.description()).toBe("Disable optional infrastructure service");
    for (const command of [enable, disable]) {
      expect(command.registeredArguments.map((arg) => [arg.name(), arg.required])).toEqual([
        ["service", true],
      ]);
      expect(command.options.map((option) => option.flags)).toEqual([
        "--dry-run",
        "--ignore-version",
        "--json",
      ]);
    }
  });
});
