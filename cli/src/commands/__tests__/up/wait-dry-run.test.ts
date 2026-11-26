// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import {
  afterEach,
  beforeEach,
  describe,
  discoverResourcesStrict,
  expect,
  findProjectRoot,
  it,
  makeResource,
  requireProjectRoot,
  stripVTControlCharacters,
  stubGeneratedProject,
  upAndWait,
  upCommand,
  verifyMasterConfigs,
  vi,
} from "../../test-support/up.js";

describe("flisk up --wait --dry-run (#3696)", () => {
  beforeEach(() => {
    stubGeneratedProject();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("prints the dry-run plan, never a healthy stack, and never spawns the wait child", async () => {
    vi.mocked(discoverResourcesStrict).mockReturnValueOnce([
      makeResource("api", "backend", { schemaVersion: 1, port: 8080 }),
    ]);
    vi.mocked(upAndWait).mockClear();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await upCommand.parseAsync(["--wait", "--dry-run"], { from: "user" });
    } catch {
      // Later dry-run steps need a real project; reaching them still proves the wait path was skipped.
    } finally {
      // Commander keeps option values between parses; leave no flags behind for the next test.
      upCommand.setOptionValue("wait", false);
      upCommand.setOptionValue("dryRun", false);
    }

    const output = stripVTControlCharacters(log.mock.calls.flat().join("\n"));
    expect(upAndWait).not.toHaveBeenCalled();
    expect(output).toContain("Would start 1 service");
    expect(output).not.toContain("Stack is healthy");
    log.mockRestore();
    error.mockRestore();
  });
});
