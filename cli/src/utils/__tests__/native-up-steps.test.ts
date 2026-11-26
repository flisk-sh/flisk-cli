// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTempDir, makeResource } from "../../test-support/index.js";
import {
  api,
  docker,
  doctorDeps,
  ExitCalled,
  errors,
  expectUpBanner,
  flush,
  handlers,
  logs,
  occupant,
  registerNativeUpHarness,
  runtime,
  secrets,
  throwingExit,
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
vi.mock("../generated-secrets.js", (importOriginal) =>
  import("./native-up-harness.js").then((h) => h.generatedSecretsModuleMock(importOriginal)),
);
vi.mock("../doctor-local-deps.js", (importOriginal) =>
  import("./native-up-harness.js").then((h) => h.doctorDepsModuleMock(importOriginal)),
);
vi.mock("../native-container.js", (importOriginal) =>
  import("./native-up-harness.js").then((h) => h.nativeContainerModuleMock(importOriginal)),
);

const {
  createNativeUpRun,
  nativeUpBanner,
  nativeUpDryRun,
  nativeUpEnv,
  nativeUpExistingRun,
  nativeUpGuards,
  nativeUpPlan,
  nativeUpRunRecord,
  nativeUpRuntimePreflight,
  nativeUpSecrets,
  nativeUpStart,
  nativeUpStaticPreflight,
  nativeUpSteps,
  nativeUpSupervisor,
} = await import("../native-up.js");

registerNativeUpHarness([
  secrets.ensureGeneratedSecrets,
  doctorDeps.worktreeEnvHintMessage,
  docker.isDockerRunning,
]);
beforeEach(() => {
  secrets.ensureGeneratedSecrets.mockReturnValue([]);
  doctorDeps.worktreeEnvHintMessage.mockReturnValue(null);
  docker.isDockerRunning.mockReturnValue(true);
});

const runFor = (input: Partial<Parameters<typeof createNativeUpRun>[0]> = {}) =>
  createNativeUpRun({
    projectRoot: createTempDir(),
    selected: [api, web],
    dependencies: [],
    exit: throwingExit,
    ...input,
  });

describe("nativeUpSteps", () => {
  it("lists the native up phases in order", () => {
    expect(nativeUpSteps.map((step) => step.name)).toEqual([
      "secrets",
      "env",
      "plan",
      "static-preflight",
      "existing-run",
      "banner",
      "dry-run",
      "runtime-preflight",
      "run-databases",
      "supervisor",
      "guards",
      "start",
    ]);
  });

  it("gates the existing-run check and the real-start phases out of a dry run", () => {
    const dry = runFor({ dryRun: true });
    const real = runFor();
    const guardOf = (name: string) =>
      nativeUpSteps.find((step) => step.name === name)?.guard ?? (() => true);
    for (const name of [
      "existing-run",
      "runtime-preflight",
      "run-databases",
      "supervisor",
      "guards",
      "start",
    ]) {
      expect(guardOf(name)(dry)).toBe(false);
      expect(guardOf(name)(real)).toBe(true);
    }
    expect(guardOf("dry-run")(dry)).toBe(true);
    expect(guardOf("dry-run")(real)).toBe(false);
  });
});

describe("createNativeUpRun", () => {
  it("starts empty and unfinished, with the input's exit and quiet", () => {
    const run = runFor({ quiet: true });
    expect(run.finished).toBe(false);
    expect(run.quiet).toBe(true);
    expect(run.vars).toEqual({});
    expect(run.plan).toEqual({ services: [], errors: [], missingVars: [], missingEnvRefs: [] });
    expect(run.serviceNames).toEqual([]);
    expect(run.containers).toEqual([]);
    expect(run.stopping).toBeUndefined();
  });

  it("failProblems emits the envelope, shows the messages, exits 1 and marks the run finished", () => {
    const emit = vi.fn();
    const run = runFor({ emit });
    expect(() =>
      run.failProblems(
        [{ code: "PORT_IN_USE", message: "port 4100 taken", suggestions: ["stop it"] }],
        { dryRun: true },
      ),
    ).toThrow(ExitCalled);
    expect(run.finished).toBe(true);
    expect(emit).toHaveBeenCalledWith({ ok: false, runtime: "native", dryRun: true }, [
      { code: "PORT_IN_USE", message: "port 4100 taken", suggestions: ["stop it"] },
    ]);
    expect(errors.showError).toHaveBeenCalledWith("port 4100 taken");
  });

  it("fail reports a single coded problem", () => {
    const emit = vi.fn();
    const run = runFor({ emit });
    expect(() => run.fail("DOCKER_NOT_RUNNING", "docker is down")).toThrow(ExitCalled);
    expect(emit.mock.calls[0][1]).toEqual([
      { code: "DOCKER_NOT_RUNNING", message: "docker is down" },
    ]);
  });
});

describe("nativeUpSecrets", () => {
  it("reports the names written into the env file, once", () => {
    secrets.ensureGeneratedSecrets.mockReturnValue(["API_KEY", "DB_PASSWORD"]);
    const root = createTempDir();
    const envFile = join(root, "custom.env");
    const run = runFor({ projectRoot: root, envFilePath: envFile });
    nativeUpSecrets(run);
    expect(secrets.ensureGeneratedSecrets).toHaveBeenCalledWith(root, [api, web], {
      envFilePath: envFile,
      dryRun: undefined,
    });
    expect(logs.join("\n")).toContain(
      "Generated API_KEY, DB_PASSWORD into the env file (once; existing values unchanged)",
    );
  });

  it("prints nothing when quiet, in a dry run, or when nothing was generated", () => {
    secrets.ensureGeneratedSecrets.mockReturnValue(["API_KEY"]);
    nativeUpSecrets(runFor({ dryRun: true }));
    nativeUpSecrets(runFor({ quiet: true }));
    secrets.ensureGeneratedSecrets.mockReturnValue([]);
    nativeUpSecrets(runFor());
    expect(logs).toEqual([]);
  });
});

describe("nativeUpEnv", () => {
  it("reads the env file of the run with the shell overriding it", () => {
    const root = createTempDir();
    writeFileSync(join(root, ".env"), "FLISK_STEP_FILE=from-file\nHOME=from-file\n");
    const run = runFor({ projectRoot: root });
    nativeUpEnv(run);
    expect(run.vars.FLISK_STEP_FILE).toBe("from-file");
    expect(run.vars.HOME).toBe(process.env.HOME);
  });

  it("warns with the worktree hint when the project has no .env and no --env-file", () => {
    const root = createTempDir();
    doctorDeps.worktreeEnvHintMessage.mockReturnValue("copy ../main/.env to get started");
    const run = runFor({ projectRoot: root });
    nativeUpEnv(run);
    expect(warnings.join("\n")).toContain("copy ../main/.env to get started");
  });

  it("never asks for the hint with --env-file, with an .env, or when quiet", () => {
    const root = createTempDir();
    nativeUpEnv(runFor({ projectRoot: root, envFilePath: join(root, "x.env") }));
    writeFileSync(join(root, ".env"), "A=1\n");
    nativeUpEnv(runFor({ projectRoot: root }));
    const quietRoot = createTempDir();
    nativeUpEnv(runFor({ projectRoot: quietRoot, quiet: true }));
    expect(doctorDeps.worktreeEnvHintMessage).not.toHaveBeenCalled();
    expect(warnings).toEqual([]);
  });
});

describe("nativeUpPlan", () => {
  it("plans the services, blanks DATABASE_URL outside database dependents and fills the views", () => {
    const run = runFor();
    nativeUpPlan(run);
    expect(run.serviceNames).toEqual(["api", "web"]);
    expect(run.containers).toEqual([]);
    expect(run.plan.services.map((service) => service.env.DATABASE_URL)).toEqual(["", ""]);
    expect(run.databaseNames).toEqual([]);
  });

  it("collects image services into containers", () => {
    const db = makeResource("db", "database", { image: "postgres:16" });
    const withDb = makeResource("api", "backend", {
      command: "node server.js",
      port: 4100,
      dependsOn: ["db"],
    });
    const run = runFor({ selected: [db, withDb] });
    nativeUpPlan(run);
    expect(run.containers.map((service) => service.name)).toEqual(["db"]);
    expect(run.databaseNames).toEqual(["db"]);
    // The API depends on its database, so its DATABASE_URL is kept, not blanked.
    expect(
      run.plan.services.find((service) => service.name === "api")?.env.DATABASE_URL,
    ).toBeUndefined();
  });

  it("warns about variables that expanded to nothing", () => {
    const withVar = makeResource("api", "backend", {
      command: "node server.js",
      env: { TOKEN: ["$", "{", "FLISK_STEP_UNSET", "}"].join("") },
    });
    const run = runFor({ selected: [withVar] });
    nativeUpPlan(run);
    expect(warnings.join("\n")).toContain("api: FLISK_STEP_UNSET");
  });
});

describe("nativeUpStaticPreflight", () => {
  it("fails on a broken plan with INVALID_SERVICE_CONFIG, tagged for a dry run", () => {
    const broken = makeResource("api", "backend", {
      command: "node server.js",
      dependsOn: ["postgres"],
    });
    const emit = vi.fn();
    const run = runFor({ selected: [broken], emit, dryRun: true });
    nativeUpPlan(run);
    expect(() => nativeUpStaticPreflight(run)).toThrow(ExitCalled);
    const [data, issues] = emit.mock.calls[0];
    expect(data).toEqual({ ok: false, runtime: "native", dryRun: true });
    expect(issues[0].code).toBe("INVALID_SERVICE_CONFIG");
  });

  it("passes a clean plan without emitting", () => {
    const emit = vi.fn();
    const run = runFor({ emit });
    nativeUpPlan(run);
    nativeUpStaticPreflight(run);
    expect(run.finished).toBe(false);
    expect(emit).not.toHaveBeenCalled();
  });
});

describe("nativeUpExistingRun", () => {
  it("reports a live run, marks the run finished and starts nothing", async () => {
    runtime.readNativeRunState.mockReturnValue({ pid: 999_999 });
    runtime.isProcessAlive.mockReturnValue(true);
    const emit = vi.fn();
    const run = runFor({ emit });
    await nativeUpExistingRun(run);
    expect(emit).toHaveBeenCalledWith({
      ok: true,
      alreadyRunning: true,
      runtime: "native",
      pid: 999_999,
    });
    expect(logs.join("\n")).toContain("pid 999999");
    expect(run.finished).toBe(true);
    expect(runtime.stopNativeRun).not.toHaveBeenCalled();
  });

  it("stops the old run under --force, and a stale one without it", async () => {
    runtime.readNativeRunState.mockReturnValue({ pid: 999_999 });
    runtime.isProcessAlive.mockReturnValue(true);
    const forced = runFor({ force: true });
    await nativeUpExistingRun(forced);
    expect(runtime.stopNativeRun).toHaveBeenCalledWith(forced.input.projectRoot);
    expect(forced.finished).toBe(false);

    runtime.stopNativeRun.mockClear();
    runtime.isProcessAlive.mockReturnValue(false);
    const stale = runFor();
    await nativeUpExistingRun(stale);
    expect(runtime.stopNativeRun).toHaveBeenCalledWith(stale.input.projectRoot);
    expect(stale.finished).toBe(false);
  });

  it("does nothing when no run state exists", async () => {
    const run = runFor();
    await nativeUpExistingRun(run);
    expect(run.finished).toBe(false);
    expect(runtime.stopNativeRun).not.toHaveBeenCalled();
  });
});

describe("nativeUpBanner", () => {
  it("prints the banner and the service list, and fills startOrder", () => {
    const run = runFor({ stackName: "core" });
    nativeUpPlan(run);
    nativeUpBanner(run);
    expect(run.startOrder).toEqual([["api"], ["web"]]);
    expect(logs[0]).toContain('Starting stack "core" as local processes (no Docker, no Tilt)');
    expect(logs).toContainEqual(expect.stringContaining("web: node web.js (after api)"));
  });

  it("says Would start for a dry run, and describes an --only selection", () => {
    const run = runFor({ dryRun: true, only: ["web"], dependencies: ["api"] });
    nativeUpPlan(run);
    nativeUpBanner(run);
    expect(logs[0]).toContain("Would start 1 requested service plus api");
  });

  it("prints nothing when quiet but still fills startOrder", () => {
    const run = runFor({ quiet: true });
    nativeUpPlan(run);
    nativeUpBanner(run);
    expect(logs).toEqual([]);
    expect(run.startOrder).toEqual([["api"], ["web"]]);
  });
});

describe("nativeUpDryRun", () => {
  it("emits the plan, says nothing starts and ends the run", async () => {
    const emit = vi.fn();
    const run = runFor({ emit, dryRun: true, stackName: "core" });
    nativeUpPlan(run);
    nativeUpBanner(run);
    await nativeUpDryRun(run);
    expect(emit).toHaveBeenCalledWith({
      ok: true,
      dryRun: true,
      runtime: "native",
      stack: "core",
      services: ["api", "web"],
      startOrder: [["api"], ["web"]],
    });
    expect(logs).toContainEqual(expect.stringContaining("Dry run: not starting services"));
    expect(run.finished).toBe(true);
  });

  it("refuses a taken port like a real run, without emitting a plan", async () => {
    runtime.isPortListening.mockResolvedValue(true);
    occupant.findPortOccupant.mockReturnValue({ command: "nginx", pid: 77 });
    const emit = vi.fn();
    const run = runFor({ emit, dryRun: true });
    nativeUpPlan(run);
    await expect(nativeUpDryRun(run)).rejects.toThrow(ExitCalled);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toMatchObject({ ok: false, runtime: "native", dryRun: true });
    expect(emit.mock.calls[0][0].failures).toMatchObject([
      { name: "api", exitCode: null, code: "PORT_IN_USE" },
      { name: "web", exitCode: null, code: "PORT_IN_USE" },
    ]);
    expect(emit.mock.calls[0][1][0].code).toBe("PORT_IN_USE");
    expect(run.finished).toBe(true);
  });
});

describe("nativeUpRuntimePreflight", () => {
  it("fails when an image service needs Docker and Docker is not running", async () => {
    const db = makeResource("db", "backend", { image: "postgres:16" });
    docker.isDockerRunning.mockReturnValue(false);
    const emit = vi.fn();
    const run = runFor({ selected: [db, api], emit });
    nativeUpPlan(run);
    await expect(nativeUpRuntimePreflight(run)).rejects.toThrow(ExitCalled);
    expect(emit.mock.calls[0][1][0].code).toBe("DOCKER_NOT_RUNNING");
    expect(emit.mock.calls[0][1][0].message).toContain("db");
    expect(run.finished).toBe(true);
  });

  it("fails on a taken port after the Docker check", async () => {
    runtime.isPortListening.mockResolvedValue(true);
    const emit = vi.fn();
    const run = runFor({ emit });
    nativeUpPlan(run);
    await expect(nativeUpRuntimePreflight(run)).rejects.toThrow(ExitCalled);
    expect(emit.mock.calls[0][1][0].code).toBe("PORT_IN_USE");
  });

  it("passes a clean run untouched", async () => {
    const run = runFor();
    nativeUpPlan(run);
    await nativeUpRuntimePreflight(run);
    expect(run.finished).toBe(false);
  });
});

describe("nativeUpRunRecord", () => {
  it("records the shared-Postgres databases the run uses in .flisk/run/databases.json", () => {
    const root = createTempDir();
    mkdirSync(join(root, ".flisk"), { recursive: true });
    writeFileSync(
      join(root, ".flisk", "project.json"),
      JSON.stringify({ project: { name: "shop" } }),
    );
    const dbApi = {
      ...makeResource("api", "backend", { dependsOn: ["postgres"] }),
      stack: "api",
    };
    nativeUpRunRecord(runFor({ projectRoot: root, selected: [dbApi] }));
    const record = JSON.parse(
      readFileSync(join(root, ".flisk", "run", "databases.json"), "utf8"),
    ) as { databases: { stack: string; name: string }[] };
    expect(record.databases).toEqual([{ stack: "api", name: "shop_api" }]);
  });
});

describe("nativeUpSupervisor", () => {
  it("builds the supervisor over the plan with the run env and the ready timeout", () => {
    const run = runFor({ readyTimeoutMs: 4321 });
    nativeUpPlan(run);
    nativeUpSupervisor(run);
    expect(runtime.supervisorArgs).toHaveLength(1);
    const [projectRoot, plans, events, options] = runtime.supervisorArgs[0] as [
      string,
      Array<{ name: string }>,
      Record<string, unknown>,
      {
        readyTimeoutMs?: number;
        baseEnv?: Record<string, string>;
        extraEnvPaths: string[];
        reload: () => { plans: readonly { name: string }[] };
      },
    ];
    expect(projectRoot).toBe(run.input.projectRoot);
    expect(plans.map((plan) => plan.name)).toEqual(["api", "web"]);
    expect(typeof events.onLine).toBe("function");
    expect(typeof events.onNote).toBe("function");
    expect(options.readyTimeoutMs).toBe(4321);
    expect(options.baseEnv).toBe(run.vars);
    expect(options.extraEnvPaths).toEqual([]);
    expect(options.reload()).toMatchObject({ plans: expect.any(Array) });
  });

  it("prefixed output only when not quiet, and reload replans from the current env", () => {
    const root = createTempDir();
    writeFileSync(join(root, ".env"), "FLISK_STEP_FRESH=reloaded\n");
    const run = runFor({ projectRoot: root, quiet: true });
    nativeUpEnv(run);
    nativeUpPlan(run);
    nativeUpSupervisor(run);
    const events = runtime.supervisorArgs[0][2] as Record<string, unknown>;
    expect(events.onLine).toBeUndefined();
    expect(events.onNote).toBeUndefined();
    const options = runtime.supervisorArgs[0][3] as {
      reload: () => { plans: readonly { name: string; env: Record<string, string> }[] };
    };
    const { plans } = options.reload();
    expect(plans.map((plan) => plan.name)).toEqual(["api", "web"]);
  });
});

describe("nativeUpGuards", () => {
  const supervised = () => {
    const run = runFor();
    nativeUpPlan(run);
    nativeUpSupervisor(run);
    nativeUpGuards(run);
    return run;
  };

  it("registers the signal handlers and the run.json exit cleanup", () => {
    supervised();
    expect([...handlers.keys()]).toEqual(
      expect.arrayContaining(["SIGINT", "SIGTERM", "SIGHUP", "exit"]),
    );
  });

  it("stops the supervisor once and exits 0 however many signals arrive", async () => {
    const exit = vi.fn();
    const run = runFor({ exit: exit as unknown as (code: number) => never });
    nativeUpPlan(run);
    nativeUpSupervisor(run);
    nativeUpGuards(run);
    handlers.get("SIGINT")?.();
    handlers.get("SIGTERM")?.();
    await flush();
    expect(runtime.supervisorStop).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    expect(logs).toContainEqual(expect.stringContaining("Stopping local processes..."));
  });

  it("removes its own run.json on exit and leaves another process's alone", () => {
    const root = createTempDir();
    const statePath = join(root, "run.json");
    writeFileSync(statePath, "{}");
    runtime.nativeRunStatePath.mockReturnValue(statePath);
    const run = runFor({ projectRoot: root });
    nativeUpPlan(run);
    nativeUpSupervisor(run);
    nativeUpGuards(run);
    runtime.readNativeRunState.mockReturnValue({ pid: process.pid + 1 });
    handlers.get("exit")?.();
    expect(existsSync(statePath)).toBe(true);
    runtime.readNativeRunState.mockReturnValue({ pid: process.pid });
    handlers.get("exit")?.();
    expect(existsSync(statePath)).toBe(false);
  });
});

describe("nativeUpStart", () => {
  const supervisedRun = (input: Partial<Parameters<typeof runFor>[0]> = {}) => {
    const run = runFor(input);
    nativeUpPlan(run);
    nativeUpSupervisor(run);
    nativeUpGuards(run);
    return run;
  };

  it("reports failed starts with the service's last lines, stops and exits 1", async () => {
    const root = createTempDir();
    writeServiceLog(root, "api", ["FATAL: DATABASE_URL is not set"]);
    runtime.supervisorStart.mockResolvedValue([
      { name: "api", reason: "kept exiting; see its output above" },
    ]);
    const emit = vi.fn();
    const exit = vi.fn();
    const run = supervisedRun({
      projectRoot: root,
      selected: [api],
      emit,
      quiet: true,
      exit: exit as unknown as (code: number) => never,
    });
    await nativeUpStart(run);
    const [data, issues] = emit.mock.calls[0];
    expect(data.failures[0].logs).toEqual(["FATAL: DATABASE_URL is not set"]);
    expect(issues[0].code).toBe("UP_RESOURCE_FAILED");
    expect(issues[0].message).toContain("      FATAL: DATABASE_URL is not set");
    expect(runtime.supervisorStop).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("names each service's log file in quiet mode instead of 'output above' or '<service>'", async () => {
    const root = createTempDir();
    writeServiceLog(root, "api", ["FATAL: DATABASE_URL is not set"]);
    runtime.supervisorStart.mockResolvedValue([
      { name: "api", reason: "kept exiting; see its output above" },
      { name: "web", reason: "not started: api did not start" },
    ]);
    const emit = vi.fn();
    const exit = vi.fn();
    const run = supervisedRun({
      projectRoot: root,
      emit,
      quiet: true,
      exit: exit as unknown as (code: number) => never,
    });
    await nativeUpStart(run);
    const logDir = join(".flisk", "native", "logs");
    const [data, issues] = emit.mock.calls[0];
    expect(data.failures).toEqual([
      expect.objectContaining({
        name: "api",
        reason: "kept exiting",
        log: `${logDir}/api.log`,
      }),
      expect.objectContaining({
        name: "web",
        reason: "not started: api did not start",
        log: `${logDir}/web.log`,
      }),
    ]);
    expect(issues[0].message).toContain(
      `Output of every service: ${logDir}/api.log, ${logDir}/web.log`,
    );
    expect(issues[0].message).not.toContain("<service>");
    expect(issues[0].message).not.toContain("output above");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("keeps the reason and still names the log file when the run is not quiet", async () => {
    runtime.supervisorStart.mockResolvedValue([
      { name: "api", reason: "kept exiting; see its output above" },
    ]);
    const emit = vi.fn();
    const exit = vi.fn();
    const run = supervisedRun({
      emit,
      quiet: false,
      exit: exit as unknown as (code: number) => never,
    });
    await nativeUpStart(run);
    const [data] = emit.mock.calls[0];
    expect(data.failures[0].reason).toBe("kept exiting");
    expect(data.failures[0].log).toBe(`${join(".flisk", "native", "logs")}/api.log`);
  });

  it("emits the urls and prints the up banner, then stays parked", async () => {
    const emit = vi.fn();
    const run = supervisedRun({ emit, only: ["web"], dependencies: ["api"] });
    let settled = false;
    void nativeUpStart(run).then(() => {
      settled = true;
    });
    await flush();
    expect(emit).toHaveBeenCalledWith(UP_EMIT_PAYLOAD);
    const output = logs.join("\n");
    expectUpBanner(output);
    expect(settled).toBe(false);
  });

  it("reports nothing when the run was stopped while starting", async () => {
    let finishStart: (failures: unknown[]) => void = () => {};
    runtime.supervisorStart.mockReturnValue(
      new Promise((resolve) => {
        finishStart = resolve;
      }),
    );
    const emit = vi.fn();
    const exit = vi.fn();
    const run = supervisedRun({
      emit,
      quiet: true,
      exit: exit as unknown as (code: number) => never,
    });
    const started = nativeUpStart(run);
    await flush();
    handlers.get("SIGTERM")?.();
    finishStart([{ name: "api", reason: "killed" }]);
    await started;
    expect(emit).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });
});
