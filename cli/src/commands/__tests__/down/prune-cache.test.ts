// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import {
  createJsonEmitterMock,
  describe,
  downCommand,
  downTestContext,
  expect,
  it,
  pruneDockerBuildCacheMock,
  rmSync,
  setupTestProject,
  trimColimaAndMeasureMock,
  vi,
} from "../../test-support/down.js";

describe("flisk down Docker build cache pruning", () => {
  const { originalCwd } = downTestContext();

  describe("Docker build cache pruning (--prune-cache)", () => {
    it("runs build cache prune with --yes and emits prunedCache in json mode", async () => {
      setupTestProject();
      pruneDockerBuildCacheMock.mockResolvedValue({ reclaimed: "2.6GB", until: "24h" });
      const emitMock = vi.fn();
      createJsonEmitterMock.mockReturnValue(emitMock);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      await downCommand.parseAsync(["node", "flisk", "--prune-cache", "-y", "--json"], {
        from: "node",
      });

      expect(pruneDockerBuildCacheMock).toHaveBeenCalledWith({ until: "24h" });
      expect(emitMock).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: true,
          prunedCache: { until: "24h", reclaimed: "2.6GB" },
        }),
      );
    });

    it("trims the Colima VM after the prune and reports the host space it returned", async () => {
      setupTestProject();
      pruneDockerBuildCacheMock.mockResolvedValue({ reclaimed: "2.6GB", until: "24h" });
      trimColimaAndMeasureMock.mockResolvedValue({
        returnedBytes: 22 * 1024 ** 3,
        before: 34 * 1024 ** 3,
        after: 12 * 1024 ** 3,
      });
      const emitMock = vi.fn();
      createJsonEmitterMock.mockReturnValue(emitMock);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      await downCommand.parseAsync(["node", "flisk", "--prune-cache", "-y", "--json"], {
        from: "node",
      });

      expect(trimColimaAndMeasureMock).toHaveBeenCalledTimes(1);
      expect(emitMock).toHaveBeenCalledWith(
        expect.objectContaining({
          prunedCache: { until: "24h", reclaimed: "2.6GB", hostReturned: "22.0 GB" },
        }),
      );
    });

    it("keeps the prune result and says how to trim by hand when the Colima trim fails", async () => {
      setupTestProject();
      pruneDockerBuildCacheMock.mockResolvedValue({ reclaimed: "2.6GB", until: "24h" });
      trimColimaAndMeasureMock.mockRejectedValue(new Error("ssh: connection refused"));
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      await downCommand.parseAsync(["node", "flisk", "--prune-cache", "-y"], { from: "node" });

      const printed = log.mock.calls.map((call) => String(call[0])).join("\n");
      expect(printed).toContain("Could not trim the Colima VM: ssh: connection refused");
      expect(printed).toContain("colima ssh -- sudo fstrim -av");
    });

    it("skips cache prune when non-interactive without --yes", async () => {
      setupTestProject();
      const emitMock = vi.fn();
      createJsonEmitterMock.mockReturnValue(emitMock);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      await downCommand.parseAsync(["node", "flisk", "--prune-cache", "--json"], {
        from: "node",
      });

      expect(pruneDockerBuildCacheMock).not.toHaveBeenCalled();
      expect(emitMock).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: true,
          prunedCache: expect.objectContaining({
            until: "24h",
            skipped: true,
            reason: expect.stringContaining("confirmation required"),
          }),
        }),
      );
    });

    it("supports custom age filter via --cache-until", async () => {
      setupTestProject();
      pruneDockerBuildCacheMock.mockResolvedValue({ reclaimed: "1.2GB", until: "48h" });
      const emitMock = vi.fn();
      createJsonEmitterMock.mockReturnValue(emitMock);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      await downCommand.parseAsync(
        ["node", "flisk", "--prune-cache", "--cache-until", "48h", "-y", "--json"],
        { from: "node" },
      );

      expect(pruneDockerBuildCacheMock).toHaveBeenCalledWith({ until: "48h" });
      expect(emitMock).toHaveBeenCalledWith(
        expect.objectContaining({
          prunedCache: { until: "48h", reclaimed: "1.2GB" },
        }),
      );
    });

    it("emits wouldPruneCache in dry-run without executing prune", async () => {
      setupTestProject();
      const emitMock = vi.fn();
      createJsonEmitterMock.mockReturnValue(emitMock);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      await downCommand.parseAsync(["node", "flisk", "--dry-run", "--prune-cache", "--json"], {
        from: "node",
      });

      expect(pruneDockerBuildCacheMock).not.toHaveBeenCalled();
      expect(emitMock).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: true,
          dryRun: true,
          wouldPruneCache: { until: "24h" },
        }),
      );
    });

    it("rejects invalid cache-until duration format with error", async () => {
      const tempDir = setupTestProject();
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const exit = vi.spyOn(process, "exit").mockImplementation((() => {
        throw new Error("exit:1");
      }) as never);

      try {
        await expect(
          downCommand.parseAsync(
            ["node", "flisk", "--prune-cache", "--cache-until", "invalid_age"],
            { from: "node" },
          ),
        ).rejects.toThrow("exit:1");

        expect(pruneDockerBuildCacheMock).not.toHaveBeenCalled();
        const errOutput = error.mock.calls.flat().join("\n");
        expect(errOutput).toContain("Invalid --cache-until format");
      } finally {
        process.chdir(originalCwd);
        rmSync(tempDir, { recursive: true, force: true });
        exit.mockRestore();
        error.mockRestore();
      }
    });

    it("gracefully catches prune error without failing flisk down", async () => {
      setupTestProject();
      pruneDockerBuildCacheMock.mockRejectedValue(new Error("docker daemon disconnected"));
      const emitMock = vi.fn();
      createJsonEmitterMock.mockReturnValue(emitMock);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      await downCommand.parseAsync(["node", "flisk", "--prune-cache", "-y", "--json"], {
        from: "node",
      });

      expect(emitMock).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: true,
          prunedCache: expect.objectContaining({
            until: "24h",
            skipped: true,
            reason: "docker daemon disconnected",
          }),
        }),
      );
    });
  });
});
