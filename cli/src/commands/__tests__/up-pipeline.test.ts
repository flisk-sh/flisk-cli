// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jsonOutput = vi.hoisted(() => ({ createJsonEmitter: vi.fn() }));
vi.mock("../../utils/json-output.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/json-output.js")>()),
  createJsonEmitter: jsonOutput.createJsonEmitter,
}));

import {
  containerSteps,
  createUpRun,
  runUpSteps,
  startupSteps,
  type UpRun,
  type UpStep,
  upSteps,
} from "../up-steps.js";

const BASE_OPTIONS = {
  verbose: false,
  quiet: false,
  dryRun: false,
  force: false,
  ignoreDrift: false,
  ignoreVersion: false,
  json: false,
  wait: false,
} as const;

function makeRun(
  overrides: { stackName?: string; options?: Partial<UpRun["options"]> } = {},
): UpRun {
  return createUpRun(overrides.stackName, { ...BASE_OPTIONS, ...overrides.options });
}

/** A step that records its name when it runs; the runner's ordering is the assertion. */
function recorder(
  calls: string[],
  name: string,
  options?: { finish?: boolean; guard?: boolean },
): UpStep {
  return {
    name,
    ...(options?.guard === undefined ? {} : { guard: () => options.guard === true }),
    run: (run) => {
      calls.push(name);
      if (options?.finish) run.didFinish = true;
    },
  };
}

describe("up pipeline step order (#4862)", () => {
  it("lists the preflight and runtime-branch steps in the order the action used to run them", () => {
    expect(upSteps.map((step) => step.name)).toEqual([
      "secret-provider",
      "git-clone",
      "wait",
      "json-quiet",
      "tilt-port",
      "fast-noop",
      "version-floor",
      "clone-repos",
      "inferred-node",
      "native-run",
      "project-root",
      "platform-gate",
      "env-file",
      "host-gate",
      "docker-maintenance",
      "disk-guard",
      "schema-gate",
      "machine-preflight",
      "container-run",
    ]);
  });

  it("lists the container run's steps in the order its gates, writes and start ran", () => {
    expect(containerSteps.map((step) => step.name)).toEqual([
      "project-root",
      "discovery",
      "selection-args",
      "drift-gate",
      "service-config-gate",
      "dependency-warnings",
      "host-port-plan",
      "project-writes",
      "service-selection",
      "startup-plan",
      "dry-run",
      "tilt-port-scan",
      "attach-running",
      "only-blocked",
      "resolve-port",
      "cold-notice",
      "model-preflight",
      "tilt-up",
    ]);
  });

  it("runs the startup report's steps in readiness order, failure signal last", () => {
    expect(startupSteps.map((step) => step.name)).toEqual([
      "tilt-ui",
      "json-readiness",
      "human-readiness",
      "service-health",
      "smoke",
      "emit-ready",
      "record-run",
      "signal-failure",
    ]);
  });
});

describe("runUpSteps runner", () => {
  it("runs every step in order until one marks the run done", async () => {
    const calls: string[] = [];
    const run = makeRun();
    const steps: UpStep[] = [
      recorder(calls, "step-0"),
      recorder(calls, "step-1", { finish: true }),
      recorder(calls, "step-2"),
    ];
    await runUpSteps(run, steps);
    expect(calls).toEqual(["step-0", "step-1"]);
  });

  it("skips a step whose guard is false and runs the rest", async () => {
    const calls: string[] = [];
    const run = makeRun();
    const steps: UpStep[] = [
      recorder(calls, "step-0", { guard: false }),
      recorder(calls, "step-1"),
      recorder(calls, "step-2", { guard: true }),
    ];
    await runUpSteps(run, steps);
    expect(calls).toEqual(["step-1", "step-2"]);
  });

  it("checks guards before the didFinish flag and between steps", async () => {
    // The dry-run container steps skip the writes/start refusals; the same mechanism is asserted
    // here without touching Docker or the filesystem.
    const run = makeRun({ options: { dryRun: true } });
    const calls: string[] = [];
    await runUpSteps(run, [
      {
        name: "real-only",
        guard: (r) => !r.options.dryRun,
        run: () => {
          calls.push("real-only");
        },
      },
      {
        name: "dry-only",
        guard: (r) => Boolean(r.options.dryRun),
        run: () => {
          calls.push("dry-only");
        },
      },
    ]);
    expect(calls).toEqual(["dry-only"]);
  });
});

describe("UpRun exit primitive", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code ?? 0})`);
    }) as never);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("fail emits the machine error through the run's emitter and exits with the given code", () => {
    const emitted: { data: unknown; errors: unknown }[] = [];
    jsonOutput.createJsonEmitter.mockReturnValue(
      (data: unknown, errors: unknown) => void emitted.push({ data, errors }),
    );
    const run = makeRun({ options: { json: true } });
    expect(() => run.fail("SOME_CODE", "the message", ["a hint"], 2)).toThrow("process.exit(2)");
    expect(emitted).toEqual([
      {
        data: { ok: false },
        errors: [{ code: "SOME_CODE", message: "the message", suggestions: ["a hint"] }],
      },
    ]);
  });

  it("fail in human mode prints the message and exits", () => {
    const run = makeRun();
    expect(() => run.fail("SOME_CODE", "the message")).toThrow("process.exit(1)");
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain("the message");
  });
});

describe("focused steps", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code ?? 0})`);
    }) as never);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it("json-quiet turns --quiet on when --json is set, like the action did", async () => {
    const run = makeRun({ options: { json: true } });
    await upSteps.find((step) => step.name === "json-quiet")?.run(run);
    expect(run.options.quiet).toBe(true);
  });

  it("tilt-port refuses an invalid TILT_PORT before anything else runs", () => {
    vi.stubEnv("TILT_PORT", "not-a-port");
    const run = makeRun();
    const step = upSteps.find((step) => step.name === "tilt-port");
    expect(() => step?.run(run)).toThrow("process.exit(1)");
    expect(run.configuredTiltPort).toBeUndefined();
  });

  it("tilt-port records a valid TILT_PORT for the scan step", () => {
    vi.stubEnv("TILT_PORT", "10400");
    const run = makeRun();
    upSteps.find((step) => step.name === "tilt-port")?.run(run);
    expect(run.configuredTiltPort).toBe(10400);
  });

  it("wait validates --wait-timeout even for a dry run, before delegating", async () => {
    const run = makeRun({ options: { wait: true, dryRun: true, waitTimeout: "0" } });
    const step = upSteps.find((step) => step.name === "wait");
    await expect(step?.run(run)).rejects.toThrow("process.exit(2)");
  });

  it("secret-provider refuses an unknown provider with its own exit code", () => {
    vi.stubEnv("FLISK_SECRET_PROVIDER", "keychan");
    const run = makeRun();
    const step = upSteps.find((step) => step.name === "secret-provider");
    expect(() => step?.run(run)).toThrow("process.exit(2)");
  });

  it("fast-noop snapshots the flags every later step reads, and stays quiet outside a project", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flisk-up-steps-"));
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      const run = makeRun();
      await upSteps.find((step) => step.name === "fast-noop")?.run(run);
      expect(run.fastFlags?.stackName).toBeUndefined();
      expect(run.fastFlags?.env).toBeTypeOf("object");
      expect(run.didFinish).toBe(false);
    } finally {
      process.chdir(cwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("native-run falls through for a folder that is no native project", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flisk-up-steps-"));
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      const run = makeRun();
      await upSteps.find((step) => step.name === "native-run")?.run(run);
      expect(run.didFinish).toBe(false);
    } finally {
      process.chdir(cwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
