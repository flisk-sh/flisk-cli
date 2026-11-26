// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import {
  createJsonEmitterMock,
  describe,
  downCommand,
  downTestContext,
  expect,
  it,
  listProjectArtifactsMock,
  planProjectNetworkPruneMock,
  pruneProjectNetworksMock,
  rmSync,
  runTiltMock,
  setupTestProject,
  vi,
} from "../../test-support/down.js";

describe("flisk down --prune-networks preview", () => {
  downTestContext();

  describe("--prune-networks --dry-run (#3864)", () => {
    const PLAN = {
      remove: ["test_project_backend"],
      keep: [{ name: "test_project_database", reason: "1 container is attached" }],
    };

    it("lists the networks it would remove and keep, and removes nothing", async () => {
      setupTestProject();
      planProjectNetworkPruneMock.mockReturnValue(PLAN);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      await downCommand.parseAsync(["node", "flisk", "--prune-networks", "--dry-run"], {
        from: "node",
      });

      // The stacks down stops first are passed, so their containers do not keep a network (#3875).
      expect(planProjectNetworkPruneMock).toHaveBeenCalledWith("test-project", undefined, [
        "demo-traefik",
      ]);
      expect(pruneProjectNetworksMock).not.toHaveBeenCalled();
      expect(runTiltMock).not.toHaveBeenCalled();
      const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain("network prune would remove: test_project_backend");
      expect(output).toContain("would keep: test_project_database (1 container is attached)");
    });

    it("previews by default, without --prune-networks (pruning is on by default)", async () => {
      setupTestProject();
      planProjectNetworkPruneMock.mockReturnValue(PLAN);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      await downCommand.parseAsync(["node", "flisk", "--dry-run"], { from: "node" });

      expect(planProjectNetworkPruneMock).toHaveBeenCalled();
      expect(pruneProjectNetworksMock).not.toHaveBeenCalled();
      const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain("network prune would remove: test_project_backend");
    });

    it("does not preview with --no-prune-networks", async () => {
      setupTestProject();
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      await downCommand.parseAsync(["node", "flisk", "--no-prune-networks", "--dry-run"], {
        from: "node",
      });

      expect(planProjectNetworkPruneMock).not.toHaveBeenCalled();
    });

    it("says <none> when there is nothing to remove or keep", async () => {
      setupTestProject();
      planProjectNetworkPruneMock.mockReturnValue({ remove: [], keep: [] });
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      await downCommand.parseAsync(["node", "flisk", "--prune-networks", "--dry-run"], {
        from: "node",
      });

      const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain("network prune would remove: <none>");
      expect(output).toContain("would keep: <none>");
    });

    it("emits wouldPruneNetworks in JSON", async () => {
      setupTestProject();
      planProjectNetworkPruneMock.mockReturnValue(PLAN);
      const emitMock = vi.fn();
      createJsonEmitterMock.mockReturnValue(emitMock);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      await downCommand.parseAsync(["node", "flisk", "--prune-networks", "--dry-run", "--json"], {
        from: "node",
      });

      expect(pruneProjectNetworksMock).not.toHaveBeenCalled();
      expect(emitMock).toHaveBeenCalledWith({ ok: true, dryRun: true, wouldPruneNetworks: PLAN });
    });

    it("leaves the preview to --purge when both are given", async () => {
      setupTestProject();
      listProjectArtifactsMock.mockReturnValue({
        containers: [],
        volumes: [],
        networks: [],
        images: [],
      });
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      await downCommand.parseAsync(["node", "flisk", "--purge", "--prune-networks", "--dry-run"], {
        from: "node",
      });

      expect(planProjectNetworkPruneMock).not.toHaveBeenCalled();
    });

    it("warns and still previews the rest when the networks cannot be checked", async () => {
      setupTestProject();
      planProjectNetworkPruneMock.mockImplementation(() => {
        throw new Error("docker not found");
      });
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      await downCommand.parseAsync(["node", "flisk", "--prune-networks", "--dry-run"], {
        from: "node",
      });

      const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain("Could not check networks: docker not found");
      expect(output).not.toContain("would remove");
      expect(pruneProjectNetworksMock).not.toHaveBeenCalled();
    });
  });
});
