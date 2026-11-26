// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTempDir, makeResource } from "../../../test-support/index.js";
import { planNativeRun } from "../plan.js";
import { STARTUP_ERROR_REASON } from "../startup-error.js";
import { nativeRunStatePath, readNativeRunState } from "../state.js";
import { NativeSupervisor } from "../supervisor.js";

const NODE = JSON.stringify(process.execPath);

/** A port the OS just handed out, so parallel test workers never collide on a guessed one. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

const supervisors: NativeSupervisor[] = [];
afterEach(async () => {
  await Promise.all(supervisors.splice(0).map((supervisor) => supervisor.stop()));
});

function nativeService(dir: string, name: string, config: Record<string, unknown>) {
  const resource = makeResource(name, "bring-your-own", config);
  return { ...resource, path: dir, configPath: join(dir, "service.json") };
}

describe("NativeSupervisor seam", () => {
  it("runs a one-shot job to exit 0, records its outputs, and drops run.json on stop", async () => {
    const root = createTempDir();
    const plan = planNativeRun(
      [
        nativeService(root, "migrate", {
          appType: "migrator",
          command: `${NODE} -e "require('fs').writeFileSync(process.env.FLISK_OUTPUT,'TOKEN=t-123')"`,
        }),
      ],
      {},
      root,
    );
    expect(plan.errors).toEqual([]);
    const notes: string[] = [];
    const supervisor = new NativeSupervisor(root, plan.services, {
      onNote: (_name, message) => notes.push(message),
    });
    supervisors.push(supervisor);

    expect(await supervisor.start()).toEqual([]);
    expect(supervisor.outputsOf("migrate")).toEqual({ TOKEN: "t-123" });
    expect(readNativeRunState(root)?.services.migrate).toMatchObject({
      ready: true,
      job: true,
    });

    await supervisor.stop();
    expect(existsSync(nativeRunStatePath(root))).toBe(false);
  });
});

describe("startup error under a watcher (#5038)", () => {
  const watchLike = (script: string) => `${NODE} -e "${script}"`;

  it("fails fast a still-running service that logged a startup error and went quiet", async () => {
    const root = createTempDir();
    const port = await freePort();
    // What `bun run --watch` looks like after an uncaught throw: the error line, then silence,
    // while the watcher keeps the process alive and the port never listens.
    const plan = planNativeRun(
      [
        nativeService(root, "api", {
          appType: "backend",
          command: watchLike("console.log('error: boom at start');setInterval(()=>{},60000)"),
          port,
        }),
      ],
      {},
      root,
    );
    expect(plan.errors).toEqual([]);
    const supervisor = new NativeSupervisor(
      root,
      plan.services,
      {},
      {
        readyTimeoutMs: 60_000,
        startupErrorQuietMs: 300,
      },
    );
    supervisors.push(supervisor);

    const started = Date.now();
    const failures = await supervisor.start();
    expect(Date.now() - started).toBeLessThan(30_000);
    expect(failures).toMatchObject([{ name: "api", reason: STARTUP_ERROR_REASON }]);
  });

  it("keeps waiting while the service keeps printing after an error line", async () => {
    const root = createTempDir();
    const port = await freePort();
    // A service can log an error and keep starting: only silence after it ends the wait early.
    const plan = planNativeRun(
      [
        nativeService(root, "api", {
          appType: "backend",
          command: watchLike(
            "console.log('error: boom at start');setInterval(()=>console.log('tick'),100)",
          ),
          port,
        }),
      ],
      {},
      root,
    );
    const supervisor = new NativeSupervisor(
      root,
      plan.services,
      {},
      {
        readyTimeoutMs: 800,
        startupErrorQuietMs: 300,
      },
    );
    supervisors.push(supervisor);

    const failures = await supervisor.start();
    expect(failures[0]?.reason).toContain("not ready after");
  });

  it("still reports ready when the port opens before the quiet window ends", async () => {
    const root = createTempDir();
    const port = await freePort();
    const plan = planNativeRun(
      [
        nativeService(root, "api", {
          appType: "backend",
          command: watchLike(
            "console.log('error: boom at start');setTimeout(()=>require('net').createServer().listen(process.env.PORT),200)",
          ),
          port,
        }),
      ],
      {},
      root,
    );
    const supervisor = new NativeSupervisor(
      root,
      plan.services,
      {},
      {
        readyTimeoutMs: 10_000,
        startupErrorQuietMs: 800,
      },
    );
    supervisors.push(supervisor);

    expect(await supervisor.start()).toEqual([]);
  });
});
