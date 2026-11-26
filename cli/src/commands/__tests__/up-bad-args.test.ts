// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { spawnSync } from "node:child_process";
import { beforeEach, describe, expect, it } from "vitest";
import type { Envelope } from "../../test-support/index.js";
import { createTempProject, fliskBin, parseEnvelope, runFlisk } from "../../test-support/index.js";
import { unknownServiceSuggestions, upError } from "../up.js";

/**
 * Every argument the user typed wrong stops `flisk up` with the usage exit code and keeps its own error
 * code, so a script can tell "fix my flags" from "the stack failed" (#4521). Both native (local process)
 * and container (Docker/Compose/Tilt) projects are covered: the checks live on different paths.
 */

const NATIVE_PROJECT = {
  projectJson: {
    name: "bad-args",
    version: "1.0.0",
    phases: { alpha: { name: "alpha", description: "", enabledStacks: ["app"] } },
  },
  stacks: {
    app: {
      api: { appType: "backend", schemaVersion: 1, port: 4000, command: "echo hi" },
      web: {
        appType: "frontend",
        schemaVersion: 1,
        port: 3000,
        command: "echo hi",
        profiles: ["tools"],
      },
    },
  },
};

/** A container-mode service declares a port and no `command`, so `selectNativeRun` returns null. */
const CONTAINER_PROJECT_JSON = {
  version: "1.0.0",
  project: { name: "bad-args", version: "1.0.0" },
  phases: Object.fromEntries(
    ["pre_alpha", "alpha", "beta", "out_of_scope"].map((name) => [
      name,
      { name, description: "", enabledStacks: name === "alpha" ? ["app"] : [] },
    ]),
  ),
  optional_infra: {
    monitoring: false,
    elk: false,
    debezium: false,
    golden_image: false,
    verdaccio: false,
  },
  discovery: { paths: ["services/**"] },
};

const CONTAINER_PROJECT = {
  projectJson: CONTAINER_PROJECT_JSON,
  stacks: {
    app: {
      api: { appType: "backend", schemaVersion: 1, port: 4000 },
      web: {
        appType: "frontend",
        schemaVersion: 1,
        port: 3000,
        profiles: ["tools"],
      },
    },
  },
};

let dir: string;

beforeEach(() => {
  dir = createTempProject(NATIVE_PROJECT);
});

/** One `flisk up --json` refusal, with the exit code and the error code it reports. */
function refusal(args: readonly string[]): { status: number; code: string } {
  const result = runFlisk(["up", "--json", ...args], { cwd: dir });
  const envelope = parseEnvelope(result.stdout);
  expect(envelope.errors).toHaveLength(1);
  const error = envelope.errors[0] as { code: string };
  return { status: result.status, code: error.code };
}

/**
 * Runs `flisk <args>` with a `--` separator before the entry point. Node then forwards every later
 * argument, including `--env-file`, to the script instead of reading it as a Node option. That lets
 * a test pass a file that really is missing on disk and exercise the CLI's own refusal.
 */
function runFliskWithNodeOptionsSeparated(args: readonly string[]): {
  status: number;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(process.execPath, ["--", fliskBin, ...args], {
    cwd: dir,
    encoding: "utf-8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  if (result.error) throw result.error;
  if (result.status === null) throw new Error(`flisk ${args.join(" ")} was killed by a signal`);
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** A refused `--env-file` with a file that is genuinely absent, asserted on the JSON envelope. */
function missingEnvFileRefusal(args: readonly string[]): { status: number; code: string } {
  const result = runFliskWithNodeOptionsSeparated(["up", "--json", ...args]);
  const envelope = parseEnvelope(result.stdout);
  expect(envelope.errors).toHaveLength(1);
  return { status: result.status, code: (envelope.errors[0] as { code: string }).code };
}

describe("flisk up exits 2 for arguments the user typed wrong (#4521)", () => {
  it.each([
    {
      name: "an unknown profile",
      args: ["--profile", "nope", "--dry-run"],
      code: "UNKNOWN_PROFILE",
    },
    { name: "an unknown service", args: ["--only", "nope", "--dry-run"], code: "UNKNOWN_SERVICE" },
  ])("reports $code and exits 2 for $name", ({ args, code }) => {
    const { status, code: reported } = refusal(args);
    expect(reported).toBe(code);
    expect(status).toBe(2);
  });

  it("reports INVALID_WAIT_TIMEOUT and exits 2 for an invalid wait timeout", () => {
    const result = runFlisk(["up", "--json", "--wait", "--wait-timeout", "0", "--dry-run"], {
      cwd: dir,
    });
    const envelope = parseEnvelope(result.stdout);
    expect(envelope.errors[0]).toMatchObject({ code: "INVALID_WAIT_TIMEOUT" });
    expect(result.status).toBe(2);
  });

  it("keeps the usage exit code for a rejected --env-file", () => {
    const { status, code } = missingEnvFileRefusal(["--env-file", "nope.env", "--dry-run"]);
    expect(code).toBe("ENV_FILE_INVALID");
    expect(status).toBe(2);
  });

  it("still exits 1 for a run the stack itself refuses", () => {
    // Mixing a local-process service with container services is a stack problem, not a typed-argument problem.
    dir = createTempProject({
      projectJson: NATIVE_PROJECT.projectJson,
      stacks: {
        app: { api: { appType: "backend", schemaVersion: 1, port: 4000, command: "echo hi" } },
      },
      resources: { web: { appType: "backend", schemaVersion: 1, port: 3000 } },
    });
    const result = runFlisk(["up", "--json", "--dry-run"], { cwd: dir });
    const envelope = parseEnvelope(result.stdout);
    expect(envelope.errors[0]).toMatchObject({ code: "MIXED_RUNTIME" });
    expect(result.status).toBe(1);
  });
});

describe("flisk up container mode exits 2 for arguments the user typed wrong (#4521)", () => {
  beforeEach(() => {
    dir = createTempProject(CONTAINER_PROJECT);
  });

  it.each([
    { name: "an unknown service", args: ["--only", "nope"], code: "UNKNOWN_SERVICE" },
    { name: "an unknown profile", args: ["--profile", "nope"], code: "UNKNOWN_PROFILE" },
  ])("reports $code and exits 2 for $name", ({ args, code }) => {
    const { status, code: reported } = refusal([...args, "--dry-run"]);
    expect(reported).toBe(code);
    expect(status).toBe(2);
  });

  it("reports ENV_FILE_INVALID and exits 2 for a missing --env-file", () => {
    const { status, code } = missingEnvFileRefusal(["--env-file", "nope.env", "--dry-run"]);
    expect(code).toBe("ENV_FILE_INVALID");
    expect(status).toBe(2);
  });
});

describe("flisk up --json error shape consistency (#4522)", () => {
  it("creates up errors with guaranteed suggestions array", () => {
    expect(upError("CODE", "msg")).toEqual({
      code: "CODE",
      message: "msg",
      suggestions: [],
    });
    expect(upError("CODE", "msg", ["hint"])).toEqual({
      code: "CODE",
      message: "msg",
      suggestions: ["hint"],
    });
  });

  it("populates unknownServiceSuggestions with closest matches or valid service names", () => {
    expect(unknownServiceSuggestions(["widgt"], ["widget"], ['Did you mean "widget"?'])).toEqual([
      'Did you mean "widget"?',
    ]);
    expect(unknownServiceSuggestions(["nope"], ["web", "api"])).toEqual(["api", "web"]);
    expect(unknownServiceSuggestions(["nope", "nah"], ["web", "api"])).toEqual(["api", "web"]);
    // With no valid names the project is empty: point at adding a resource, not at an empty list (#4966).
    expect(unknownServiceSuggestions(["nope"], [])).toEqual([
      "Add one: flisk resource api --type backend --stack main",
      "Or start from a template: flisk create",
    ]);
  });

  it("populates suggestions with valid service names for UNKNOWN_SERVICE in native mode", () => {
    const result = runFlisk(["up", "--json", "--only", "nope", "--dry-run"], { cwd: dir });
    const envelope = parseEnvelope(result.stdout);
    expect(envelope.errors).toHaveLength(1);
    expect(envelope.errors[0]).toEqual({
      code: "UNKNOWN_SERVICE",
      message: "Unknown service nope. Valid names: api, web",
      suggestions: ["api", "web"],
    });
  });

  it("accepts comma-separated --only names with whitespace and empty entries (#5313)", () => {
    // Own ports: another process on this machine may hold the fixture's default 4000.
    const portsDir = createTempProject({
      projectJson: NATIVE_PROJECT.projectJson,
      stacks: {
        app: {
          api: { ...NATIVE_PROJECT.stacks.app.api, port: 49500 },
          web: { ...NATIVE_PROJECT.stacks.app.web, port: 49501 },
        },
      },
    });
    const comma = runFlisk(["up", "--json", "--only", "api, web,", "--dry-run"], {
      cwd: portsDir,
    });
    const spaced = runFlisk(["up", "--json", "--only", "api", "web", "--dry-run"], {
      cwd: portsDir,
    });
    const commaEnvelope = parseEnvelope(comma.stdout);
    expect(commaEnvelope.errors).toEqual([]);
    expect(commaEnvelope.data).toMatchObject({
      ok: true,
      services: ["api", "web"],
      requested: ["api", "web"],
    });
    expect(commaEnvelope).toEqual(parseEnvelope(spaced.stdout));
  });

  it("populates suggestions with closest match when available for UNKNOWN_SERVICE", () => {
    const result = runFlisk(["up", "--json", "--only", "ap", "--dry-run"], { cwd: dir });
    const envelope = parseEnvelope(result.stdout);
    expect(envelope.errors).toHaveLength(1);
    expect(envelope.errors[0]).toMatchObject({
      code: "UNKNOWN_SERVICE",
      suggestions: ['Did you mean "api"?'],
    });
  });

  it("populates suggestions with valid service names for UNKNOWN_SERVICE in container mode", () => {
    const containerDir = createTempProject(CONTAINER_PROJECT);
    const result = runFlisk(["up", "--json", "--only", "nope", "--dry-run"], {
      cwd: containerDir,
    });
    const envelope = parseEnvelope(result.stdout);
    expect(envelope.errors).toHaveLength(1);
    expect(envelope.errors[0]).toEqual({
      code: "UNKNOWN_SERVICE",
      message: "Unknown service nope. Valid names: api, web",
      suggestions: ["api", "web"],
    });
  });

  it("populates suggestions with a non-empty example for INVALID_WAIT_TIMEOUT", () => {
    const result = runFlisk(["up", "--json", "--wait", "--wait-timeout", "0", "--dry-run"], {
      cwd: dir,
    });
    const envelope = parseEnvelope(result.stdout);
    expect(envelope.errors).toHaveLength(1);
    expect(envelope.errors[0]).toEqual({
      code: "INVALID_WAIT_TIMEOUT",
      message: "--wait-timeout must be a whole number of seconds from 1 to 21600",
      suggestions: ["--wait-timeout 600"],
    });
  });

  it("ensures all errors[] entries carry a non-empty suggestions array across bad arguments", () => {
    const testCases = [
      ["--only", "nope", "--dry-run"],
      ["--profile", "nope", "--dry-run"],
      ["--wait", "--wait-timeout", "0", "--dry-run"],
    ];
    for (const args of testCases) {
      const result = runFlisk(["up", "--json", ...args], { cwd: dir });
      const envelope = parseEnvelope(result.stdout);
      expect(envelope.errors.length).toBeGreaterThan(0);
      for (const err of envelope.errors) {
        expect(Array.isArray(err.suggestions)).toBe(true);
        expect((err.suggestions as string[]).length).toBeGreaterThan(0);
      }
    }
  });
});

describe("flisk up --only in a project with no resources (#4966)", () => {
  beforeEach(() => {
    // A valid project.json and no service.json files: the project exists but discovers zero resources.
    dir = createTempProject({ projectJson: CONTAINER_PROJECT_JSON });
  });

  it("refuses like plain up: the no-resources message and suggestions, exit 1", () => {
    const env = { FLISK_ALLOW_NATIVE_WINDOWS: "1" };
    const selected = runFlisk(["up", "--only", "nope", "--dry-run"], { cwd: dir, env });
    const plain = runFlisk(["up", "--dry-run"], { cwd: dir, env });

    expect(selected.status).toBe(1);
    expect(plain.status).toBe(1);
    expect(selected.stderr).toBe(plain.stderr);
    expect(selected.stderr).toContain(
      "This project has no resources yet, so there is nothing to start.",
    );
    expect(selected.stderr).toContain("Add one: flisk resource api --type backend --stack main");
    expect(selected.stderr).toContain("Or start from a template: flisk create");
    expect(selected.stderr).not.toContain("Unknown service");
    expect(selected.stderr).not.toContain("Valid names:");
  });

  it("--json reports the same NO_RESOURCES code as plain up and exits 1", () => {
    const env = { FLISK_ALLOW_NATIVE_WINDOWS: "1" };
    const selected = runFlisk(["up", "--json", "--only", "nope", "--dry-run"], {
      cwd: dir,
      env,
    });
    const plain = runFlisk(["up", "--json", "--dry-run"], { cwd: dir, env });

    const selectedEnvelope = parseEnvelope(selected.stdout);
    const plainEnvelope = parseEnvelope(plain.stdout);
    expect(selected.status).toBe(1);
    expect(selectedEnvelope.errors).toHaveLength(1);
    expect(selectedEnvelope.errors[0]).toEqual(plainEnvelope.errors[0]);
    expect(selectedEnvelope.errors[0]).toMatchObject({
      code: "NO_RESOURCES",
      message: "This project has no resources yet, so there is nothing to start.",
      suggestions: [
        "Add one: flisk resource api --type backend --stack main",
        "Or start from a template: flisk create",
      ],
    });
  });
});
