// biome-ignore-all lint/suspicious/noTemplateCurlyInString: literal shell and migrator references are test fixtures
// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { native } from "../../test-support/native-runtime.js";

describe("native runtime process control and states", () => {
  native.nativeTestContext();

  describe("nativeServiceStates", () => {
    it("reports a one-shot job that exited 0 as ready, and only a crashed long-running service as restarting", async () => {
      const root = native.createTempDir();
      const exited = native.spawn(process.execPath, ["-e", ""]);
      await new Promise((resolve) => exited.once("exit", resolve));
      // Node itself is always present; `sleep` is not on every host's PATH.
      const live = native.spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        stdio: "ignore",
        windowsHide: true,
      });
      try {
        await new Promise<void>((resolve, reject) => {
          live.once("spawn", resolve);
          live.once("error", reject);
        });
        native.mkdirSync(native.join(root, ".flisk", "native"), { recursive: true });
        native.writeFileSync(
          native.nativeRunStatePath(root),
          JSON.stringify({
            // This test process stands in for the supervisor, so the run counts as up.
            pid: process.pid,
            startedAt: new Date().toISOString(),
            services: {
              setup: { pid: exited.pid, ready: true, job: true },
              broken: { pid: exited.pid, ready: false, job: true },
              api: { pid: exited.pid, port: 4000, ready: false },
              web: { pid: live.pid, port: 3000, ready: true },
            },
          }),
        );
        expect(native.nativeServiceStates(root, ["setup", "broken", "api", "web"])).toEqual({
          setup: { status: "ready", reason: "finished" },
          broken: { status: "pending", reason: "the job did not exit 0" },
          api: { status: "pending", reason: "restarting" },
          web: { status: "ready" },
        });
      } finally {
        live.kill();
      }
    });

    it("records a one-shot job in the run state, so status can tell it from a crash", async () => {
      const root = native.createTempDir();
      const plan = native.planNativeRun([
        native.nativeService(root, "setup", { command: "exit 0", restart: "no" }),
      ]);
      const supervisor = new native.NativeSupervisor(root, plan.services, {});
      native.supervisors.push(supervisor);
      await supervisor.start();
      expect(native.readNativeRunState(root)?.services.setup).toMatchObject({
        ready: true,
        job: true,
      });
      // The supervisor writes its own pid as the run's, and it is this test process: the run is up.
      expect(native.nativeServiceStates(root, ["setup"]).setup).toEqual({
        status: "ready",
        reason: "finished",
      });
    });
  });

  describe("recordedNativeServiceNames", () => {
    it("names every service the run state or a log file still knows, as a partial manifest list cannot", () => {
      const root = native.createTempDir();
      native.mkdirSync(native.join(root, ".flisk", "native", "logs"), { recursive: true });
      native.writeFileSync(
        native.nativeRunStatePath(root),
        JSON.stringify({
          pid: process.pid,
          startedAt: new Date().toISOString(),
          services: { api: { pid: 1, ready: true }, web: {} },
        }),
      );
      native.writeFileSync(native.nativeLogPath(root, "api"), "2026-10-31T10:00:00.000Z hi\n");
      native.writeFileSync(
        native.nativeLogPath(root, "broken-svc"),
        "2026-10-31T10:00:00.000Z bye\n",
      );
      // A file that is not a service log never names a service.
      native.writeFileSync(native.join(root, ".flisk", "native", "logs", "notes.txt"), "x");

      expect(native.recordedNativeServiceNames(root)).toEqual(["api", "web", "broken-svc"]);
    });

    it("returns no names for a project that never ran natively", () => {
      expect(native.recordedNativeServiceNames(native.createTempDir())).toEqual([]);
    });
  });

  describe("terminateSupervisorProcess", () => {
    it("ends the supervisor's whole process tree on Windows, so its services go with it", async () => {
      const killed: number[] = [];
      const kill = native.vi.spyOn(process, "kill");
      try {
        // A pid that does not exist, so the wait that follows returns at once.
        await native.terminateSupervisorProcess(2_147_000_000, 50, "win32", (pid) =>
          killed.push(pid),
        );
        expect(killed).toEqual([2_147_000_000]);
        expect(kill).not.toHaveBeenCalledWith(2_147_000_000, "SIGTERM");
      } finally {
        kill.mockRestore();
      }
    });

    it("sends SIGTERM on POSIX and never runs taskkill", async () => {
      const killed: number[] = [];
      const kill = native.vi.spyOn(process, "kill").mockImplementation(() => true);
      try {
        await native.terminateSupervisorProcess(2_147_000_000, 50, "linux", (pid) =>
          killed.push(pid),
        );
        expect(kill).toHaveBeenCalledWith(2_147_000_000, "SIGTERM");
        expect(killed).toEqual([]);
      } finally {
        kill.mockRestore();
      }
    });
  });

  describe("detachesServices", () => {
    it("gives a service its own process group on POSIX and not on Windows", () => {
      expect(native.detachesServices("linux")).toBe(true);
      expect(native.detachesServices("darwin")).toBe(true);
      expect(native.detachesServices("win32")).toBe(false);
    });

    it("logs a crashing service's final error, redacts secrets, and includes the log in failures", async () => {
      const root = native.createTempDir();
      const token = "NATIVE_CRASH_TOKEN_DO_NOT_LOG_12345";
      native.writeFileSync(native.join(root, ".env"), `API_TOKEN=${token}\n`);
      native.writeFileSync(
        native.join(root, "crash.mjs"),
        "console.error(`FATAL: API_TOKEN is not set (${process.env.API_TOKEN})`); process.exit(1);",
      );
      const logPath = native.nativeLogPath(root, "crasher");
      const plan = native.planNativeRun(
        [
          native.nativeService(root, "crasher", {
            appType: "migrator",
            command: `${native.NODE} crash.mjs`,
            env: { API_TOKEN: native.ref("API_TOKEN") },
          }),
        ],
        { API_TOKEN: token },
        root,
      );
      const lines: string[] = [];
      const supervisor = new native.NativeSupervisor(
        root,
        plan.services,
        { onLine: (_name, line) => lines.push(line) },
        { baseEnv: { API_TOKEN: token } },
      );
      native.supervisors.push(supervisor);

      const failures = await supervisor.start();
      const stored = native.readFileSync(logPath, "utf-8");
      const [failure] = native.withFailureLogs(root, failures);

      expect(failures).toMatchObject([{ name: "crasher", reason: "the job did not exit 0" }]);
      expect(lines).toContain("FATAL: API_TOKEN is not set ([REDACTED])");
      expect(stored).toContain("FATAL: API_TOKEN is not set ([REDACTED])");
      expect(stored).not.toContain(token);
      expect(failure?.logs?.join("\n")).toContain("FATAL: API_TOKEN is not set ([REDACTED])");
    });
  });

  describe("shellInvocation", () => {
    it("runs a command line through /bin/sh -c on POSIX, unchanged", () => {
      expect(native.shellInvocation("PORT=1 node s.js && echo $PORT", "linux")).toEqual({
        file: "/bin/sh",
        args: ["-c", "PORT=1 node s.js && echo $PORT"],
        windowsVerbatimArguments: false,
      });
    });

    it("runs it the way Node's shell option does on Windows: ComSpec /d /s /c with the line quoted verbatim", () => {
      expect(
        native.shellInvocation("set X=1 && node s.js", "win32", "C:\\Windows\\System32\\cmd.exe"),
      ).toEqual({
        file: "C:\\Windows\\System32\\cmd.exe",
        args: ["/d", "/s", "/c", '"set X=1 && node s.js"'],
        windowsVerbatimArguments: true,
      });
      expect(native.shellInvocation("node s.js", "win32", "").file).toBe("cmd.exe");
    });
  });

  describe("signalGroup", () => {
    it("ends the whole process tree on Windows, where a kill reaches only the shell", () => {
      const killed: number[] = [];
      native.signalGroup(4321, "SIGTERM", "win32", (pid) => killed.push(pid));
      expect(killed).toEqual([4321]);
    });

    it("signals the process group on POSIX and never runs taskkill", () => {
      const child = native.spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        detached: true,
        stdio: "ignore",
      });
      const pid = child.pid as number;
      const killed: number[] = [];
      native.signalGroup(pid, "SIGKILL", "linux", (p) => killed.push(p));
      expect(killed).toEqual([]);
      return new Promise<void>((resolve) => child.once("exit", () => resolve()));
    });
  });
});
