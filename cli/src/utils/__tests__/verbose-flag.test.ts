// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { COMMAND_SPECS } from "../../commands/command-specs.generated.js";
import {
  createTempProject,
  installFakeContainerTools,
  runFlisk,
  validProjectJson,
} from "../../test-support/index.js";
import { applyGlobalVerboseFlag } from "../verbose-flag.js";

describe("applyGlobalVerboseFlag (#3890)", () => {
  it("takes `--verbose` out of argv for a command that does not declare it", () => {
    expect(applyGlobalVerboseFlag(["networks", "--verbose"], COMMAND_SPECS)).toEqual({
      args: ["networks"],
      verbose: true,
    });
    expect(applyGlobalVerboseFlag(["logs", "svc", "--verbose"], COMMAND_SPECS)).toEqual({
      args: ["logs", "svc"],
      verbose: true,
    });
    expect(applyGlobalVerboseFlag(["config", "verify", "--verbose"], COMMAND_SPECS)).toEqual({
      args: ["config", "verify"],
      verbose: true,
    });
  });

  it("keeps `--verbose` before the subcommand, where the root option binds", () => {
    expect(applyGlobalVerboseFlag(["--verbose", "networks"], COMMAND_SPECS)).toEqual({
      args: ["--verbose", "networks"],
      verbose: true,
    });
  });

  it("keeps `--verbose` for commands that declare it themselves", () => {
    for (const args of [
      ["status", "--verbose"],
      ["stacks", "--verbose"],
      ["resources", "--verbose"],
      ["up", "--verbose"],
      ["down", "--verbose"],
      ["ui", "--verbose"],
      ["version", "--verbose"],
      ["agent", "list", "--verbose"],
      ["status", "extra", "--verbose"],
    ]) {
      expect(applyGlobalVerboseFlag(args, COMMAND_SPECS), args.join(" ")).toEqual({
        args,
        verbose: true,
      });
    }
  });

  it("strips `--verbose` on a command group that does not declare it", () => {
    expect(applyGlobalVerboseFlag(["agent", "--verbose"], COMMAND_SPECS)).toEqual({
      args: ["agent"],
      verbose: true,
    });
    expect(
      applyGlobalVerboseFlag(["agent", "sessions", "svc", "--verbose"], COMMAND_SPECS),
    ).toEqual({ args: ["agent", "sessions", "svc"], verbose: true });
  });

  it("leaves everything after `--` alone, so `flisk run x -- tool --verbose` passes it on", () => {
    const args = ["run", "svc", "--", "tool", "--verbose"];
    expect(applyGlobalVerboseFlag(args, COMMAND_SPECS)).toEqual({ args, verbose: false });
    expect(applyGlobalVerboseFlag(["--verbose", ...args], COMMAND_SPECS)).toEqual({
      args: ["--verbose", ...args],
      verbose: true,
    });
  });

  it("skips option values instead of mistaking them for the subcommand", () => {
    expect(
      applyGlobalVerboseFlag(["--project", "networks", "status", "--verbose"], COMMAND_SPECS),
    ).toEqual({ args: ["--project", "networks", "status", "--verbose"], verbose: true });
    expect(
      applyGlobalVerboseFlag(["networks", "--stack", "prod", "--verbose"], COMMAND_SPECS),
    ).toEqual({ args: ["networks", "--stack", "prod"], verbose: true });
    expect(
      applyGlobalVerboseFlag(["networks", "--stack=prod", "--verbose"], COMMAND_SPECS),
    ).toEqual({ args: ["networks", "--stack=prod"], verbose: true });
  });

  it("keeps both spellings independent: a pre-command flag stays, a post-command one goes", () => {
    expect(applyGlobalVerboseFlag(["--verbose", "networks", "--verbose"], COMMAND_SPECS)).toEqual({
      args: ["--verbose", "networks"],
      verbose: true,
    });
  });

  it("strips `--verbose` after a word that is not a command", () => {
    // `demo` is a template name handled before Commander, and `help` is commander's own
    // command: neither declares `--verbose`, but accepting it is harmless for both.
    expect(applyGlobalVerboseFlag(["demo", "--verbose"], COMMAND_SPECS)).toEqual({
      args: ["demo"],
      verbose: true,
    });
    expect(applyGlobalVerboseFlag(["help", "networks", "--verbose"], COMMAND_SPECS)).toEqual({
      args: ["help", "networks"],
      verbose: true,
    });
  });

  it("reports no verbose flag when there is none", () => {
    expect(applyGlobalVerboseFlag([], COMMAND_SPECS)).toEqual({ args: [], verbose: false });
    expect(applyGlobalVerboseFlag(["networks"], COMMAND_SPECS)).toEqual({
      args: ["networks"],
      verbose: false,
    });
    expect(applyGlobalVerboseFlag(["networks", "-v"], COMMAND_SPECS)).toEqual({
      args: ["networks", "-v"],
      verbose: false,
    });
  });
});

describe("flisk <cmd> --verbose on the built CLI (#3890)", () => {
  // A host FLISK_VERBOSE must not leak into the runs that prove the flag sets it.
  const quiet = { FLISK_VERBOSE: undefined } as const;

  const VALID_PROJECT_JSON = validProjectJson({
    name: "verbtest",
    discoveryPaths: ["services/**"],
  });

  function networksProject(): string {
    return createTempProject({
      projectJson: VALID_PROJECT_JSON,
      stacks: { app: { api: { appType: "backend", port: 59991 } } },
    });
  }

  it("accepts `--verbose` after the subcommand everywhere, not only where declared", () => {
    const cwd = createTempProject({ projectJson: null });
    for (const args of [
      ["networks", "--verbose"],
      ["logs", "--verbose"],
      ["status", "--verbose"],
      ["stacks", "--verbose"],
      ["projects", "--verbose"],
      ["config", "--verbose"],
      ["agent", "list", "--verbose"],
      ["version", "--verbose"],
    ]) {
      const result = runFlisk(args, { cwd, env: quiet });
      expect(result.stderr, args.join(" ")).not.toContain("unknown option '--verbose'");
    }
  });

  it("`flisk networks --verbose` equals `FLISK_VERBOSE=1 flisk networks`", () => {
    const cwd = networksProject();
    const viaFlag = runFlisk(["networks", "--verbose"], { cwd, env: quiet });
    const viaRoot = runFlisk(["--verbose", "networks"], { cwd, env: quiet });
    const viaEnv = runFlisk(["networks"], { cwd, env: { FLISK_VERBOSE: "1" } });
    for (const run of [viaFlag, viaRoot]) {
      expect(run.status).toBe(viaEnv.status);
      expect(run.stdout).toBe(viaEnv.stdout);
      expect(run.stderr).toBe(viaEnv.stderr);
    }
  });

  it.runIf(process.platform !== "win32")(
    "prints the error details under every spelling of --verbose",
    () => {
      // The stub Docker answers `docker ps`, so `networks` runs its HTTP check; the
      // unreachable 127.0.0.1:1 base URL makes it fail and logVerbose prints the detail
      // line only when FLISK_VERBOSE is on.
      const restore = installFakeContainerTools();
      try {
        const cwd = networksProject();
        const base = { FLISK_SERVICE_BASE_URL: "http://127.0.0.1:1" } as const;
        const viaFlag = runFlisk(["networks", "--verbose"], {
          cwd,
          env: { ...base, ...quiet },
        });
        const viaRoot = runFlisk(["--verbose", "networks"], {
          cwd,
          env: { ...base, ...quiet },
        });
        const viaEnv = runFlisk(["networks"], {
          cwd,
          env: { ...base, FLISK_VERBOSE: "1" },
        });
        const plain = runFlisk(["networks"], { cwd, env: { ...base, ...quiet } });
        expect(viaEnv.stderr).toContain("HTTP check error details");
        expect(plain.stderr).not.toContain("HTTP check error details");
        expect(viaFlag.stderr).toBe(viaEnv.stderr);
        expect(viaRoot.stderr).toBe(viaEnv.stderr);
      } finally {
        restore();
      }
    },
  );

  it("still rejects a flag nothing knows", () => {
    const cwd = createTempProject({ projectJson: null });
    const result = runFlisk(["networks", "--bogus"], { cwd, env: quiet });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("unknown option '--bogus'");
  });

  it("keeps `flisk version --verbose` showing the verbose version", () => {
    const cwd = createTempProject({ projectJson: null });
    const plain = runFlisk(["version"], { cwd, env: quiet });
    const viaFlag = runFlisk(["version", "--verbose"], { cwd, env: quiet });
    const viaRoot = runFlisk(["--verbose", "version"], { cwd, env: quiet });
    expect(plain.status).toBe(0);
    expect(plain.stdout.trim()).not.toContain("(");
    for (const run of [viaFlag, viaRoot]) {
      expect(run.status).toBe(0);
      expect(run.stdout.trim()).toMatch(/^\d+\.\d+\.\d+ \([0-9a-f]+\)$/);
    }
  });
});
