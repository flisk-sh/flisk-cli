// biome-ignore-all lint/suspicious/noTemplateCurlyInString: literal shell and migrator references are test fixtures
// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { NativeServicePlan } from "../../native-runtime.js";
import { restartDelayForCrash } from "../../native-runtime.js";
import { native } from "../../test-support/native-runtime.js";

describe("native restart delays", () => {
  it("starts at 250ms, doubles, and caps the wait at 5s (#3820)", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((crash) => restartDelayForCrash(crash))).toEqual([
      250, 500, 1_000, 2_000, 4_000, 5_000, 5_000, 5_000,
    ]);
  });

  it("caps an explicit restartDelayMs, too", () => {
    expect([1, 2, 3, 4, 5].map((crash) => restartDelayForCrash(crash, 1_000))).toEqual([
      1_000, 2_000, 4_000, 5_000, 5_000,
    ]);
  });
});

describe("native supervisor lifecycle", () => {
  native.nativeTestContext();

  type Services = NativeServicePlan[];
  type NoteOptions = {
    named?: boolean;
    restartDelayMs?: number;
    customNote?: (notes: string[], name: string, message: string) => void;
  };

  function startWithNotes(root: string, services: Services, options: NoteOptions = {}) {
    const notes: string[] = [];
    const onNote = (name: string, message: string) => {
      if (options.customNote) options.customNote(notes, name, message);
      else if (options.named) notes.push(`${name}: ${message}`);
      else notes.push(message);
    };
    const supervisorOptions =
      options.restartDelayMs === undefined ? {} : { restartDelayMs: options.restartDelayMs };
    const supervisor = new native.NativeSupervisor(root, services, { onNote }, supervisorOptions);
    native.supervisors.push(supervisor);
    return { notes, supervisor };
  }

  async function startDbApiScenario(
    root: string,
    dbExtra: Record<string, unknown> = { healthCheckPath: "/health" },
  ) {
    const [dbDir, apiDir] = [native.join(root, "db"), native.join(root, "api")];
    native.mkdirSync(dbDir);
    native.mkdirSync(apiDir);
    native.writeFileSync(native.join(dbDir, "db.mjs"), native.DB_SCRIPT);
    native.writeFileSync(native.join(apiDir, "api.mjs"), native.API_SCRIPT);
    const [dbPort, apiPort] = [await native.freePort(), await native.freePort()];
    const plan = native.planNativeRun([
      native.nativeService(dbDir, "db", {
        command: `${native.NODE} db.mjs`,
        port: dbPort,
        ...dbExtra,
      }),
      native.nativeService(apiDir, "api", {
        command: `${native.NODE} api.mjs`,
        port: apiPort,
        healthCheckPath: "/health",
        dependsOn: ["db"],
        env: { DB_PORT: String(dbPort) },
      }),
    ]);
    return {
      dbDir,
      apiPort,
      ...startWithNotes(root, plan.services, { named: true, restartDelayMs: 10 }),
    };
  }

  it("starts a service only after its dependency answers, and serves both", async () => {
    const root = native.createTempDir();
    const apiDir = native.join(root, "api");
    const webDir = native.join(root, "web");
    for (const dir of [apiDir, webDir]) {
      native.mkdirSync(dir);
      native.writeFileSync(native.join(dir, "server.mjs"), native.SERVER);
    }
    const [apiPort, webPort] = [await native.freePort(), await native.freePort()];
    const plan = native.planNativeRun([
      native.nativeService(apiDir, "api", {
        command: `${native.NODE} server.mjs`,
        port: apiPort,
        healthCheckPath: "/health",
        env: { GREETING: "from api" },
      }),
      native.nativeService(webDir, "web", {
        command: `${native.NODE} server.mjs`,
        port: webPort,
        dependsOn: ["api"],
      }),
    ]);
    const { notes, supervisor } = startWithNotes(root, plan.services, {
      customNote: (target, name, message) => target.push(`${name}: ${message.split(":")[0]}`),
    });

    expect(await supervisor.start()).toEqual([]);
    const apiReady = notes.indexOf("api: ready");
    const webStarted = notes.indexOf("web: started");
    // A missing note is index -1, which would satisfy the ordering below by accident.
    expect(apiReady).toBeGreaterThanOrEqual(0);
    expect(webStarted).toBeGreaterThan(apiReady);
    expect(await (await fetch(native.localUrl(apiPort))).text()).toBe("from api");
    expect((await fetch(native.localUrl(webPort, "/health"))).status).toBe(200);

    const state = native.readNativeRunState(root);
    expect(state?.pid).toBe(process.pid);
    expect(Object.keys(state?.services ?? {})).toEqual(["api", "web"]);
    expect(native.readFileSync(native.join(root, ".flisk", "native", ".gitignore"), "utf-8")).toBe(
      "*\n",
    );

    await native.waitFor(() => native.existsSync(native.nativeLogPath(root, "web")));
    const lines = native.readNativeLogLines(root, ["api", "web"], { tail: 10 });
    expect(lines.map((line) => `${line.resource}: ${line.text}`)).toEqual([
      `api: listening on ${apiPort}`,
      `web: listening on ${webPort}`,
    ]);
    expect(lines[0]?.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(lines.map((line) => line.seq)).toEqual([expect.any(Number), expect.any(Number)]);
    expect(lines.every((line) => Number.isSafeInteger(line.seq) && (line.seq as number) > 0)).toBe(
      true,
    );
    expect(
      native.readNativeLogLines(root, ["api"], {
        tail: 10,
        sinceMs: 0,
        now: Date.now() + 60_000,
      }),
    ).toEqual([]);

    await supervisor.stop();
    expect(native.existsSync(native.nativeRunStatePath(root))).toBe(false);
    expect(native.isProcessAlive(state?.services.api?.pid as number)).toBe(false);
  });

  it("restarts a service that crashes after the short default delay (#3820)", async () => {
    const root = native.createTempDir();
    native.writeFileSync(native.join(root, "server.mjs"), native.SERVER);
    const port = await native.freePort();
    const plan = native.planNativeRun([
      native.nativeService(root, "api", {
        command: `${native.NODE} server.mjs`,
        port,
        healthCheckPath: "/health",
      }),
    ]);
    const { notes, supervisor } = startWithNotes(root, plan.services);
    expect(await supervisor.start()).toEqual([]);
    const firstPid = supervisor.pidOf("api") as number;

    process.kill(-firstPid, "SIGKILL");
    await native.waitFor(() => notes.includes("ready again"));
    expect(notes).toContain("was stopped by SIGKILL; restarting in 0.25s");
    expect(supervisor.pidOf("api")).not.toBe(firstPid);
    expect((await fetch(native.localUrl(port, "/health"))).status).toBe(200);
  });

  it("redacts a secret that appears in the started note, and still starts the service", async () => {
    const root = native.createTempDir();
    native.writeFileSync(native.join(root, ".env"), "HARDCODED_TOKEN=sk-live-redact-me-9f2c\n");
    const plan = native.planNativeRun([
      native.nativeService(root, "job", {
        command: "true --token sk-live-redact-me-9f2c",
        restart: "no",
      }),
    ]);
    const { notes, supervisor } = startWithNotes(root, plan.services);

    expect(await supervisor.start()).toEqual([]);
    // The service started (the job ran to exit 0) and its note names the command without the env-file secret.
    expect(notes).toContain("finished (exit code 0)");
    const started = notes.find((note) => note.startsWith("started:"));
    expect(started).toBeDefined();
    expect(started).not.toContain("sk-live-redact-me-9f2c");
    expect(started).toContain("true --token");
  });

  it("withholds the started note when the env file cannot be read for redaction, and still starts the service", async () => {
    const root = native.createTempDir();
    // A directory named .env makes the redactor's env read fail, like an unreadable file would.
    native.mkdirSync(native.join(root, ".env"));
    const plan = native.planNativeRun([
      native.nativeService(root, "job", { command: "true --token sk-nomask-1", restart: "no" }),
    ]);
    const { notes, supervisor } = startWithNotes(root, plan.services);

    expect(await supervisor.start()).toEqual([]);
    expect(notes).toContain("finished (exit code 0)");
    const started = notes.find((note) => note.startsWith("started:"));
    expect(started).toBe("started: [output withheld: the project's env files could not be read]");
  });

  it("waits for a dependency that went down instead of giving up, then starts the dependent again", async () => {
    const root = native.createTempDir();
    const { dbDir, apiPort, notes, supervisor } = await startDbApiScenario(root);
    expect(await supervisor.start()).toEqual([]);

    native.writeFileSync(native.join(dbDir, "down"), "");
    process.kill(-(supervisor.pidOf("db") as number), "SIGKILL");
    await native.waitFor(() =>
      notes.some((note) => note.startsWith("api: exited with code 1 while db is down")),
    );
    expect(native.nativeServiceStates(root, ["api"]).api).toEqual({
      status: "pending",
      reason: "waiting for db",
      exitCode: 1,
    });
    // Eight 10ms restarts would have run out long before this: the API is waiting, not crashing.
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(notes.filter((note) => /^api: .*not restarted/.test(note))).toEqual([]);

    native.rmSync(native.join(dbDir, "down"));
    await native.waitFor(() => notes.includes("api: ready again"));
    expect(notes).toContain("api: db is ready again; starting");
    expect((await fetch(native.localUrl(apiPort, "/health"))).status).toBe(200);
  });

  it("reports a service held back at its first start as waiting for its dependency (#3805)", async () => {
    const root = native.createTempDir();
    const fail = `${native.NODE} -e ${JSON.stringify("process.exit(3)")}`;
    const plan = native.planNativeRun([
      native.nativeService(root, "api", { appType: "migrator", command: fail }),
      native.nativeService(root, "web", { command: fail, dependsOn: ["api"] }),
    ]);
    const { supervisor } = startWithNotes(root, plan.services);
    expect(await supervisor.start()).toMatchObject([
      { name: "api", reason: "the job did not exit 0", exitCode: 3 },
      { name: "web", reason: "not started: api did not start", exitCode: null },
    ]);
    expect(supervisor.pidOf("web")).toBeUndefined();
    expect(native.readNativeRunState(root)?.services.web?.waitingFor).toEqual(["api"]);
    expect(native.nativeServiceStates(root, ["web"]).web).toMatchObject({
      status: "pending",
      reason: "waiting for api",
      exitCode: null,
    });
  });

  it("does not wait for a dependency that gave up: the dependent counts its crashes and stops", async () => {
    const root = native.createTempDir();
    // "restart": "no" with a port: once it exits it is never started again.
    const { notes, supervisor } = await startDbApiScenario(root, { restart: "no" });
    expect(await supervisor.start()).toEqual([]);

    process.kill(-(supervisor.pidOf("db") as number), "SIGKILL");
    await native.waitFor(() => notes.some((note) => /^api: .*exited 8 times in a row/.test(note)));
    expect(notes.filter((note) => note.includes("while db is down"))).toEqual([]);
  });

  it('starts the services that depend on a no-port "restart": "no" service that exits 0, whatever its appType', async () => {
    const root = native.createTempDir();
    const worker = native.makeResource("migrate", "worker", { command: "exit 0", restart: "no" });
    const plan = native.planNativeRun([
      { ...worker, path: root, configPath: native.join(root, "service.json") },
      native.nativeService(root, "web", { command: "sleep 30", dependsOn: ["migrate"] }),
    ]);
    const { notes, supervisor } = startWithNotes(root, plan.services, { restartDelayMs: 10 });
    expect(await supervisor.start()).toEqual([]);
    // The exit was seen before start() returned, so this ran the case it names (an exit inside the readiness grace).
    expect(notes).toContain('exited with code 0; not restarting ("restart": "no")');
  });

  it('reports a "restart": "no" service with a port that exits 0 as finished, not "kept exiting" (#5120)', async () => {
    const root = native.createTempDir();
    const once = native.makeResource("once", "worker", {
      command: 'sh -c "echo done-once"',
      port: await native.freePort(),
      restart: "no",
    });
    const plan = native.planNativeRun([
      { ...once, path: root, configPath: native.join(root, "service.json") },
    ]);
    const notes: string[] = [];
    const supervisor = new native.NativeSupervisor(root, plan.services, {
      onNote: (_name, message) => notes.push(message),
    });
    native.supervisors.push(supervisor);
    expect(await supervisor.start()).toEqual([]);
    expect(notes).toContain('exited with code 0; not restarting ("restart": "no")');
    expect(native.nativeServiceStates(root, ["once"])).toEqual({
      once: { status: "ready", reason: "finished" },
    });
  });

  it('names the exit code when a "restart": "no" service with a port exits non-zero (#5120)', async () => {
    const root = native.createTempDir();
    const once = native.makeResource("once", "worker", {
      command: "exit 3",
      port: await native.freePort(),
      restart: "no",
    });
    const plan = native.planNativeRun([
      { ...once, path: root, configPath: native.join(root, "service.json") },
    ]);
    const notes: string[] = [];
    const supervisor = new native.NativeSupervisor(root, plan.services, {
      onNote: (_name, message) => notes.push(message),
    });
    native.supervisors.push(supervisor);
    expect(await supervisor.start()).toMatchObject([
      {
        name: "once",
        reason: 'exited with code 3; not restarting ("restart": "no")',
        exitCode: 3,
      },
    ]);
    expect(notes).toContain('exited with code 3; not restarting ("restart": "no")');
  });

  it('starts a dependent after a "restart": "no" service with a port exits 0 (#5120)', async () => {
    const root = native.createTempDir();
    native.writeFileSync(native.join(root, "server.mjs"), native.SERVER);
    const port = await native.freePort();
    const plan = native.planNativeRun([
      {
        ...native.makeResource("once", "worker", {
          command: "exit 0",
          port: await native.freePort(),
          restart: "no",
        }),
        path: root,
        configPath: native.join(root, "service.json"),
      },
      native.nativeService(root, "api", {
        command: `${native.NODE} server.mjs`,
        port,
        healthCheckPath: "/health",
        dependsOn: ["once"],
      }),
    ]);
    const notes: string[] = [];
    const supervisor = new native.NativeSupervisor(root, plan.services, {
      onNote: (name, message) => notes.push(`${name}: ${message}`),
    });
    native.supervisors.push(supervisor);
    expect(await supervisor.start()).toEqual([]);
    expect((await fetch(native.localUrl(port, "/health"))).status).toBe(200);
  });

  it("stops restarting a service that keeps exiting, and reports it", async () => {
    const root = native.createTempDir();
    // A port that never opens makes start() poll until the supervisor gives up, instead of calling a process that is still alive
    // after the 1s grace "ready": eight fast restarts can take longer than that grace on a loaded machine (#2898).
    const plan = native.planNativeRun([
      native.nativeService(root, "job", { command: "exit 3", port: await native.freePort() }),
    ]);
    const { notes, supervisor } = startWithNotes(root, plan.services, { restartDelayMs: 10 });
    expect(await supervisor.start()).toMatchObject([
      { name: "job", reason: "kept exiting", exitCode: 3 },
    ]);
    expect(notes.filter((note) => note.startsWith("exited with code 3; restarting"))).toHaveLength(
      7,
    );
    expect(notes.at(-1)).toMatch(/exited 8 times in a row, so it is not restarted/);
  });

  it("names the missing program when a service exits 127 (#4678)", async () => {
    const root = native.createTempDir();
    // The shell cannot find this program, so the service exits 127 on every start.
    const plan = native.planNativeRun([
      native.nativeService(root, "shop-api", {
        command: "definitely-missing-flisk-program --watch",
        port: await native.freePort(),
      }),
    ]);
    const { notes, supervisor } = startWithNotes(root, plan.services, { restartDelayMs: 10 });
    expect(await supervisor.start()).toEqual([
      {
        name: "shop-api",
        reason: "runs definitely-missing-flisk-program, which is not installed",
        exitCode: 127,
      },
    ]);
    // The first exit already names the program to install, not only the give-up note.
    expect(notes[1]).toBe(
      "exited with code 127: shop-api runs definitely-missing-flisk-program, which is not installed; restarting in 0.01s",
    );
    expect(notes.at(-1)).toMatch(
      /exited with code 127: shop-api runs definitely-missing-flisk-program, which is not installed; it exited 8 times in a row/,
    );
  });

  it("does not report a no-port worker ready when its process exits at once (#3950)", async () => {
    const root = native.createTempDir();
    const node = JSON.stringify(process.execPath);
    writeFileSync(
      join(root, "crash.mjs"),
      'console.error("worker: missing env DATABASE_URL"); process.exit(1);\n',
    );
    writeFileSync(join(root, "loop.mjs"), "setInterval(() => {}, 1000);\n");
    const plan = native.planNativeRun([
      native.nativeService(root, "worker", { command: `${node} crash.mjs` }),
      native.nativeService(root, "dependent", {
        command: `${node} loop.mjs`,
        dependsOn: ["worker"],
      }),
    ]);
    // Longer than a fraction of the grace: the old code saw "not gaveUp" at t=1s and called it ready.
    const { notes, supervisor } = startWithNotes(root, plan.services, {
      named: true,
      restartDelayMs: 500,
    });
    expect(await supervisor.start()).toMatchObject([
      { name: "worker", reason: "kept exiting", exitCode: 1 },
      { name: "dependent", reason: "not started: worker did not start", exitCode: null },
    ]);
    expect(notes).not.toContain("worker: ready");
    expect(supervisor.pidOf("dependent")).toBeUndefined();
    expect(native.readNativeRunState(root)?.services.worker?.ready).toBe(false);
  });

  it("still reports a no-port worker ready when its process stays up through the grace period (#3950)", async () => {
    const root = native.createTempDir();
    const node = JSON.stringify(process.execPath);
    writeFileSync(join(root, "loop.mjs"), "setInterval(() => {}, 1000);\n");
    const plan = native.planNativeRun([
      native.nativeService(root, "worker", { command: `${node} loop.mjs` }),
    ]);
    const { notes, supervisor } = startWithNotes(root, plan.services, { named: true });
    expect(await supervisor.start()).toEqual([]);
    expect(notes).toContain("worker: ready");
    expect(native.readNativeRunState(root)?.services.worker?.ready).toBe(true);
  });

  it('does not restart a service with "restart": "no"', async () => {
    const root = native.createTempDir();
    const plan = native.planNativeRun([
      native.nativeService(root, "once", { command: "exit 0", restart: "no" }),
    ]);
    const { notes, supervisor } = startWithNotes(root, plan.services);
    await supervisor.start();
    // A bring-your-own resource with "restart": "no" and no port is a one-shot job: done once it exits 0.
    expect(notes).toContain("finished (exit code 0)");
  });

  it("starts a dependent only after its one-shot job exited 0 (#2871)", async () => {
    const root = native.createTempDir();
    native.writeFileSync(native.join(root, "server.mjs"), native.SERVER);
    const port = await native.freePort();
    const plan = native.planNativeRun([
      // Takes long enough that a dependent started on "process alive" would come first.
      native.nativeService(root, "migrate", { appType: "migrator", command: "sleep 2" }),
      native.nativeService(root, "api", {
        command: `${native.NODE} server.mjs`,
        port,
        healthCheckPath: "/health",
        dependsOn: ["migrate"],
      }),
    ]);
    expect(plan.services.find((service) => service.name === "migrate")).toMatchObject({
      job: true,
      restart: false,
    });
    const { notes, supervisor } = startWithNotes(root, plan.services, { named: true });

    expect(await supervisor.start()).toEqual([]);
    const migrateFinished = notes.indexOf("migrate: finished (exit code 0)");
    const apiStarted = notes.findIndex((note) => note.startsWith("api: started"));
    // A missing note is index -1, which would satisfy the ordering below by accident.
    expect(migrateFinished).toBeGreaterThanOrEqual(0);
    expect(apiStarted).toBeGreaterThan(migrateFinished);
    expect((await fetch(native.localUrl(port, "/health"))).status).toBe(200);
  });

  it("does not start a dependent when its job fails, and does not restart the job", async () => {
    const root = native.createTempDir();
    const port = await native.freePort();
    const plan = native.planNativeRun([
      native.nativeService(root, "migrate", { appType: "migrator", command: "exit 3" }),
      native.nativeService(root, "api", { command: "sleep 30", port, dependsOn: ["migrate"] }),
    ]);
    const { notes, supervisor } = startWithNotes(root, plan.services, { named: true });
    expect(await supervisor.start()).toMatchObject([
      { name: "migrate", reason: "the job did not exit 0", exitCode: 3 },
      { name: "api", reason: "not started: migrate did not start", exitCode: null },
    ]);
    expect(supervisor.pidOf("api")).toBeUndefined();
    expect(notes).toContain("migrate: exited with code 3; a job is not restarted");
  });

  it("stops what the shell started too, not only the shell", async () => {
    const root = native.createTempDir();
    native.writeFileSync(native.join(root, "server.mjs"), native.SERVER);
    const port = await native.freePort();
    // The shell forks: `sleep` runs beside the server in the service's process group.
    const plan = native.planNativeRun([
      native.nativeService(root, "api", {
        command: `sleep 300 & echo "sleep $!" && ${native.NODE} server.mjs`,
        port,
      }),
    ]);
    const lines: string[] = [];
    const supervisor = new native.NativeSupervisor(root, plan.services, {
      onLine: (_name, line) => lines.push(line),
    });
    native.supervisors.push(supervisor);
    expect(await supervisor.start()).toEqual([]);
    await native.waitFor(() => lines.some((line) => line.startsWith("sleep ")));
    const sleepPid = Number(lines.find((line) => line.startsWith("sleep "))?.slice(6));
    expect(native.isProcessAlive(sleepPid)).toBe(true);
    await supervisor.stop();
    await native.waitFor(() => !native.isProcessAlive(sleepPid));
  });

  it("gives independent services that ignore SIGTERM their grace period together, not one after another (#3811)", async () => {
    const root = native.createTempDir();
    const stubborn = `trap "" TERM INT; while true; do sleep 0.1; done`;
    const plan = native.planNativeRun(
      ["a", "b", "c"].map((name) => native.nativeService(root, name, { command: stubborn })),
    );
    const supervisor = new native.NativeSupervisor(
      root,
      plan.services,
      {},
      { stopTimeoutMs: 1_000 },
    );
    native.supervisors.push(supervisor);
    expect(await supervisor.start()).toEqual([]);
    const pids = ["a", "b", "c"].map((name) => supervisor.pidOf(name) as number);

    const started = Date.now();
    await supervisor.stop();
    const elapsed = Date.now() - started;
    // One after another this takes 3 x 1 s.
    expect(elapsed).toBeLessThan(2_500);
    // They ignore SIGTERM, so the full 1 s grace period must pass before SIGKILL (small allowance for timer jitter).
    expect(elapsed).toBeGreaterThanOrEqual(900);
    await native.waitFor(() => pids.every((pid) => !native.isProcessAlive(pid)));
  });

  it("still stops dependents before what they depend on", async () => {
    const root = native.createTempDir();
    const log = native.join(root, "stops.log");
    const service = (name: string, dependsOn: string[]) =>
      native.nativeService(root, name, {
        command: `trap 'echo ${name} >> ${JSON.stringify(log)}; exit 0' TERM; while true; do sleep 0.1; done`,
        dependsOn,
      });
    const plan = native.planNativeRun([service("a", []), service("b", ["a"]), service("c", ["b"])]);
    const supervisor = new native.NativeSupervisor(root, plan.services);
    native.supervisors.push(supervisor);
    expect(await supervisor.start()).toEqual([]);

    await supervisor.stop();
    expect(native.readFileSync(log, "utf8").trim().split("\n")).toEqual(["c", "b", "a"]);
  });
});
