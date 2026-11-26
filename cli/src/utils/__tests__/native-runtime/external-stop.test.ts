// biome-ignore-all lint/suspicious/noTemplateCurlyInString: literal shell and migrator references are test fixtures
// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { native } from "../../test-support/native-runtime.js";

describe("stopping a native run from another process", () => {
  native.nativeTestContext();

  it("stops service processes a killed supervisor left behind", async () => {
    const root = native.createTempDir();
    const orphan = native.spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    await new Promise<void>((resolve, reject) => {
      orphan.once("spawn", resolve);
      orphan.once("error", reject);
    });
    orphan.unref();
    try {
      const deadSupervisor = native.spawn(process.execPath, ["-e", ""]);
      await new Promise((resolve) => deadSupervisor.once("exit", resolve));
      native.mkdirSync(native.join(root, ".flisk", "native"), { recursive: true });
      native.writeFileSync(
        native.nativeRunStatePath(root),
        JSON.stringify({
          pid: deadSupervisor.pid,
          startedAt: new Date().toISOString(),
          services: {
            api: {
              pid: orphan.pid,
              startTime: await native.processStartTime(orphan.pid as number),
            },
          },
        }),
      );

      expect(await native.stopNativeRun(root)).toEqual({
        wasRunning: true,
        services: ["api"],
        supervisorPid: deadSupervisor.pid,
      });
      await native.waitFor(() => !native.isProcessAlive(orphan.pid as number));
      expect(native.existsSync(native.nativeRunStatePath(root))).toBe(false);
      expect(await native.stopNativeRun(root)).toEqual({ wasRunning: false, services: [] });
    } finally {
      // Fail-safe: a failure before stopNativeRun() must not leave the detached child running.
      const orphanPid = orphan.pid as number;
      if (native.isProcessAlive(orphanPid)) {
        try {
          process.kill(orphanPid, "SIGKILL");
        } catch {
          // already gone
        }
        await native.waitFor(() => !native.isProcessAlive(orphanPid));
      }
    }
  });
});
