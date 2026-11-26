// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FliskError } from "../../utils/errors.js";
import { reposCommand } from "../repos.js";

const { readProjectConfigMock, requireProjectRootMock, cloneMissingReposMock } = vi.hoisted(() => ({
  readProjectConfigMock: vi.fn(),
  requireProjectRootMock: vi.fn(() => "/mock/project/root"),
  cloneMissingReposMock: vi.fn(),
}));

vi.mock("../../generator/template-engine.js", () => ({
  readProjectConfig: readProjectConfigMock,
}));

vi.mock("../../utils/errors.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/errors.js")>()),
  requireProjectRoot: requireProjectRootMock,
}));

vi.mock("../../utils/project-repos.js", async (importOriginal) => ({
  // `selectConfiguredRepos` is a pure filter and keeps its real implementation; only the git
  // clone itself is stubbed so no repository is downloaded.
  ...(await importOriginal<typeof import("../../utils/project-repos.js")>()),
  cloneMissingRepos: cloneMissingReposMock,
}));

describe("repos command", () => {
  beforeEach(() => {
    // Commander keeps option values between parses; leave no --dry-run behind for the next test.
    const clone = reposCommand.commands.find((command) => command.name() === "clone");
    for (const option of clone?.options ?? []) {
      clone?.setOptionValue(option.attributeName(), undefined);
    }
    cloneMissingReposMock.mockClear();
  });

  afterEach(() => {
    requireProjectRootMock.mockReturnValue("/mock/project/root");
  });

  /** A dry run reads the destination folders, so it needs a project root that exists. */
  function setUpRealProjectRoot(): string {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "flisk-repos-dry-run-"));
    requireProjectRootMock.mockReturnValue(root);
    return root;
  }

  it("defines repos and clone sub-command", () => {
    expect(reposCommand.name()).toBe("repos");
    expect(reposCommand.description()).toBe(
      "List or clone the Git repositories configured in .flisk/project.json",
    );
    const clone = reposCommand.commands.find((c) => c.name() === "clone");
    expect(clone).toBeDefined();
    expect(clone?.options.some((o) => o.long === "--json")).toBe(true);
    expect(clone?.options.some((o) => o.long === "--dry-run")).toBe(true);
  });

  it("handles empty repos configuration without error", async () => {
    readProjectConfigMock.mockReturnValue({ name: "mock-proj", repos: [] });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await reposCommand.parseAsync(["node", "flisk", "clone"]);

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("No external repositories configured"),
    );
    logSpy.mockRestore();
  });

  it("outputs valid JSON envelope with --json when empty", async () => {
    readProjectConfigMock.mockReturnValue({ name: "mock-proj", repos: [] });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await reposCommand.parseAsync(["node", "flisk", "clone", "--json"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output).toEqual({
      schemaVersion: 1,
      data: { results: [], cloned: [], existing: [] },
      errors: [],
    });
    logSpy.mockRestore();
  });

  it("clones missing repos and logs results", async () => {
    readProjectConfigMock.mockReturnValue({
      name: "mock-proj",
      repos: [
        { url: "https://github.com/acme/orders.git", dir: "services/orders" },
        { url: "https://github.com/acme/billing.git", dir: "services/billing" },
      ],
    });
    cloneMissingReposMock.mockResolvedValue([
      {
        url: "https://github.com/acme/orders.git",
        dir: "services/orders",
        cloned: true,
        skipped: false,
        failed: false,
      },
      {
        url: "https://github.com/acme/billing.git",
        dir: "services/billing",
        cloned: false,
        skipped: true,
        failed: false,
      },
    ]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await reposCommand.parseAsync(["node", "flisk", "clone"]);

    expect(cloneMissingReposMock).toHaveBeenCalledWith("/mock/project/root", [
      { url: "https://github.com/acme/orders.git", dir: "services/orders" },
      { url: "https://github.com/acme/billing.git", dir: "services/billing" },
    ]);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Cloned"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Kept existing"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("1 cloned, 1 skipped"));
    logSpy.mockRestore();
  });

  it("clones only the named repository when dirs are given", async () => {
    readProjectConfigMock.mockReturnValue({
      name: "mock-proj",
      repos: [
        { url: "https://github.com/acme/orders.git", dir: "services/orders" },
        { url: "https://github.com/acme/billing.git", dir: "services/billing" },
      ],
    });
    cloneMissingReposMock.mockClear();
    cloneMissingReposMock.mockResolvedValue([
      {
        url: "https://github.com/acme/billing.git",
        dir: "services/billing",
        cloned: true,
        skipped: false,
      },
    ]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await reposCommand.parseAsync(["node", "flisk", "clone", "services/billing"]);

    // The other configured repository is never handed to the clone routine, so it stays untouched.
    expect(cloneMissingReposMock).toHaveBeenCalledWith("/mock/project/root", [
      { url: "https://github.com/acme/billing.git", dir: "services/billing" },
    ]);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Cloned"));
    logSpy.mockRestore();
  });

  it("clones several named repositories in configuration order", async () => {
    readProjectConfigMock.mockReturnValue({
      name: "mock-proj",
      repos: [
        { url: "https://github.com/acme/orders.git", dir: "services/orders" },
        { url: "https://github.com/acme/billing.git", dir: "services/billing" },
        { url: "https://github.com/acme/search.git", dir: "services/search" },
      ],
    });
    cloneMissingReposMock.mockClear();
    cloneMissingReposMock.mockResolvedValue([]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await reposCommand.parseAsync(["node", "flisk", "clone", "services/search", "services/orders"]);

    expect(cloneMissingReposMock).toHaveBeenCalledWith("/mock/project/root", [
      { url: "https://github.com/acme/orders.git", dir: "services/orders" },
      { url: "https://github.com/acme/search.git", dir: "services/search" },
    ]);
    logSpy.mockRestore();
  });

  it("fails with exit code 1 and the valid dirs for an unknown repository", async () => {
    readProjectConfigMock.mockReturnValue({
      name: "mock-proj",
      repos: [
        { url: "https://github.com/acme/orders.git", dir: "services/orders" },
        { url: "https://github.com/acme/billing.git", dir: "services/billing" },
      ],
    });
    cloneMissingReposMock.mockClear();

    const error = await reposCommand
      .parseAsync(["node", "flisk", "clone", "nope"])
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(FliskError);
    expect((error as FliskError).exitCode).toBe(1);
    expect((error as FliskError).message).toContain("nope");
    expect((error as FliskError).message).toContain("services/orders");
    expect((error as FliskError).message).toContain("services/billing");
    expect((error as FliskError).suggestions.join("\n")).toContain("flisk repos list");
    // Nothing is cloned when a named dir is unknown.
    expect(cloneMissingReposMock).not.toHaveBeenCalled();
  });

  it("writes an UNKNOWN_REPO envelope for an unknown repository with --json", async () => {
    readProjectConfigMock.mockReturnValue({
      name: "mock-proj",
      repos: [
        { url: "https://github.com/acme/orders.git", dir: "services/orders" },
        { url: "https://github.com/acme/billing.git", dir: "services/billing" },
      ],
    });
    cloneMissingReposMock.mockClear();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await reposCommand.parseAsync(["node", "flisk", "clone", "nope", "--json"]);

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output.data).toBeNull();
    expect(output.errors[0].code).toBe("UNKNOWN_REPO");
    expect(output.errors[0].message).toContain("nope");
    expect(output.errors[0].message).toContain("services/orders");
    expect(process.exitCode).toBe(1);
    expect(cloneMissingReposMock).not.toHaveBeenCalled();
    process.exitCode = 0;
    logSpy.mockRestore();
  });

  it("outputs structured data in JSON mode", async () => {
    readProjectConfigMock.mockReturnValue({
      name: "mock-proj",
      repos: [{ url: "https://github.com/acme/orders.git", dir: "services/orders" }],
    });
    cloneMissingReposMock.mockResolvedValue([
      {
        url: "https://github.com/acme/orders.git",
        dir: "services/orders",
        cloned: true,
        skipped: false,
        failed: false,
      },
    ]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await reposCommand.parseAsync(["node", "flisk", "clone", "--json"]);

    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output.schemaVersion).toBe(1);
    expect(output.data.results).toEqual([
      { url: "https://github.com/acme/orders.git", dir: "services/orders", status: "cloned" },
    ]);
    expect(output.data.cloned).toEqual([
      { url: "https://github.com/acme/orders.git", dir: "services/orders" },
    ]);
    expect(output.data.existing).toEqual([]);
    expect(output.errors).toEqual([]);
    logSpy.mockRestore();
  });

  it("reports per-repository results and failures in --json when one clone fails", async () => {
    readProjectConfigMock.mockReturnValue({
      name: "mock-proj",
      repos: [
        { url: "https://unreachable.invalid/acme/orders.git", dir: "services/orders" },
        { url: "https://github.com/acme/billing.git", dir: "services/billing" },
      ],
    });
    cloneMissingReposMock.mockResolvedValue([
      {
        url: "https://unreachable.invalid/acme/orders.git",
        dir: "services/orders",
        cloned: false,
        skipped: false,
        failed: true,
        reason:
          'Failed to clone repository "https://unreachable.invalid/acme/orders.git" into "services/orders": could not resolve host',
      },
      {
        url: "https://github.com/acme/billing.git",
        dir: "services/billing",
        cloned: true,
        skipped: false,
        failed: false,
      },
    ]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await reposCommand.parseAsync(["node", "flisk", "clone", "--json"]);

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output.schemaVersion).toBe(1);
    expect(output.data.results).toEqual([
      {
        url: "https://unreachable.invalid/acme/orders.git",
        dir: "services/orders",
        status: "failed",
        reason: expect.stringContaining("could not resolve host"),
      },
      {
        url: "https://github.com/acme/billing.git",
        dir: "services/billing",
        status: "cloned",
      },
    ]);
    expect(output.data.cloned).toEqual([
      { url: "https://github.com/acme/billing.git", dir: "services/billing" },
    ]);
    expect(output.data.existing).toEqual([]);
    expect(output.errors).toHaveLength(1);
    expect(output.errors[0].code).toBe("REPO_CLONE_FAILED");
    expect(output.errors[0].message).toContain("could not resolve host");
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
    logSpy.mockRestore();
  });

  it("prints each outcome and a summary, exiting non-zero when any clone fails", async () => {
    readProjectConfigMock.mockReturnValue({
      name: "mock-proj",
      repos: [
        { url: "https://unreachable.invalid/acme/orders.git", dir: "services/orders" },
        { url: "https://github.com/acme/billing.git", dir: "services/billing" },
      ],
    });
    cloneMissingReposMock.mockResolvedValue([
      {
        url: "https://unreachable.invalid/acme/orders.git",
        dir: "services/orders",
        cloned: false,
        skipped: false,
        failed: true,
        reason: 'Failed to clone repository "https://unreachable.invalid/acme/orders.git"',
      },
      {
        url: "https://github.com/acme/billing.git",
        dir: "services/billing",
        cloned: true,
        skipped: false,
        failed: false,
      },
    ]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await reposCommand.parseAsync(["node", "flisk", "clone"]);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to clone"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("services/orders"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("1 cloned, 1 failed"));
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
    logSpy.mockRestore();
  });

  it("writes one REPOS_FAILED envelope on stdout when a clone fails with --json", async () => {
    readProjectConfigMock.mockReturnValue({
      name: "mock-proj",
      repos: [{ url: "https://github.com/acme/orders.git", dir: "services/orders" }],
    });
    cloneMissingReposMock.mockRejectedValue(new FliskError("Failed to clone repository"));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await reposCommand.parseAsync(["node", "flisk", "clone", "--json"]);

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output.data).toBeNull();
    expect(output.errors[0].code).toBe("REPOS_FAILED");
    expect(output.errors[0].message).toContain("Failed to clone repository");
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
    logSpy.mockRestore();
  });

  it("--dry-run --json lists what would be cloned, with branches, and never clones", async () => {
    readProjectConfigMock.mockReturnValue({
      name: "mock-proj",
      repos: [
        { url: "https://github.com/acme/orders.git", dir: "services/orders", branch: "develop" },
        { url: "https://github.com/acme/billing.git", dir: "services/billing" },
      ],
    });
    const root = setUpRealProjectRoot();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await reposCommand.parseAsync(["node", "flisk", "clone", "--dry-run", "--json"]);
    rmSync(root, { recursive: true, force: true });

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output).toEqual({
      schemaVersion: 1,
      data: {
        dryRun: true,
        cloned: [
          { url: "https://github.com/acme/orders.git", dir: "services/orders", branch: "develop" },
          { url: "https://github.com/acme/billing.git", dir: "services/billing" },
        ],
        existing: [],
      },
      errors: [],
    });
    expect(cloneMissingReposMock).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("--dry-run prints the plan and never clones", async () => {
    readProjectConfigMock.mockReturnValue({
      name: "mock-proj",
      repos: [
        { url: "https://github.com/acme/orders.git", dir: "services/orders", branch: "main" },
      ],
    });
    const root = setUpRealProjectRoot();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await reposCommand.parseAsync(["node", "flisk", "clone", "--dry-run"]);
    rmSync(root, { recursive: true, force: true });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Dry run -"));
    expect(logSpy).toHaveBeenCalledWith(
      "Would clone: https://github.com/acme/orders.git into services/orders (branch: main)",
    );
    expect(cloneMissingReposMock).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });
});
