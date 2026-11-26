// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import type { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { UNHEALTHY_CONTAINER_MESSAGE } from "../tilt-resource-state.js";
import {
  healthProbeCannotRun,
  healthProbeDetail,
  withHealthProbeDetails,
} from "../up-readiness.js";

type Exec = typeof execFileSync;

/**
 * A `docker` that answers `ps` with `ids` and `inspect` with `inspect` for the tests: anything else throws like a
 * binary that is not installed would.
 */
function fakeDocker(ids: string, inspect: unknown): Exec {
  return ((file: string, args: string[]) => {
    expect(file).toContain("docker");
    if (args[0] === "ps") return ids;
    if (args[0] === "inspect") return JSON.stringify(Array.isArray(inspect) ? inspect : [inspect]);
    throw new Error(`unexpected docker ${args.join(" ")}`);
  }) as unknown as Exec;
}

const noDocker = (() => {
  throw new Error("spawn docker ENOENT");
}) as unknown as Exec;

function inspectJson(overrides: {
  status?: string;
  test?: string[] | null;
  log?: Array<{ ExitCode?: number; Output?: string }> | null;
  failingStreak?: number;
}): unknown {
  return [
    {
      State: {
        Status: overrides.status ?? "running",
        Health: {
          FailingStreak: overrides.failingStreak ?? 3,
          Log: overrides.log === undefined ? [] : overrides.log,
        },
      },
      Config: { Healthcheck: { Test: overrides.test === undefined ? null : overrides.test } },
    },
  ];
}

const CURL_PROBE = {
  ExitCode: -1,
  Output:
    'OCI runtime exec failed: exec failed: unable to start container process: exec: "curl": executable file not found',
};

describe("healthProbeDetail", () => {
  it("returns the health command without its CMD-SHELL marker and the last probe's output", () => {
    const exec = fakeDocker(
      "abc123\n",
      inspectJson({
        test: ["CMD-SHELL", "curl -f http://localhost:8000/health"],
        log: [{ ExitCode: 1, Output: "ok" }, CURL_PROBE],
      }),
    );
    const detail = healthProbeDetail("lychee-facial-recognition", {
      exec,
      redact: (text) => text,
    });
    expect(detail).toEqual({
      command: ["curl -f http://localhost:8000/health"],
      output: CURL_PROBE.Output,
      exitCode: -1,
    });
  });

  it("strips the CMD marker from an exec-form test and keeps each argv entry", () => {
    const exec = fakeDocker(
      "abc123\n",
      inspectJson({
        test: ["CMD", "curl", "-f", "http://localhost:4000/health"],
        log: [{ ExitCode: 7, Output: "curl: (7) Failed to connect" }],
      }),
    );
    const detail = healthProbeDetail("api", { exec, redact: (text) => text });
    expect(detail?.command).toEqual(["curl", "-f", "http://localhost:4000/health"]);
    expect(detail?.output).toBe("curl: (7) Failed to connect");
    expect(detail?.exitCode).toBe(7);
  });

  it("collapses a multiline probe output to one line and strips terminal escapes", () => {
    const exec = fakeDocker(
      "abc123\n",
      inspectJson({
        test: ["CMD", "wget", "-q", "http://localhost/health"],
        log: [
          { ExitCode: 1, Output: "\u001b[31mwget: can't connect\n  to remote host\u001b[0m\n" },
        ],
      }),
    );
    const detail = healthProbeDetail("web", { exec, redact: (text) => text });
    expect(detail?.output).toBe("wget: can't connect to remote host");
  });

  it("masks the probe output with the redaction it is given", () => {
    const exec = fakeDocker(
      "abc123\n",
      inspectJson({
        test: ["CMD", "curl", "-f", "http://localhost/health"],
        log: [{ ExitCode: 1, Output: "token=hunter2 refused" }],
      }),
    );
    const detail = healthProbeDetail("api", {
      exec,
      redact: (text) => text.replace("hunter2", "***"),
    });
    expect(detail?.output).toBe("token=*** refused");
  });

  it("keeps the end of a probe output that is too long for one line", () => {
    const exec = fakeDocker(
      "abc123\n",
      inspectJson({
        test: ["CMD", "curl", "-f", "http://localhost/health"],
        log: [{ ExitCode: 1, Output: `head ${"x".repeat(400)} tail` }],
      }),
    );
    const detail = healthProbeDetail("api", { exec, redact: (text) => text });
    expect(detail?.output.startsWith("…")).toBe(true);
    expect(detail?.output.endsWith("tail")).toBe(true);
    expect(detail?.output.length).toBeLessThanOrEqual(300);
  });

  it("is null when the service has no container, more than one, or Docker cannot answer", () => {
    expect(
      healthProbeDetail("api", { exec: fakeDocker("", inspectJson({})), redact: (t) => t }),
    ).toBeNull();
    expect(
      healthProbeDetail("api", { exec: fakeDocker("a\nb\n", inspectJson({})), redact: (t) => t }),
    ).toBeNull();
    expect(healthProbeDetail("api", { exec: noDocker, redact: (t) => t })).toBeNull();
  });

  it("is null when the container is not running or no probe has been recorded yet", () => {
    const exited = fakeDocker("abc\n", inspectJson({ status: "exited", log: [CURL_PROBE] }));
    expect(healthProbeDetail("api", { exec: exited, redact: (t) => t })).toBeNull();
    const noProbes = fakeDocker("abc\n", inspectJson({ status: "running", log: [] }));
    expect(healthProbeDetail("api", { exec: noProbes, redact: (t) => t })).toBeNull();
  });
});

describe("withHealthProbeDetails", () => {
  const probe = { command: ["curl", "-f", "x"], output: "boom", exitCode: 1 };
  const probeOf = () => probe;

  it("adds the probe to a runtime failure (container running, health check failing)", () => {
    const [failure] = withHealthProbeDetails(
      [{ name: "api", message: UNHEALTHY_CONTAINER_MESSAGE, runtime: true }],
      probeOf,
    );
    expect(failure?.probe).toEqual(probe);
  });

  it("matches on the health-check message when the runtime flag did not survive", () => {
    const [failure] = withHealthProbeDetails(
      [{ name: "api", message: UNHEALTHY_CONTAINER_MESSAGE }],
      probeOf,
    );
    expect(failure?.probe).toEqual(probe);
  });

  it("leaves build and other failures alone, and never asks Docker about them", () => {
    const never = () => {
      throw new Error("must not be called");
    };
    const failures = withHealthProbeDetails(
      [
        { name: "api", message: "build failed: exit status 1" },
        { name: "db", message: "exited with code 2", runtime: false },
      ],
      never,
    );
    expect(failures.every((failure) => failure.probe === undefined)).toBe(true);
  });

  it("keeps the failure without a probe when Docker cannot inspect the service", () => {
    const [failure] = withHealthProbeDetails(
      [{ name: "api", message: UNHEALTHY_CONTAINER_MESSAGE, runtime: true }],
      () => null,
    );
    expect(failure?.probe).toBeUndefined();
    expect(failure?.name).toBe("api");
  });

  it("inspects at most five health-check failures so a stack that fails everywhere stays fast", () => {
    const names: string[] = [];
    const failures = withHealthProbeDetails(
      Array.from({ length: 7 }, (_, i) => ({
        name: `svc-${i}`,
        message: UNHEALTHY_CONTAINER_MESSAGE,
        runtime: true,
      })),
      (service) => {
        names.push(service);
        return probe;
      },
    );
    expect(names).toHaveLength(5);
    expect(failures.filter((failure) => failure.probe !== undefined)).toHaveLength(5);
  });
});

describe("healthProbeCannotRun", () => {
  it("is true when every recorded probe never ran its command (curl missing from the image)", () => {
    const exec = fakeDocker(
      "abc\n",
      inspectJson({ test: ["CMD", "curl", "-f", "x"], log: [CURL_PROBE, CURL_PROBE] }),
    );
    expect(healthProbeCannotRun("api", { exec })).toBe(true);
  });

  it("is false when a recorded probe ran and failed, and when Docker cannot answer", () => {
    const ran = fakeDocker(
      "abc\n",
      inspectJson({ log: [{ ExitCode: 1, Output: "connection refused" }] }),
    );
    expect(healthProbeCannotRun("api", { exec: ran })).toBe(false);
    expect(healthProbeCannotRun("api", { exec: noDocker })).toBe(false);
  });
});
