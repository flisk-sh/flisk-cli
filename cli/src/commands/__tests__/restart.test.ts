// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createTempDir, createTempProject } from "../../test-support/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const cliPath = path.join(repoRoot, "cli", "bin", "flisk.js");

function runFlisk(args: string[], cwd: string, env?: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf-8",
    env: env ? { ...process.env, ...env } : process.env,
  });
}

const containerService = { appType: "backend", port: 4000 };
const nativeServices = {
  api: { ...containerService, command: "node server.js" },
  web: { appType: "frontend", port: 3000, command: "node server.js" },
};

describe("flisk restart", () => {
  it("fails when called outside a Flisk project", () => {
    const res = runFlisk(["restart", "api", "--json"], createTempDir());
    expect(res.status).not.toBe(0);
    const envelope = JSON.parse(res.stdout);
    expect(envelope.errors[0].code).toBe("NOT_IN_PROJECT");
  });

  it("reports TILT_NOT_RUNNING when tilt is not running for the project", () => {
    // The resource must exist in the project so restart passes the name check and
    // reaches the Tilt probe; otherwise it fails earlier with UNKNOWN_RESOURCE.
    const tmp = createTempProject({ resources: { api: containerService } });
    const res = runFlisk(["restart", "api", "--json", "--port=59999"], tmp);
    expect(res.status).not.toBe(0);
    const envelope = JSON.parse(res.stdout);
    expect(envelope.errors[0].code).toBe("TILT_NOT_RUNNING");
  });

  it("preserves the Tilt guidance for a container project", () => {
    const tmp = createTempProject({ resources: { api: containerService } });
    const res = runFlisk(["restart", "api"], tmp, { TILT_PORT: "59999" });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Could not reach Tilt on port 59999");
    expect(res.stderr).toContain("Start the stack first with: flisk up");
    expect(res.stderr).not.toContain("flisk down && flisk up");
  });

  it("reports the missing supervising run in text mode without mentioning Tilt as a running requirement", () => {
    const tmp = createTempProject({ resources: nativeServices });
    const res = runFlisk(["restart", "api"], tmp, { TILT_PORT: "59999" });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("no `flisk up` is running for this project");
    expect(res.stderr).toContain("Start the project with: flisk up");
    expect(res.stderr).not.toContain("requires Tilt");
    expect(res.stderr).not.toContain("Could not reach Tilt");
  });

  it("returns NATIVE_NOT_RUNNING for a native project without calling Tilt", () => {
    const tmp = createTempProject({ resources: nativeServices });
    const res = runFlisk(["restart", "api", "--json", "--port=59999"], tmp);
    expect(res.status).toBe(1);
    const envelope = JSON.parse(res.stdout);
    expect(envelope.data).toBeNull();
    expect(envelope.errors).toHaveLength(1);
    expect(envelope.errors[0]).toEqual({
      code: "NATIVE_NOT_RUNNING",
      message:
        "`flisk restart` asks the running `flisk up` to restart local processes; no `flisk up` is running for this project.",
      suggestions: ["Start the project with: flisk up"],
    });
    expect(res.stdout).not.toContain("TILT_NOT_RUNNING");
  });

  it("returns NATIVE_NOT_RUNNING for a no-name restart in a native project with no run", () => {
    const tmp = createTempProject({ resources: nativeServices });
    const res = runFlisk(["restart", "--json"], tmp);
    expect(res.status).toBe(1);
    const envelope = JSON.parse(res.stdout);
    expect(envelope.data).toBeNull();
    expect(envelope.errors[0].code).toBe("NATIVE_NOT_RUNNING");
  });

  it("keeps the missing-argument usage error for a no-name restart in a container project", () => {
    const tmp = createTempProject({ resources: { api: containerService } });
    const res = runFlisk(["restart"], tmp);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("missing required argument 'resource'");
    expect(res.stderr).toContain("Run `flisk resources`");

    const jsonRes = runFlisk(["restart", "--json"], tmp);
    expect(jsonRes.status).toBe(2);
    expect(jsonRes.stderr).toBe("");
    const envelope = JSON.parse(jsonRes.stdout);
    expect(envelope.data).toBeNull();
    expect(envelope.errors[0]).toEqual({
      code: "USAGE",
      message: "error: missing required argument 'resource'",
    });
  });

  it("reports UNKNOWN_RESOURCE for a name not in the project, before probing Tilt", () => {
    const tmp = createTempProject({ resources: { api: containerService } });
    const res = runFlisk(["restart", "nope", "--json", "--port=59999"], tmp);
    expect(res.status).not.toBe(0);
    const envelope = JSON.parse(res.stdout);
    expect(envelope.errors[0]).toEqual({
      code: "UNKNOWN_RESOURCE",
      message: 'Resource "nope" not found in project.',
      suggestions: ["Resources: api", "See the names with: flisk resources"],
    });
  });

  it.each(["abc", "70000", "0", "-1"])("exits 2 when --port %s is invalid", (badPort) => {
    const tmp = createTempProject();
    const res = runFlisk(["restart", "api", "--port", badPort], tmp);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("--port must be a valid port number");

    const jsonRes = runFlisk(["restart", "api", "--port", badPort, "--json"], tmp);
    expect(jsonRes.status).toBe(2);
    const envelope = JSON.parse(jsonRes.stdout);
    expect(envelope.errors[0]).toEqual({
      code: "USAGE",
      message: "--port must be a valid port number",
    });
  });

  it.each(["abc", "70000"])("exits 2 when TILT_PORT=%s is invalid", (badPort) => {
    const tmp = createTempProject();
    const res = runFlisk(["restart", "api"], tmp, { TILT_PORT: badPort });
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("TILT_PORT must be a valid port number");

    const jsonRes = runFlisk(["restart", "api", "--json"], tmp, { TILT_PORT: badPort });
    expect(jsonRes.status).toBe(2);
    const envelope = JSON.parse(jsonRes.stdout);
    expect(envelope.errors[0]).toEqual({
      code: "USAGE",
      message: "TILT_PORT must be a valid port number",
    });
  });
});
