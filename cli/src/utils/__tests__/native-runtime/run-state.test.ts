// biome-ignore-all lint/suspicious/noTemplateCurlyInString: literal shell and migrator references are test fixtures
// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { native } from "../../test-support/native-runtime.js";

describe("native run state and identity checks", () => {
  native.nativeTestContext();

  describe("run.json records who flisk started (#3960)", () => {
    it("waits for service identities before reporting startup complete", async () => {
      const root = native.createTempDir();
      native.writeFileSync(native.join(root, "loop.mjs"), "setInterval(() => {}, 1000);\n");
      const plan = native.planNativeRun([
        native.nativeService(root, "api", { command: `${native.NODE} loop.mjs` }),
      ]);
      let releaseIdentity!: (value: string) => void;
      const serviceIdentity = new Promise<string>((resolve) => {
        releaseIdentity = resolve;
      });
      const supervisor = new native.NativeSupervisor(
        root,
        plan.services,
        {},
        {
          startTimeOf: (pid) =>
            pid === process.pid ? Promise.resolve("supervisor") : serviceIdentity,
        },
      );
      native.supervisors.push(supervisor);
      let completed = false;
      const starting = supervisor.start().then(() => {
        completed = true;
      });
      try {
        await native.waitFor(() => supervisor.pidOf("api") !== undefined);
        await new Promise((resolve) => setTimeout(resolve, 1500));
        expect(completed).toBe(false);
      } finally {
        releaseIdentity("service");
        await starting;
      }
      expect(native.readNativeRunState(root)?.services.api?.startTime).toBe("service");
    });

    it("saves the start time of the supervisor and of each service process", async () => {
      const root = native.createTempDir();
      const plan = native.planNativeRun([
        native.nativeService(root, "api", {
          command: `${native.NODE} -e "setInterval(() => {}, 1000)"`,
        }),
      ]);
      const supervisor = new native.NativeSupervisor(root, plan.services);
      native.supervisors.push(supervisor);
      await supervisor.start();
      const pid = supervisor.pidOf("api") as number;
      const expected = await native.processStartTime(pid);
      expect(expected).toBeTruthy();

      await native.waitFor(
        () => native.readNativeRunState(root)?.services.api?.startTime === expected,
      );
      await native.waitFor(() => Boolean(native.readNativeRunState(root)?.pidStartTime));
      expect(native.readNativeRunState(root)?.pidStartTime).toBe(
        await native.processStartTime(process.pid),
      );
    }, 60_000);
  });

  describe("stopNativeRun only signals processes it can prove it started (#3960)", () => {
    const NOW = Date.parse("2026-11-17T10:00:00Z");

    /** A fake process table: pid -> start time. A pid missing from it is not running. */
    function harness(table: Record<number, string | undefined>, bootTime = NOW - 3_600_000) {
      const signalled: number[] = [];
      const terminated: number[] = [];
      const deps = {
        isAlive: (pid: number) => pid in table,
        startTimeOf: async (pid: number) => table[pid],
        bootTimeMs: () => bootTime,
        stopGroup: async (pid: number) => {
          signalled.push(pid);
        },
        terminateSupervisor: async (pid: number) => {
          terminated.push(pid);
        },
      };
      return { deps, signalled, terminated };
    }

    function writeState(root: string, state: Record<string, unknown>): void {
      native.mkdirSync(native.join(root, ".flisk", "native"), { recursive: true });
      native.writeFileSync(native.nativeRunStatePath(root), JSON.stringify(state));
    }

    it("does not signal a recycled pid whose start time differs, and calls the record stale", async () => {
      const root = native.createTempDir();
      writeState(root, {
        pid: 100,
        pidStartTime: "sup-T1",
        startedAt: new Date(NOW - 60_000).toISOString(),
        services: { api: { pid: 200, startTime: "api-T1" } },
      });
      const { deps, signalled, terminated } = harness({ 100: "other-T9", 200: "other-T8" });

      const result = await native.stopNativeRun(root, { deps });

      expect(signalled).toEqual([]);
      expect(terminated).toEqual([]);
      expect(result).toMatchObject({ wasRunning: false, stale: true, services: [] });
      expect(native.existsSync(native.nativeRunStatePath(root))).toBe(false);
    });

    it("signals the supervisor and a service whose start times still match", async () => {
      const root = native.createTempDir();
      writeState(root, {
        pid: 100,
        pidStartTime: "sup-T1",
        startedAt: new Date(NOW - 60_000).toISOString(),
        services: {
          api: { pid: 200, startTime: "api-T1" },
          web: { pid: 300, startTime: "web-T1" },
        },
      });
      const { deps, signalled, terminated } = harness({
        100: "sup-T1",
        200: "api-T1",
        300: "someone-else",
      });

      const result = await native.stopNativeRun(root, { deps });

      expect(terminated).toEqual([100]);
      expect(signalled).toEqual([200]);
      expect(result).toMatchObject({ wasRunning: true, services: ["api"], supervisorPid: 100 });
      expect(result.stale).toBeUndefined();
    });

    it("signals nothing for a run recorded before the last boot", async () => {
      const root = native.createTempDir();
      writeState(root, {
        pid: 100,
        pidStartTime: "sup-T1",
        startedAt: new Date(NOW - 7_200_000).toISOString(),
        services: { api: { pid: 200, startTime: "api-T1" } },
      });
      // Even matching start times are not trusted: a reboot resets them.
      const { deps, signalled, terminated } = harness({ 100: "sup-T1", 200: "api-T1" });

      const result = await native.stopNativeRun(root, { deps });

      expect(signalled).toEqual([]);
      expect(terminated).toEqual([]);
      expect(result).toMatchObject({ wasRunning: false, stale: true });
      expect(native.existsSync(native.nativeRunStatePath(root))).toBe(false);
    });

    it("does not signal a live pid from an older run.json with no start time, and reports it", async () => {
      const root = native.createTempDir();
      writeState(root, {
        pid: 100,
        startedAt: new Date(NOW - 60_000).toISOString(),
        services: { api: { pid: 200 }, done: { pid: 400 } },
      });
      const { deps, signalled, terminated } = harness({ 100: "sup-T1", 200: "api-T1" });

      const result = await native.stopNativeRun(root, { deps });

      expect(signalled).toEqual([]);
      expect(terminated).toEqual([]);
      expect(result.unverified).toEqual([
        { name: "api", pid: 200 },
        { name: "flisk up", pid: 100 },
      ]);
    });

    it("does not signal a live pid whose start time cannot be read (another user's process)", async () => {
      const root = native.createTempDir();
      writeState(root, {
        pid: 100,
        pidStartTime: "sup-T1",
        startedAt: new Date(NOW - 60_000).toISOString(),
        services: { api: { pid: 200, startTime: "api-T1" } },
      });
      const { deps, signalled } = harness({ 200: undefined });

      const result = await native.stopNativeRun(root, { deps });

      expect(signalled).toEqual([]);
      expect(result.unverified).toEqual([{ name: "api", pid: 200 }]);
      expect(result.services).toEqual([]);
    });
  });
});
