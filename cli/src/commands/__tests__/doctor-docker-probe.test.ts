// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureExit } from "../../test-support/index.js";
import type { CheckResult } from "../../types/index.js";
import { doctorCommand } from "../doctor.js";

describe("doctor docker probe flags", () => {
  let root: string;
  let originalCwd: string;

  afterEach(() => {
    doctorCommand.setOptionValue("dockerProbe", true);
    doctorCommand.setOptionValue("dockerProbeTimeout", "15000");
    doctorCommand.setOptionValue("json", false);
    doctorCommand.setOptionValue("ping", true);
    doctorCommand.setOptionValue("all", false);
    if (root) {
      process.chdir(originalCwd);
      rmSync(root, { recursive: true, force: true });
      root = "";
    }
    vi.restoreAllMocks();
  });

  it("registers --no-docker-probe and --docker-probe-timeout", () => {
    const flags = doctorCommand.options.map((opt) => opt.long);
    expect(flags).toContain("--no-docker-probe");
    expect(flags).toContain("--docker-probe-timeout");
  });

  it.each(["0", "-5", "abc", "1.5", ""])(
    "rejects --docker-probe-timeout %s with exit 2",
    async (value) => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const { exit } = captureExit();
      try {
        await doctorCommand.parseAsync(["--docker-probe-timeout", value], { from: "user" });
      } catch {
        // process.exit throws in tests
      }
      expect(exit).toHaveBeenCalledWith(2);
      expect(error).toHaveBeenCalledWith(
        "--docker-probe-timeout must be a positive integer number of milliseconds",
      );
      exit.mockRestore();
      log.mockRestore();
      error.mockRestore();
    },
  );

  it("returns a usage envelope for an invalid --docker-probe-timeout under --json", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { exit } = captureExit();
    try {
      await doctorCommand.parseAsync(["--json", "--docker-probe-timeout", "nope"], {
        from: "user",
      });
    } catch {
      // process.exit throws in tests
    }
    expect(exit).toHaveBeenCalledWith(2);
    const envelope = log.mock.calls
      .map((call) => {
        try {
          return JSON.parse(String(call[0])) as {
            data: unknown;
            errors?: { code: string; message?: string }[];
          };
        } catch {
          return undefined;
        }
      })
      .find((parsed) => parsed?.errors);
    expect(envelope?.data).toBeNull();
    expect(envelope?.errors?.[0]?.code).toBe("USAGE");
    expect(envelope?.errors?.[0]?.message).toBe(
      "--docker-probe-timeout must be a positive integer number of milliseconds",
    );
    exit.mockRestore();
    log.mockRestore();
  });

  it("--no-docker-probe skips the bind-mount probe without needing Docker", async () => {
    root = mkdtempSync(join(tmpdir(), "flisk-doctor-no-probe-"));
    originalCwd = process.cwd();
    process.chdir(root);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { exit } = captureExit();
    try {
      await doctorCommand.parseAsync(["--json", "--no-docker-probe", "--no-ping"], {
        from: "user",
      });
    } catch {
      // process.exit throws when checks fail
    }
    const envelope = log.mock.calls
      .map((call) => {
        try {
          return JSON.parse(String(call[0])) as { data?: { checks?: CheckResult[] } };
        } catch {
          return undefined;
        }
      })
      .find((parsed) => Array.isArray(parsed?.data?.checks));
    const probe = envelope?.data?.checks?.find((check) => check.name === "Docker File Sharing");
    expect(probe?.isSkipped).toBe(true);
    expect(probe?.message).toContain("--no-docker-probe");
    exit.mockRestore();
    log.mockRestore();
  });
});
