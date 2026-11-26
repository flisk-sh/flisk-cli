// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import type { Mock } from "vitest";
import {
  createJsonEmitterMock,
  describe,
  downCommand,
  downTestContext,
  expect,
  it,
  pruneProjectNetworksMock,
  rmSync,
  setupTestProject,
  vi,
} from "../../test-support/down.js";

function expectPruneInvocation(log: Mock): string {
  expect(pruneProjectNetworksMock).toHaveBeenCalledTimes(1);
  expect(pruneProjectNetworksMock).toHaveBeenCalledWith("test-project");
  return log.mock.calls.map((call) => call.join(" ")).join("\n");
}

describe("flisk down --prune-networks", () => {
  downTestContext();

  describe("--prune-networks (pruneNetworksOrWarn)", () => {
    it("prunes project networks when the prune command succeeds", async () => {
      setupTestProject();
      pruneProjectNetworksMock.mockReturnValue({
        removed: ["test_project_backend", "test_project_database"],
        kept: [],
      });
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      await downCommand.parseAsync(["node", "flisk", "--prune-networks"], { from: "node" });

      const output = expectPruneInvocation(log);
      expect(output).toContain("Removed networks: test_project_backend, test_project_database");
      expect(output).not.toContain("Could not remove networks");
    });

    it("logs kept networks when Docker keeps in-use networks during a successful prune", async () => {
      setupTestProject();
      pruneProjectNetworksMock.mockReturnValue({
        removed: [],
        kept: [{ name: "test_project_proxy", reason: "network has active endpoints" }],
      });
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      await downCommand.parseAsync(["node", "flisk", "--prune-networks"], { from: "node" });

      const output = expectPruneInvocation(log);
      expect(output).not.toContain("Removed networks:");
      expect(output).toContain("Kept network test_project_proxy: network has active endpoints");
      expect(output).not.toContain("Could not remove networks");
    });

    it("logs a warning and does not throw when prune fails", async () => {
      setupTestProject();
      pruneProjectNetworksMock.mockImplementation(() => {
        throw new Error("docker daemon is unreachable");
      });
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      await expect(
        downCommand.parseAsync(["node", "flisk", "--prune-networks"], { from: "node" }),
      ).resolves.not.toThrow();

      const output = expectPruneInvocation(log);
      expect(output).toContain("Could not remove networks: docker daemon is unreachable");
    });

    it("includes pruned networks in machine output and suppresses human logs in JSON mode", async () => {
      setupTestProject();
      pruneProjectNetworksMock.mockReturnValue({
        removed: ["test_project_backend"],
        kept: [{ name: "test_project_proxy", reason: "network in use" }],
      });
      const emitMock = vi.fn();
      createJsonEmitterMock.mockReturnValue(emitMock);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      await downCommand.parseAsync(["node", "flisk", "--prune-networks", "--json"], {
        from: "node",
      });

      expect(pruneProjectNetworksMock).toHaveBeenCalledTimes(1);
      expect(pruneProjectNetworksMock).toHaveBeenCalledWith("test-project");

      const logged = log.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(logged).not.toContain("Removed networks:");
      expect(logged).not.toContain("Kept network");

      expect(emitMock).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: true,
          removedNetworks: ["test_project_backend"],
          keptNetworks: [{ name: "test_project_proxy", reason: "network in use" }],
        }),
      );
    });

    it("does not throw or print human warning in JSON mode when prune fails", async () => {
      setupTestProject();
      pruneProjectNetworksMock.mockImplementation(() => {
        throw new Error("docker daemon is unreachable");
      });
      const emitMock = vi.fn();
      createJsonEmitterMock.mockReturnValue(emitMock);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      await expect(
        downCommand.parseAsync(["node", "flisk", "--prune-networks", "--json"], {
          from: "node",
        }),
      ).resolves.not.toThrow();

      const logged = log.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(logged).not.toContain("Could not remove networks");

      expect(emitMock).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: true,
        }),
      );
      const emitted = emitMock.mock.calls[0]?.[0];
      expect(emitted?.removedNetworks).toBeUndefined();
      expect(emitted?.keptNetworks).toBeUndefined();
    });

    it("removes the project's unused networks by default, quietly about the ones Docker keeps (#3650)", async () => {
      setupTestProject();
      downCommand.setOptionValue("pruneNetworks", undefined);
      pruneProjectNetworksMock.mockReturnValue({
        removed: ["test_project_backend"],
        kept: [{ name: "test_project_proxy", reason: "network has active endpoints" }],
      });
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      await downCommand.parseAsync(["node", "flisk"], { from: "node" });

      expect(pruneProjectNetworksMock).toHaveBeenCalledTimes(1);
      expect(pruneProjectNetworksMock).toHaveBeenCalledWith("test-project");
      const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain("Removed networks: test_project_backend");
      expect(output).not.toContain("Kept network");
    });

    it("does not warn by default when Docker cannot be asked", async () => {
      setupTestProject();
      downCommand.setOptionValue("pruneNetworks", undefined);
      pruneProjectNetworksMock.mockImplementation(() => {
        throw new Error("docker daemon is unreachable");
      });
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      await downCommand.parseAsync(["node", "flisk"], { from: "node" });

      expect(pruneProjectNetworksMock).toHaveBeenCalledTimes(1);
      const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).not.toContain("Could not remove networks");
    });

    it("keeps the networks with --no-prune-networks", async () => {
      setupTestProject();
      downCommand.setOptionValue("pruneNetworks", undefined);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      await downCommand.parseAsync(["node", "flisk", "--no-prune-networks"], { from: "node" });

      expect(pruneProjectNetworksMock).not.toHaveBeenCalled();
    });
  });
});
