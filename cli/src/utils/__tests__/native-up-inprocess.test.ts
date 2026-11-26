// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createTempDir, makeResource } from "../../test-support/index.js";
import { canonicalCheckoutPath } from "../checkout-id.js";
import {
  api,
  ExitCalled,
  errors,
  expectUpBanner,
  flush,
  handlers,
  logs,
  occupant,
  registerNativeUpHarness,
  runtime,
  throwingExit,
  toolchain,
  UP_EMIT_PAYLOAD,
  warnings,
  web,
  writeServiceLog,
} from "./native-up-harness.js";

vi.mock("../native-runtime.js", (importOriginal) =>
  import("./native-up-harness.js").then((h) => h.nativeRuntimeModuleMock(importOriginal)),
);
vi.mock("../toolchain.js", (importOriginal) =>
  import("./native-up-harness.js").then((h) => h.toolchainModuleMock(importOriginal)),
);
vi.mock("../port-occupant.js", () =>
  import("./native-up-harness.js").then((h) => h.portOccupantModuleMock()),
);
vi.mock("../errors.js", (importOriginal) =>
  import("./native-up-harness.js").then((h) => h.errorsModuleMock(importOriginal)),
);

const {
  localDatabaseEnv,
  nativeUrlChecks,
  runNativeUp,
  runVariables,
  shadowedEnvKeys,
  withFailureLogs,
} = await import("../native-up.js");

registerNativeUpHarness();

describe("runVariables", () => {
  it("reads the project .env and lets the shell override it", () => {
    const root = createTempDir();
    writeFileSync(join(root, ".env"), "FLISK_NU_FILE_ONLY=from-file\nHOME=from-file\n");
    const vars = runVariables(root);
    expect(vars.FLISK_NU_FILE_ONLY).toBe("from-file");
    expect(vars.HOME).toBe(process.env.HOME);
  });

  it("uses an explicit env file and tolerates a missing one", () => {
    const root = createTempDir();
    writeFileSync(join(root, "custom.env"), "FLISK_NU_CUSTOM=yes\n");
    expect(runVariables(root, join(root, "custom.env")).FLISK_NU_CUSTOM).toBe("yes");
    expect(runVariables(root, join(root, "absent.env")).FLISK_NU_CUSTOM).toBeUndefined();
  });
});

describe("shadowedEnvKeys", () => {
  it("names the .env keys the shell overrides with another value, never the values", () => {
    const dir = createTempDir();
    writeFileSync(
      join(dir, ".env"),
      "NOTES_LIMIT=100\nAPI_TOKEN=secret-token\nSAME=1\nONLY_ENV=x\n",
    );
    const keys = shadowedEnvKeys(dir, undefined, {
      NOTES_LIMIT: "0",
      SAME: "1",
      API_TOKEN: "other",
    });
    expect(keys).toEqual(["API_TOKEN", "NOTES_LIMIT"]);
    expect(JSON.stringify(keys)).not.toContain("secret-token");
  });

  it("is empty with no .env or no override", () => {
    const dir = createTempDir();
    expect(shadowedEnvKeys(dir, undefined, { A: "1" })).toEqual([]);
    writeFileSync(join(dir, ".env"), "A=1\n");
    expect(shadowedEnvKeys(dir, undefined, {})).toEqual([]);
    expect(shadowedEnvKeys(dir, undefined, { A: "1" })).toEqual([]);
  });
});

describe("localDatabaseEnv", () => {
  it("clears the .env DATABASE_URL unless the service depends on a database (#4456)", () => {
    // A fresh project has no dependsOn, so the Docker host URL must not reach the local process.
    expect(localDatabaseEnv([])).toEqual({ DATABASE_URL: "" });
    // Depending on another service is not the same as depending on a database.
    expect(localDatabaseEnv(["api"])).toEqual({ DATABASE_URL: "" });
    // The shared Postgres aliases and a database resource's own name keep the URL.
    expect(localDatabaseEnv(["postgres"])).toEqual({});
    expect(localDatabaseEnv(["db"], ["db"])).toEqual({});
  });

  it("keeps a DATABASE_URL the service declares itself, even when its database is a plain command service", () => {
    const declared = { DATABASE_URL: "postgres://u@127.0.0.1:5432/notes" };
    expect(localDatabaseEnv(["db"], [], declared)).toEqual({});
    expect(localDatabaseEnv([], [], declared)).toEqual({});
  });

  it("still clears an empty or absent declaration, and never echoes the value (no secret leak)", () => {
    expect(localDatabaseEnv(["db"], [], { DATABASE_URL: "" })).toEqual({ DATABASE_URL: "" });
    expect(localDatabaseEnv(["db"], [], { OTHER: "x" })).toEqual({ DATABASE_URL: "" });
    expect(
      JSON.stringify(localDatabaseEnv([], [], { DATABASE_URL: "postgres://u:secret@h/d" })),
    ).not.toContain("secret");
  });
});

describe("localDatabaseEnv in a linked worktree (#4698)", () => {
  function worktree(withRecord: boolean): string {
    const dir = createTempDir();
    writeFileSync(join(dir, ".git"), "gitdir: /elsewhere/.git/worktrees/x\n");
    if (withRecord) {
      mkdirSync(join(dir, ".flisk"), { recursive: true });
      writeFileSync(
        join(dir, ".flisk", ".project-id"),
        `${JSON.stringify({ id: "deadbee5", path: canonicalCheckoutPath(dir) })}\n`,
      );
    }
    return dir;
  }

  it("keeps a custom URL whose database name merely ends with the checkout suffix", () => {
    const declared = { DATABASE_URL: "postgres://u:p@db.example.com/audit_deadbee5" };
    expect(localDatabaseEnv([], [], declared, worktree(true))).toEqual({});
  });

  it("scopes the generated shared-Postgres URL", () => {
    const declared = { DATABASE_URL: "postgresql://postgres:p@postgres:5432/app_dev" };
    expect(localDatabaseEnv(["postgres"], [], declared, worktree(true))).toEqual({
      DATABASE_URL: "postgresql://postgres:p@postgres:5432/app_dev_deadbee5",
      DATABASE_NAME: "app_dev_deadbee5",
    });
  });

  it("does not write the checkout identity record when persist is false", () => {
    const dir = worktree(false);
    const declared = { DATABASE_URL: "postgresql://postgres:p@postgres:5432/app_dev" };
    localDatabaseEnv(["postgres"], [], declared, dir, { persist: false });
    expect(existsSync(join(dir, ".flisk", ".project-id"))).toBe(false);
  });
});

describe("runNativeUp failures before anything starts", () => {
  it("fails on an invalid plan with INVALID_SERVICE_CONFIG", async () => {
    const emit = vi.fn();
    const broken = makeResource("api", "backend", {
      command: "node server.js",
      dependsOn: ["postgres"],
    });
    await expect(
      runNativeUp({
        projectRoot: createTempDir(),
        selected: [broken],
        dependencies: [],
        emit,
        exit: throwingExit,
      }),
    ).rejects.toMatchObject({ code: 1 });
    const [, issues] = emit.mock.calls[0];
    expect(issues[0].code).toBe("INVALID_SERVICE_CONFIG");
    expect(issues[0].message).toContain('dependsOn "postgres"');
    expect(errors.showError).toHaveBeenCalledWith(expect.stringContaining("postgres"));
  });

  it("fails on a binding toolchain mismatch but ignores hints", async () => {
    toolchain.findToolchainMismatches.mockReturnValue([
      { tool: "node", version: "18", source: "service.json", isHint: false, service: "api" },
      { tool: "bun", version: "1", source: ".tool-versions", isHint: true, service: "api" },
    ]);
    const emit = vi.fn();
    await expect(
      runNativeUp({
        projectRoot: createTempDir(),
        selected: [api],
        dependencies: [],
        emit,
        exit: throwingExit,
      }),
    ).rejects.toBeInstanceOf(ExitCalled);
    const [data, issues] = emit.mock.calls[0];
    expect(data).toEqual({ ok: false, runtime: "native" });
    expect(issues[0].code).toBe("TOOLCHAIN_MISMATCH");
    expect(issues[0].message).toContain('change "toolchain" in the service.json');
  });

  it("fails when a command's program is not installed", async () => {
    runtime.findMissingPrograms.mockReturnValue([{ name: "api", program: "uv" }]);
    const emit = vi.fn();
    await expect(
      runNativeUp({
        projectRoot: createTempDir(),
        selected: [api],
        dependencies: [],
        emit,
        exit: throwingExit,
      }),
    ).rejects.toBeInstanceOf(ExitCalled);
    const [data, issues] = emit.mock.calls[0];
    expect(issues[0]).toMatchObject({
      code: "NATIVE_COMMAND_NOT_FOUND",
      message:
        'service "api" runs uv, which is not installed (not found on PATH). Install it, or change "command" in its service.json.',
    });
    expect(data.failures).toEqual([
      {
        name: "api",
        reason:
          'service "api" runs uv, which is not installed (not found on PATH). Install it, or change "command" in its service.json.',
        exitCode: null,
        program: "uv",
        code: "PROGRAM_NOT_FOUND",
        suggestions: [
          "Install uv so it is on PATH, then run `flisk up`",
          "Run `flisk doctor` to check your machine",
        ],
      },
    ]);
    expect(issues[0].suggestions).toEqual(data.failures[0].suggestions);
  });

  it("reports a missing script program before starting the service (#4680)", async () => {
    runtime.findMissingPrograms.mockReturnValue([
      { name: "shop-api", program: "bun", script: "dev" },
    ]);
    const emit = vi.fn();
    await expect(
      runNativeUp({
        projectRoot: createTempDir(),
        selected: [api],
        dependencies: [],
        emit,
        exit: throwingExit,
      }),
    ).rejects.toBeInstanceOf(ExitCalled);
    expect(emit.mock.calls[0][1][0]).toMatchObject({
      code: "NATIVE_COMMAND_NOT_FOUND",
      message:
        'shop-api: script "dev" starts bun, which is not installed. Install bun (https://bun.sh/docs/installation), or change the script in its package.json.',
    });
    expect(emit.mock.calls[0][0].failures).toMatchObject([
      { name: "shop-api", exitCode: null, code: "PROGRAM_NOT_FOUND", program: "bun" },
    ]);
    expect(runtime.supervisorArgs).toHaveLength(0);
  });

  it("fails when a service port is taken, naming the occupant", async () => {
    runtime.isPortListening.mockImplementation(async (port: number) => port === 4100);
    occupant.findPortOccupant.mockReturnValue({ command: "nginx", pid: 77 });
    const emit = vi.fn();
    await expect(
      runNativeUp({
        projectRoot: createTempDir(),
        selected: [api],
        dependencies: [],
        emit,
        quiet: true,
        exit: throwingExit,
      }),
    ).rejects.toBeInstanceOf(ExitCalled);
    const [data, issues] = emit.mock.calls[0];
    expect(issues[0]).toMatchObject({
      code: "PORT_IN_USE",
      message:
        'Port 4100 for service "api" is already in use by nginx (pid 77). Stop it, or change "port" in the service.json.',
    });
    expect(data.failures).toEqual([
      {
        name: "api",
        reason:
          'Port 4100 for service "api" is already in use by nginx (pid 77). Stop it, or change "port" in the service.json.',
        exitCode: null,
        code: "PORT_IN_USE",
        suggestions: [
          "Run `flisk down` to stop this project's stack",
          "Free the port (or change `port` in service.json), then run `flisk up`",
        ],
      },
    ]);
    expect(runtime.supervisorArgs).toHaveLength(0);
  });

  it("reports a taken port without an occupant when none is found", async () => {
    runtime.isPortListening.mockResolvedValue(true);
    const emit = vi.fn();
    await expect(
      runNativeUp({
        projectRoot: createTempDir(),
        selected: [api],
        dependencies: [],
        emit,
        quiet: true,
        exit: throwingExit,
      }),
    ).rejects.toBeInstanceOf(ExitCalled);
    expect(emit.mock.calls[0][1][0].message).toBe(
      'Port 4100 for service "api" is already in use. Stop it, or change "port" in the service.json.',
    );
  });
});

describe("runNativeUp dry run", () => {
  it("prints the plan, warns about unset variables and emits the start order", async () => {
    const withVar = makeResource("api", "backend", {
      command: "node server.js",
      port: 4100,
      env: { TOKEN: ["$", "{", "FLISK_NU_SURELY_UNSET", "}"].join("") },
    });
    const emit = vi.fn();
    await runNativeUp({
      projectRoot: createTempDir(),
      selected: [withVar, web],
      dependencies: [],
      stackName: "core",
      dryRun: true,
      emit,
      exit: throwingExit,
    });
    expect(warnings.join("\n")).toContain("api: FLISK_NU_SURELY_UNSET");
    expect(logs[0]).toContain('Would start stack "core" as local processes');
    expect(logs).toContainEqual(expect.stringContaining("web: node web.js (after api)"));
    expect(logs).toContainEqual(expect.stringContaining("Dry run: not starting services"));
    expect(emit).toHaveBeenCalledWith({
      ok: true,
      dryRun: true,
      runtime: "native",
      stack: "core",
      services: ["api", "web"],
      startOrder: [["api"], ["web"]],
    });
    expect(runtime.supervisorArgs).toHaveLength(0);
  });

  it("describes a --only selection with its dependencies", async () => {
    const emit = vi.fn();
    await runNativeUp({
      projectRoot: createTempDir(),
      selected: [api, web],
      dependencies: ["api"],
      only: ["web"],
      dryRun: true,
      emit,
      exit: throwingExit,
    });
    expect(logs[0]).toContain("1 requested service plus api");
    expect(emit.mock.calls[0][0]).toMatchObject({
      stack: null,
      requested: ["web"],
      declaredDependencies: ["api"],
    });
  });

  it("counts services and prints nothing when quiet", async () => {
    await runNativeUp({
      projectRoot: createTempDir(),
      selected: [api],
      dependencies: [],
      dryRun: true,
      exit: throwingExit,
    });
    expect(logs[0]).toContain("Would start 1 service as local processes");
    logs.length = 0;
    await runNativeUp({
      projectRoot: createTempDir(),
      selected: [api],
      dependencies: [],
      dryRun: true,
      quiet: true,
      exit: throwingExit,
    });
    expect(logs).toEqual([]);
  });

  it("fails on a port taken by another program, naming the service and the fix", async () => {
    runtime.isPortListening.mockImplementation(async (port: number) => port === 4100);
    occupant.findPortOccupant.mockReturnValue({ command: "python3", pid: 56516 });
    const emit = vi.fn();
    await expect(
      runNativeUp({
        projectRoot: createTempDir(),
        selected: [api],
        dependencies: [],
        dryRun: true,
        emit,
        exit: throwingExit,
      }),
    ).rejects.toBeInstanceOf(ExitCalled);
    expect(emit.mock.calls[0][0]).toMatchObject({ ok: false, runtime: "native", dryRun: true });
    expect(emit.mock.calls[0][0].failures[0]).toMatchObject({ name: "api", code: "PORT_IN_USE" });
    expect(emit.mock.calls[0][1]).toEqual([
      {
        code: "PORT_IN_USE",
        suggestions: expect.any(Array),
        message:
          'Port 4100 for service "api" is already in use by python3 (pid 56516). Stop it, or change "port" in the service.json.',
      },
    ]);
    expect(logs.join("\n")).not.toContain("Dry run: not starting services");
    expect(runtime.supervisorArgs).toHaveLength(0);
  });

  it("fails on two services sharing a port, naming both and how to fix it", async () => {
    const other = makeResource("worker", "backend", { command: "node worker.js", port: 4100 });
    const emit = vi.fn();
    await expect(
      runNativeUp({
        projectRoot: createTempDir(),
        selected: [api, other],
        dependencies: [],
        dryRun: true,
        emit,
        exit: throwingExit,
      }),
    ).rejects.toBeInstanceOf(ExitCalled);
    const [data, issues] = emit.mock.calls[0] as [
      Record<string, unknown>,
      Array<{ code: string; message: string }>,
    ];
    expect(data).toEqual({ ok: false, runtime: "native", dryRun: true });
    expect(issues[0].code).toBe("INVALID_SERVICE_CONFIG");
    expect(issues[0].message).toContain('services "api" and "worker" both use port 4100');
    expect(issues[0].message).toContain('Fix: Give each service a different "port"');
  });

  it("fails on a missing start program, naming the service and the fix", async () => {
    runtime.findMissingPrograms.mockReturnValue([{ name: "api", program: "uv" }]);
    const emit = vi.fn();
    await expect(
      runNativeUp({
        projectRoot: createTempDir(),
        selected: [api],
        dependencies: [],
        dryRun: true,
        emit,
        exit: throwingExit,
      }),
    ).rejects.toBeInstanceOf(ExitCalled);
    expect(emit.mock.calls[0][1]).toEqual([
      {
        code: "NATIVE_COMMAND_NOT_FOUND",
        suggestions: expect.any(Array),
        message:
          'service "api" runs uv, which is not installed (not found on PATH). Install it, or change "command" in its service.json.',
      },
    ]);
  });

  it("keeps the unchanged plan and exit 0 when every preflight check passes", async () => {
    const emit = vi.fn();
    await runNativeUp({
      projectRoot: createTempDir(),
      selected: [api, web],
      dependencies: [],
      dryRun: true,
      emit,
      exit: throwingExit,
    });
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith({
      ok: true,
      dryRun: true,
      runtime: "native",
      stack: null,
      services: ["api", "web"],
      startOrder: [["api"], ["web"]],
    });
    expect(emit.mock.calls[0][1]).toBeUndefined();
  });
});

describe("runNativeUp with an existing run", () => {
  it("does not print the Starting banner or service list when a live run already owns the project (#4642)", async () => {
    runtime.readNativeRunState.mockReturnValue({ pid: 999_999 });
    runtime.isProcessAlive.mockReturnValue(true);
    const emit = vi.fn();
    await runNativeUp({
      projectRoot: createTempDir(),
      selected: [api, web],
      dependencies: [],
      emit,
      exit: throwingExit,
    });
    expect(emit).toHaveBeenCalledWith({
      ok: true,
      alreadyRunning: true,
      runtime: "native",
      pid: 999_999,
    });
    const printed = logs.join("\n");
    expect(printed).not.toContain("Starting");
    expect(printed).not.toContain("  - api:");
    expect(printed).not.toContain("  - web:");
    expect(printed).toContain("pid 999999");
    expect(printed).toContain("pass --force to restart it");
    expect(runtime.supervisorArgs).toHaveLength(0);
  });

  it("keeps dry-run output unchanged when a live run exists (#4642)", async () => {
    runtime.readNativeRunState.mockReturnValue({ pid: 999_999 });
    runtime.isProcessAlive.mockReturnValue(true);
    const emit = vi.fn();
    await runNativeUp({
      projectRoot: createTempDir(),
      selected: [api, web],
      dependencies: [],
      dryRun: true,
      emit,
      exit: throwingExit,
    });
    expect(logs[0]).toContain("Would start 2 services as local processes");
    expect(logs).toContainEqual(expect.stringContaining("web: node web.js (after api)"));
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ ok: true, dryRun: true }));
    expect(emit).not.toHaveBeenCalledWith(expect.objectContaining({ alreadyRunning: true }));
  });

  it("reports a live run and returns without starting a second one", async () => {
    runtime.readNativeRunState.mockReturnValue({ pid: 999_999 });
    runtime.isProcessAlive.mockReturnValue(true);
    const emit = vi.fn();
    await runNativeUp({
      projectRoot: createTempDir(),
      selected: [api],
      dependencies: [],
      emit,
      exit: throwingExit,
    });
    expect(emit).toHaveBeenCalledWith({
      ok: true,
      alreadyRunning: true,
      runtime: "native",
      pid: 999_999,
    });
    expect(logs).toContainEqual(expect.stringContaining("pid 999999"));
    expect(logs).toContainEqual(expect.stringContaining("pass --force to restart it"));
    expect(runtime.stopNativeRun).not.toHaveBeenCalled();
    expect(runtime.supervisorArgs).toHaveLength(0);
  });

  it("starts exactly one supervisor when two up calls start together (#3727)", async () => {
    const root = createTempDir();
    // Both calls share this process; the lock must still see the first one as live.
    runtime.isProcessAlive.mockImplementation((pid: number) => pid === process.pid);
    let finishStart: (failures: unknown[]) => void = () => {};
    runtime.supervisorStart.mockReturnValue(
      new Promise((resolve) => {
        finishStart = resolve;
      }),
    );
    const emitA = vi.fn();
    const emitB = vi.fn();
    const first = runNativeUp({
      projectRoot: root,
      selected: [api],
      dependencies: [],
      emit: emitA,
      quiet: true,
      exit: throwingExit,
    });
    const second = runNativeUp({
      projectRoot: root,
      selected: [api],
      dependencies: [],
      emit: emitB,
      quiet: true,
      exit: throwingExit,
    });
    await second;
    await flush();
    expect(runtime.supervisorArgs).toHaveLength(1);
    expect(runtime.supervisorStart).toHaveBeenCalledTimes(1);
    const answers = [...emitA.mock.calls, ...emitB.mock.calls].map(
      ([data]) => data as Record<string, unknown>,
    );
    expect(answers.filter((data) => data.alreadyRunning === true)).toEqual([
      { ok: true, alreadyRunning: true, runtime: "native", pid: process.pid },
    ]);

    const lockPath = join(root, ".flisk", "native", "up.lock");
    expect(existsSync(lockPath)).toBe(true);
    finishStart([]);
    await flush();
    expect(existsSync(lockPath)).toBe(false);
    void first; // A successful up keeps its services alive; it never settles in the test.
  });

  it("answers alreadyRunning for a live up lock even before run state exists (#3727)", async () => {
    const root = createTempDir();
    const lockPath = join(root, ".flisk", "native", "up.lock");
    mkdirSync(join(root, ".flisk", "native"), { recursive: true });
    writeFileSync(lockPath, "424242\n");
    runtime.isProcessAlive.mockImplementation((pid: number) => pid === 424242);
    const emit = vi.fn();
    await runNativeUp({
      projectRoot: root,
      selected: [api],
      dependencies: [],
      emit,
      quiet: true,
      exit: throwingExit,
    });
    expect(emit).toHaveBeenCalledWith({
      ok: true,
      alreadyRunning: true,
      runtime: "native",
      pid: 424242,
    });
    expect(runtime.supervisorArgs).toHaveLength(0);
    expect(existsSync(lockPath)).toBe(true); // Another process's lock is left alone.
  });

  it("removes a stale up lock whose pid is dead and starts (#3727)", async () => {
    const root = createTempDir();
    const lockPath = join(root, ".flisk", "native", "up.lock");
    mkdirSync(join(root, ".flisk", "native"), { recursive: true });
    writeFileSync(lockPath, "999999\n");
    runtime.isProcessAlive.mockReturnValue(false);
    const emit = vi.fn();
    void runNativeUp({
      projectRoot: root,
      selected: [api],
      dependencies: [],
      emit,
      quiet: true,
      exit: throwingExit,
    });
    await flush();
    expect(runtime.supervisorArgs).toHaveLength(1);
    expect(emit.mock.calls[0][0]).toMatchObject({ ok: true });
    expect(emit).not.toHaveBeenCalledWith(expect.objectContaining({ alreadyRunning: true }));
  });

  it("stops the previous run under --force before starting", async () => {
    runtime.readNativeRunState.mockReturnValue({ pid: 999_999 });
    runtime.isProcessAlive.mockReturnValue(true);
    runtime.supervisorStart.mockResolvedValue([{ name: "api", reason: "exited with code 1" }]);
    const root = createTempDir();
    const exit = vi.fn();
    await runNativeUp({
      projectRoot: root,
      selected: [api],
      dependencies: [],
      force: true,
      quiet: true,
      exit: exit as unknown as (code: number) => never,
    });
    expect(runtime.stopNativeRun).toHaveBeenCalledWith(root);
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe("withFailureLogs", () => {
  it("adds the last five lines the failed service wrote and leaves a silent one alone", () => {
    const root = createTempDir();
    writeServiceLog(root, "api", [
      "one",
      "two",
      "FATAL: DATABASE_URL is not set",
      "four",
      "five",
      "six",
      "seven",
    ]);
    const failures = withFailureLogs(root, [
      { name: "api", reason: "kept exiting; see its output above" },
      { name: "web", reason: "not started: api did not start" },
    ]);
    expect(failures[0]).toEqual({
      name: "api",
      reason: "kept exiting; see its output above",
      logs: ["FATAL: DATABASE_URL is not set", "four", "five", "six", "seven"],
    });
    // No log file: the failure is exactly what the supervisor reported.
    expect(failures[1]).toEqual({ name: "web", reason: "not started: api did not start" });
  });

  it("folds a crash loop's repeated line so the cause and what came before both show", () => {
    const root = createTempDir();
    writeServiceLog(root, "api", [
      "listening soon",
      ...Array.from({ length: 6 }, () => "FATAL: DATABASE_URL is not set"),
    ]);
    const [failure] = withFailureLogs(root, [{ name: "api", reason: "kept exiting" }]);
    expect(failure?.logs).toEqual(["listening soon", "FATAL: DATABASE_URL is not set (x6)"]);
  });

  it("leaves out lines an earlier run wrote when given the time this run started", () => {
    const root = createTempDir();
    const dir = join(root, ".flisk", "native", "logs");
    mkdirSync(dir, { recursive: true });
    const old = new Date(Date.now() - 3_600_000).toISOString();
    const fresh = new Date().toISOString();
    writeFileSync(
      join(dir, "api.log"),
      `${old} FATAL: DATABASE_URL is not set\n${fresh} FATAL: STRIPE_KEY is not set\n`,
    );
    const [failure] = withFailureLogs(
      root,
      [{ name: "api", reason: "kept exiting" }],
      Date.now() - 60_000,
    );
    expect(failure?.logs).toEqual(["FATAL: STRIPE_KEY is not set"]);
  });

  it("cuts a very long line and skips blank ones", () => {
    const root = createTempDir();
    writeServiceLog(root, "api", ["   ", "x".repeat(900)]);
    const [failure] = withFailureLogs(root, [{ name: "api", reason: "boom" }]);
    expect(failure?.logs).toHaveLength(1);
    expect(failure?.logs?.[0]).toHaveLength(400);
    expect(failure?.logs?.[0]?.endsWith("…")).toBe(true);
  });
});

describe("runNativeUp checkout-local ports (#4047)", () => {
  it("remaps a busy port under a per-checkout name, injects PORT and emits the real URLs", async () => {
    const root = createTempDir();
    const checkoutApi = makeResource("api", "backend", {
      command: "node server.js",
      port: 4100,
      healthCheckPath: "/health",
    });
    const checkoutWeb = makeResource("web", "frontend", {
      command: "node web.js",
      port: 4200,
      dependsOn: ["api"],
      env: { API_URL: "http://localhost:4100/api" },
    });
    runtime.isPortListening.mockImplementation(async (port: number) => port === 4100);
    const emit = vi.fn();
    void runNativeUp({
      projectRoot: root,
      selected: [checkoutApi, checkoutWeb],
      dependencies: ["api"],
      checkoutName: "agent-two",
      isPortAvailable: async (port: number) => port !== 4100,
      emit,
      quiet: true,
      exit: vi.fn() as unknown as (code: number) => never,
    });
    await flush();

    const [data] = emit.mock.calls[0];
    expect(data.urls).toEqual([
      { service: "api", url: "http://localhost:4101", didAnswer: true, status: 200 },
      { service: "web", url: "http://localhost:4200", didAnswer: true, status: 200 },
    ]);
    const plans = runtime.supervisorArgs[0][1] as Array<{
      name: string;
      port?: number;
      env: Record<string, string>;
      healthUrl?: string;
    }>;
    expect(plans[0]).toMatchObject({
      name: "api",
      port: 4101,
      healthUrl: "http://localhost:4101/health",
    });
    expect(plans[0].env.PORT).toBe("4101");
    expect(plans[1].env.API_URL).toBe("http://localhost:4101/api");
    expect(logs.join("\n")).not.toContain('change "port" in the service.json');
  });

  it("fails loudly on a busy port when no checkout name is given", async () => {
    runtime.isPortListening.mockImplementation(async (port: number) => port === 4100);
    const emit = vi.fn();
    await expect(
      runNativeUp({
        projectRoot: createTempDir(),
        selected: [api],
        dependencies: [],
        checkoutName: undefined,
        emit,
        quiet: true,
        exit: throwingExit,
      }),
    ).rejects.toBeInstanceOf(ExitCalled);
    expect(emit.mock.calls[0][1][0]).toMatchObject({
      code: "PORT_IN_USE",
      message:
        'Port 4100 for service "api" is already in use. Stop it, or change "port" in the service.json.',
    });
    expect(runtime.supervisorArgs).toHaveLength(0);
  });
});

describe("runNativeUp start", () => {
  it("reports services that did not start, stops the rest and exits 1", async () => {
    runtime.supervisorStart.mockResolvedValue([{ name: "api", reason: "health check timed out" }]);
    const emit = vi.fn();
    const exit = vi.fn();
    await runNativeUp({
      projectRoot: createTempDir(),
      selected: [api],
      dependencies: [],
      emit,
      quiet: true,
      exit: exit as unknown as (code: number) => never,
    });
    const [data, issues] = emit.mock.calls[0];
    expect(data).toMatchObject({
      ok: false,
      runtime: "native",
      failures: [
        {
          name: "api",
          reason: "health check timed out",
          exitCode: null,
          code: "HEALTHCHECK_FAILED",
          suggestions: expect.arrayContaining([
            expect.stringContaining("flisk logs --service api"),
          ]),
        },
      ],
    });
    expect(issues[0].code).toBe("UP_RESOURCE_FAILED");
    expect(issues[0].message).toContain("✗ api: health check timed out");
    expect(issues[0].message).toContain(join(".flisk", "native", "logs"));
    expect(runtime.supervisorStop).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("carries the failed service's own last lines in the JSON result and its message", async () => {
    const root = createTempDir();
    writeServiceLog(root, "api", [
      "booting",
      "FATAL: DATABASE_URL is not set; the api cannot start",
    ]);
    runtime.supervisorStart.mockResolvedValue([
      { name: "api", reason: "kept exiting; see its output above" },
      { name: "web", reason: "not started: api did not start" },
    ]);
    const emit = vi.fn();
    await runNativeUp({
      projectRoot: root,
      selected: [api],
      dependencies: [],
      emit,
      quiet: true,
      exit: vi.fn() as unknown as (code: number) => never,
    });
    const [data, issues] = emit.mock.calls[0];
    expect(data.failures[0].logs).toEqual([
      "booting",
      "FATAL: DATABASE_URL is not set; the api cannot start",
    ]);
    expect(data.failures[1]).not.toHaveProperty("logs");
    expect(issues[0].message).toContain("✗ api: kept exiting");
    expect(JSON.stringify(data.failures)).not.toContain("above");
    expect(issues[0].message).toContain(
      "      FATAL: DATABASE_URL is not set; the api cannot start",
    );
  });

  it("classifies exit code 127 as a missing program and names it", async () => {
    const root = createTempDir();
    writeServiceLog(root, "api", ["> bun run --watch src/index.ts", "sh: bun: command not found"]);
    runtime.supervisorStart.mockResolvedValue([
      { name: "api", reason: "kept exiting", exitCode: 127 },
    ]);
    const emit = vi.fn();
    await runNativeUp({
      projectRoot: root,
      selected: [api],
      dependencies: [],
      emit,
      quiet: true,
      exit: vi.fn() as unknown as (code: number) => never,
    });
    const [data] = emit.mock.calls[0];
    expect(data.failures[0]).toMatchObject({
      name: "api",
      exitCode: 127,
      code: "PROGRAM_NOT_FOUND",
      program: "bun",
      reason: expect.stringContaining("bun"),
      suggestions: [
        "Install bun so it is on PATH, then run `flisk up`",
        "Run `flisk doctor` to check your machine",
      ],
    });
    expect(JSON.stringify(data.failures)).not.toContain("above");
  });

  it("classifies a crash loop and a blocked dependent separately", async () => {
    runtime.supervisorStart.mockResolvedValue([
      { name: "api", reason: "kept exiting", exitCode: 1 },
      { name: "web", reason: "not started: api did not start", exitCode: null },
    ]);
    const emit = vi.fn();
    await runNativeUp({
      projectRoot: createTempDir(),
      selected: [api],
      dependencies: [],
      emit,
      quiet: true,
      exit: vi.fn() as unknown as (code: number) => never,
    });
    const [data] = emit.mock.calls[0];
    expect(data.failures.map((failure: { code: string }) => failure.code)).toEqual([
      "CRASH_LOOP",
      "DEPENDENCY_FAILED",
    ]);
    expect(data.failures[1].exitCode).toBeNull();
  });

  it("leaves generated files unchanged when startup fails", async () => {
    const root = createTempDir();
    for (const file of [
      ".flisk/.flisk-out/Tiltfile",
      ".flisk/.flisk-out/spec.master",
      "services/api/.autogenerated/docker-compose.yml",
    ]) {
      const path = join(root, file);
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, `# generated ${file}\n`);
    }
    const hashGenerated = () => {
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const path = join(dir, entry.name);
          if (entry.isDirectory()) walk(path);
          else if (entry.isFile()) files.push(path);
        }
      };
      walk(join(root, ".flisk", ".flisk-out"));
      walk(join(root, "services"));
      return createHash("sha256")
        .update(
          files
            .sort()
            .map((path) => `${path}:${statSync(path).size}:${readFileSync(path, "utf8")}`)
            .join("\n"),
        )
        .digest("hex");
    };
    const before = hashGenerated();
    runtime.findMissingPrograms.mockReturnValue([{ name: "api", program: "bun" }]);
    await expect(
      runNativeUp({
        projectRoot: root,
        selected: [api],
        dependencies: [],
        exit: throwingExit,
      }),
    ).rejects.toBeInstanceOf(ExitCalled);
    expect(hashGenerated()).toBe(before);
  });

  it("does not repeat the lines in the message when they were printed live", async () => {
    const root = createTempDir();
    writeServiceLog(root, "api", ["FATAL: DATABASE_URL is not set"]);
    runtime.supervisorStart.mockResolvedValue([{ name: "api", reason: "kept exiting" }]);
    const emit = vi.fn();
    await runNativeUp({
      projectRoot: root,
      selected: [api],
      dependencies: [],
      emit,
      exit: vi.fn() as unknown as (code: number) => never,
    });
    const [data, issues] = emit.mock.calls[0];
    expect(data.failures[0].logs).toEqual(["FATAL: DATABASE_URL is not set"]);
    expect(issues[0].message).not.toContain("FATAL");
  });

  it("prints the URLs once every service is up, then stays running", async () => {
    const root = createTempDir();
    const healthy = makeResource("api", "backend", {
      command: "node server.js",
      port: 4100,
      healthCheck: { path: "/health" },
    });
    const emit = vi.fn();
    const exit = vi.fn();
    let settled = false;
    void runNativeUp({
      projectRoot: root,
      selected: [healthy, web],
      dependencies: ["api"],
      only: ["web"],
      emit,
      readyTimeoutMs: 1234,
      exit: exit as unknown as (code: number) => never,
    }).then(() => {
      settled = true;
    });
    await flush();
    expect(emit).toHaveBeenCalledWith(UP_EMIT_PAYLOAD);
    const output = logs.join("\n");
    expectUpBanner(output);
    expect(output).toContain(
      "✓ api → http://localhost:4100 (health: http://localhost:4100/health)",
    );
    expect(settled).toBe(false);

    // The supervisor gets the run variables and the ready timeout, and prefixes service output.
    const [projectRoot, plans, events, options] = runtime.supervisorArgs[0] as [
      string,
      Array<{ name: string }>,
      {
        onLine?: (name: string, line: string) => void;
        onNote?: (name: string, msg: string) => void;
      },
      { readyTimeoutMs?: number; baseEnv?: Record<string, string> },
    ];
    expect(projectRoot).toBe(root);
    expect(plans.map((plan) => plan.name)).toEqual(["api", "web"]);
    expect(options.readyTimeoutMs).toBe(1234);
    expect(options.baseEnv?.HOME).toBe(process.env.HOME);
    logs.length = 0;
    events.onLine?.("web", "listening");
    events.onNote?.("api", "ready");
    expect(logs[0]).toContain("web");
    expect(logs[0]).toContain("listening");
    expect(logs[1]).toContain("[flisk] ready");

    // Ctrl+C stops the supervisor once and exits 0, however many signals arrive.
    expect([...handlers.keys()]).toEqual(
      expect.arrayContaining(["SIGINT", "SIGTERM", "SIGHUP", "exit"]),
    );
    handlers.get("SIGINT")?.();
    handlers.get("SIGTERM")?.();
    await flush();
    expect(runtime.supervisorStop).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    expect(logs).toContainEqual(expect.stringContaining("Stopping local processes..."));
  });

  it("prints (finished) instead of a URL for a one-shot that already finished (#5120)", async () => {
    const root = createTempDir();
    const once = makeResource("once", "worker", {
      command: 'sh -c "echo done-once"',
      port: 4100,
      restart: "no",
    });
    // A real run.json records a finished one-shot: ready with no live process, under this run's supervisor pid.
    // (nativeServiceStates reads the file itself, so the module mocks cannot stand in for it.)
    mkdirSync(join(root, ".flisk", "native"), { recursive: true });
    writeFileSync(
      join(root, ".flisk", "native", "run.json"),
      JSON.stringify({
        pid: process.pid,
        startedAt: new Date().toISOString(),
        services: {
          once: { pid: 999999999, ready: true, port: 4100, url: "http://localhost:4100" },
        },
      }),
    );
    const emit = vi.fn();
    let settled = false;
    void runNativeUp({
      projectRoot: root,
      selected: [once],
      dependencies: [],
      emit,
      exit: vi.fn() as unknown as (code: number) => never,
    }).then(() => {
      settled = true;
    });
    await flush();
    expect(emit).toHaveBeenCalledWith({
      ok: true,
      runtime: "native",
      stack: null,
      services: ["once"],
      urls: [{ service: "once", url: "http://localhost:4100", didAnswer: true, status: 200 }],
    });
    const output = logs.join("\n");
    expect(output).toContain("✓ once (finished)");
    expect(output).not.toContain("✓ once → http://localhost:4100");
    expect(settled).toBe(false);
  });

  it("passes no output callbacks when quiet and removes its own run.json on exit", async () => {
    const root = createTempDir();
    const statePath = join(root, "run.json");
    writeFileSync(statePath, "{}");
    runtime.nativeRunStatePath.mockReturnValue(statePath);
    const emit = vi.fn();
    void runNativeUp({
      projectRoot: root,
      selected: [api],
      dependencies: [],
      stackName: "core",
      emit,
      quiet: true,
      exit: vi.fn() as unknown as (code: number) => never,
    });
    await flush();
    expect(emit.mock.calls[0][0]).toMatchObject({ ok: true, stack: "core", services: ["api"] });
    expect(logs).toEqual([]);
    const events = runtime.supervisorArgs[0][2] as Record<string, unknown>;
    expect(events.onLine).toBeUndefined();
    expect(events.onNote).toBeUndefined();

    // Another process's run.json is left alone.
    runtime.readNativeRunState.mockReturnValue({ pid: process.pid + 1 });
    handlers.get("exit")?.();
    expect(existsSync(statePath)).toBe(true);
    runtime.readNativeRunState.mockReturnValue({ pid: process.pid });
    handlers.get("exit")?.();
    expect(existsSync(statePath)).toBe(false);
  });

  it("does not report failures when it is stopped while starting", async () => {
    let finishStart: (failures: unknown[]) => void = () => {};
    runtime.supervisorStart.mockReturnValue(
      new Promise((resolve) => {
        finishStart = resolve;
      }),
    );
    const emit = vi.fn();
    const exit = vi.fn();
    const run = runNativeUp({
      projectRoot: createTempDir(),
      selected: [api],
      dependencies: [],
      emit,
      quiet: true,
      exit: exit as unknown as (code: number) => never,
    });
    await flush();
    handlers.get("SIGTERM")?.();
    finishStart([{ name: "api", reason: "killed" }]);
    await run;
    expect(emit).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("pins native urls to the {service, url, didAnswer, status} array shape (swarm and recorded statuses)", async () => {
    expect(
      nativeUrlChecks(
        [
          { name: "coordinator", url: "http://localhost:4100" },
          { name: "worker-1", url: "http://localhost:4101" },
          { name: "job-only", url: undefined },
        ],
        new Map([["worker-1", 204]]),
      ),
    ).toEqual([
      { service: "coordinator", url: "http://localhost:4100", didAnswer: true, status: 200 },
      { service: "worker-1", url: "http://localhost:4101", didAnswer: true, status: 204 },
    ]);

    const swarmServices = [
      makeResource("coordinator", "backend", {
        command: "node server.mjs",
        port: 4100,
        healthCheckPath: "/health",
      }),
      makeResource("worker-1", "worker", {
        command: "node ../worker/server.mjs",
        port: 4101,
        healthCheckPath: "/health",
      }),
      makeResource("worker-2", "worker", {
        command: "node ../worker/server.mjs",
        port: 4102,
        healthCheckPath: "/health",
      }),
      makeResource("worker-3", "worker", {
        command: "node ../worker/server.mjs",
        port: 4103,
        healthCheckPath: "/health",
      }),
    ];
    const emit = vi.fn();
    void runNativeUp({
      projectRoot: createTempDir(),
      selected: swarmServices,
      dependencies: [],
      emit,
      quiet: true,
      exit: vi.fn() as unknown as (code: number) => never,
    });
    await flush();

    expect(emit).toHaveBeenCalledWith({
      ok: true,
      runtime: "native",
      stack: null,
      services: ["coordinator", "worker-1", "worker-2", "worker-3"],
      urls: [
        { service: "coordinator", url: "http://localhost:4100", didAnswer: true, status: 200 },
        { service: "worker-1", url: "http://localhost:4101", didAnswer: true, status: 200 },
        { service: "worker-2", url: "http://localhost:4102", didAnswer: true, status: 200 },
        { service: "worker-3", url: "http://localhost:4103", didAnswer: true, status: 200 },
      ],
    });
  });
});
