// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { join } from "node:path";
import {
  describe,
  downCommand,
  downTestContext,
  dropCheckoutDatabasesMock,
  expect,
  foreignOwnersMock,
  it,
  listProjectArtifactsMock,
  pruneProjectNetworksMock,
  realpathSync,
  removeProjectArtifactsMock,
  rmSync,
  runTiltMock,
  setupTestProject,
  vi,
  writeFileSync,
} from "../../test-support/down.js";

describe("flisk down --purge", () => {
  const { downFails, originalCwd } = downTestContext();

  describe("--purge", () => {
    const ARTIFACTS = {
      containers: [],
      volumes: ["test-project-database-management_test_project_postgres_data"],
      networks: ["test_project_backend"],
      images: ["test-project-l1:latest", "test_project_main_api:dev"],
    };

    it("after tilt down, drops this checkout's databases and deletes the project's networks and images", async () => {
      const tempDir = setupTestProject();
      listProjectArtifactsMock.mockReturnValue(ARTIFACTS);
      removeProjectArtifactsMock.mockReturnValue({
        removed: { ...ARTIFACTS, volumes: [] },
        kept: [],
      });
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      await downCommand.parseAsync(["node", "flisk", "--purge"], { from: "node" });

      try {
        expect(runTiltMock).toHaveBeenCalledWith("down", expect.anything(), expect.anything());
        // Exact names come from the project's stacks, including one it no longer has that is still on record.
        expect(listProjectArtifactsMock).toHaveBeenCalledWith("test-project", {
          stacks: ["retired"],
          knownNames: ["test-project", "test-project-admin"],
          roots: ["/here", tempDir],
        });
        // The shared Postgres volume stays: a linked worktree's down must not destroy the main checkout's data (#4698).
        expect(removeProjectArtifactsMock).toHaveBeenCalledWith({ ...ARTIFACTS, volumes: [] });
        expect(dropCheckoutDatabasesMock).toHaveBeenCalledWith("test-project", "");
        expect(runTiltMock.mock.invocationCallOrder[0]).toBeLessThan(
          removeProjectArtifactsMock.mock.invocationCallOrder[0] ?? 0,
        );
        // --purge covers the networks, so the separate network prune does not run as well.
        expect(pruneProjectNetworksMock).not.toHaveBeenCalled();
        const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
        expect(output).toContain("Removed 3 Docker objects of test-project");
        expect(output).toContain(
          "Dropped test-project databases of this checkout: test_project_api",
        );
        expect(output).not.toContain(
          "volumes: test-project-database-management_test_project_postgres_data",
        );
      } finally {
        process.chdir(originalCwd);
        rmSync(tempDir, { recursive: true, force: true });
        log.mockRestore();
      }
    });

    it("in a linked worktree drops only that checkout's databases and keeps the shared volume (#4698)", async () => {
      const tempDir = setupTestProject();
      writeFileSync(join(tempDir, ".git"), "gitdir: /elsewhere/.git/worktrees/task\n", "utf8");
      writeFileSync(
        join(tempDir, ".flisk", ".project-id"),
        JSON.stringify({ id: "abcd1234", path: realpathSync(tempDir) }),
        "utf8",
      );
      listProjectArtifactsMock.mockReturnValue(ARTIFACTS);
      removeProjectArtifactsMock.mockReturnValue({
        removed: { containers: [], volumes: [], networks: [], images: [] },
        kept: [],
      });
      dropCheckoutDatabasesMock.mockReturnValue({
        suffix: "_abcd1234",
        dropped: ["test_project_api_abcd1234"],
        kept: [],
      });
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      try {
        await downCommand.parseAsync(["node", "flisk", "--purge"], { from: "node" });

        expect(dropCheckoutDatabasesMock).toHaveBeenCalledWith("test-project", "_abcd1234");
        expect(removeProjectArtifactsMock).toHaveBeenCalledWith({ ...ARTIFACTS, volumes: [] });
        const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
        expect(output).toContain("test_project_api_abcd1234");
      } finally {
        process.chdir(originalCwd);
        rmSync(tempDir, { recursive: true, force: true });
        log.mockRestore();
      }
    });

    it("reports what Docker kept", async () => {
      setupTestProject();
      listProjectArtifactsMock.mockReturnValue(ARTIFACTS);
      removeProjectArtifactsMock.mockReturnValue({
        removed: { containers: [], volumes: [], networks: [], images: [] },
        kept: [{ kind: "volumes", name: "v1", reason: "volume is in use" }],
      });
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      await downCommand.parseAsync(["node", "flisk", "--purge"], { from: "node" });

      const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain("Kept volume v1: volume is in use");
    });

    it("with --dry-run lists what it would delete and deletes nothing", async () => {
      setupTestProject();
      listProjectArtifactsMock.mockReturnValue(ARTIFACTS);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      await downCommand.parseAsync(["node", "flisk", "--purge", "--dry-run"], { from: "node" });

      expect(removeProjectArtifactsMock).not.toHaveBeenCalled();
      expect(runTiltMock).not.toHaveBeenCalled();
      const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain("--purge would delete");
      expect(output).toContain("images: test-project-l1:latest, test_project_main_api:dev");
    });

    it("refuses when another folder with this project name has containers, and removes nothing (#3961)", async () => {
      const tempDir = setupTestProject();
      foreignOwnersMock.mockReturnValue([
        { root: "/other/test-project", containers: ["test-project_postgres"] },
      ]);
      listProjectArtifactsMock.mockReturnValue(ARTIFACTS);

      const output = await downFails(tempDir, ["--purge"]);

      expect(removeProjectArtifactsMock).not.toHaveBeenCalled();
      expect(runTiltMock).not.toHaveBeenCalled();
      expect(output).toContain("/other/test-project");
      expect(output).toContain("Nothing was removed.");
    });

    it("also refuses with --dry-run, so the preview never lists another folder's data (#3961)", async () => {
      const tempDir = setupTestProject();
      foreignOwnersMock.mockReturnValue([
        { root: "/other/test-project", containers: ["test-project_postgres"] },
      ]);
      listProjectArtifactsMock.mockReturnValue(ARTIFACTS);

      await downFails(tempDir, ["--purge", "--dry-run"]);

      expect(listProjectArtifactsMock).not.toHaveBeenCalled();
      expect(removeProjectArtifactsMock).not.toHaveBeenCalled();
    });

    it("a plain down never asks which folders share the name", async () => {
      setupTestProject();
      foreignOwnersMock.mockReturnValue([{ root: "/other/test-project", containers: ["x"] }]);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      await downCommand.parseAsync(["node", "flisk"], { from: "node" });

      expect(foreignOwnersMock).not.toHaveBeenCalled();
      expect(runTiltMock).toHaveBeenCalled();
    });

    it("without --purge keeps volumes and images", async () => {
      setupTestProject();
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      await downCommand.parseAsync(["node", "flisk"], { from: "node" });

      // Only a read for the report of what is still held; nothing is removed.
      expect(removeProjectArtifactsMock).not.toHaveBeenCalled();
    });
  });
});
