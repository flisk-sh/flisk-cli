// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import {
  collectLeftoversMock,
  describe,
  downCommand,
  downTestContext,
  expect,
  it,
  listProjectArtifactsMock,
  removeProjectArtifactsMock,
  rmSync,
  setupTestProject,
  vi,
} from "../../test-support/down.js";

describe("what the stopped project still holds", () => {
  downTestContext();

  describe("what the stopped project still holds (#3708, cycle 4)", () => {
    it("prints the size of the images and the shared cache and the commands that free them", async () => {
      setupTestProject();
      listProjectArtifactsMock.mockReturnValue({
        containers: [],
        volumes: [],
        networks: [],
        images: ["test_project_api:latest"],
      });
      collectLeftoversMock.mockResolvedValue({ imageCount: 1, imageGib: 1.4, cacheGib: 23.4 });
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      await downCommand.parseAsync(["node", "flisk"], { from: "node" });
      expect(collectLeftoversMock).toHaveBeenCalledWith(["test_project_api:latest"]);
      const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain("1.4 GiB");
      expect(output).toContain("flisk down --purge");
      expect(output).toContain("23.4 GiB");
      expect(output).toContain("docker builder prune -f");
    });

    it("does not report after --purge, which already removed the images", async () => {
      setupTestProject();
      listProjectArtifactsMock.mockReturnValue({
        containers: [],
        volumes: [],
        networks: [],
        images: [],
      });
      removeProjectArtifactsMock.mockReturnValue({
        removed: { containers: [], volumes: [], networks: [], images: [] },
        kept: [],
      });
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      await downCommand.parseAsync(["node", "flisk", "--purge", "--yes"], { from: "node" });
      expect(collectLeftoversMock).not.toHaveBeenCalled();
    });
  });
});
