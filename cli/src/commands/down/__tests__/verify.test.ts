// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
//
// Unit tests for commands/down/verify.ts: the "is anything of this project still up" checks and the retained-image
// report. Docker (`ps`, the image list) and Tilt (`tilt up` pids) are doubled; the project name comes from a real
// project.json in a temp folder.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const cleanup = vi.hoisted(() => ({
  lookupProjectTiltUpPids: vi.fn((): number[] | null => []),
  projectComposeProjects: vi.fn((): string[] => []),
}));
const tilt = vi.hoisted(() => ({ getTiltfilePath: vi.fn(() => "/project/Tiltfile") }));
const leftovers = vi.hoisted(() => ({
  collectLeftovers: vi.fn(async () => ({ imageCount: 2, imageGib: 1.5, cacheGib: 3 })),
  formatLeftovers: vi.fn((): string[] => ["retained line 1", "retained line 2"]),
}));
const purge = vi.hoisted(() => ({
  listProjectArtifacts: vi.fn(() => ({
    containers: ["web"],
    volumes: ["db-data"],
    networks: ["flisk-test"],
    images: ["img:1"],
  })),
}));
const registry = vi.hoisted(() => ({
  readProjectRecords: vi.fn(() => [
    { name: "test-project", roots: ["/project"], stacks: ["retired"], updatedAt: "" },
  ]),
}));
const find = vi.hoisted(() => ({ allStackNames: vi.fn((): string[] | undefined => ["app"]) }));

vi.mock("../../../utils/down-cleanup.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/down-cleanup.js")>()),
  ...cleanup,
}));
vi.mock("../../../utils/tilt.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/tilt.js")>()),
  ...tilt,
}));
vi.mock("../../../utils/down-leftovers.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/down-leftovers.js")>()),
  ...leftovers,
}));
vi.mock("../../../utils/project-purge.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/project-purge.js")>()),
  ...purge,
}));
vi.mock("../../../utils/project-registry.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/project-registry.js")>()),
  ...registry,
}));
vi.mock("../find.js", () => ({ ...find }));

import {
  describeArtifacts,
  isProjectIdle,
  projectArtifacts,
  reportRetainedImages,
} from "../verify.js";
import { makeDownTempProject } from "./fixtures.js";

let projectRoot: string;

/** The shared project state every verified report is built on: one project, one retired stack, one live stack. */
function setupProject(): void {
  purge.listProjectArtifacts.mockReset().mockReturnValue({
    containers: ["web"],
    volumes: ["db-data"],
    networks: ["flisk-test"],
    images: ["img:1"],
  });
  registry.readProjectRecords
    .mockReset()
    .mockReturnValue([
      { name: "test-project", roots: ["/project"], stacks: ["retired"], updatedAt: "" },
    ]);
  find.allStackNames.mockReset().mockReturnValue(["app"]);
  projectRoot = makeDownTempProject();
}

describe("isProjectIdle", () => {
  beforeEach(() => {
    cleanup.lookupProjectTiltUpPids.mockReset().mockReturnValue([]);
    cleanup.projectComposeProjects.mockReset().mockReturnValue([]);
    tilt.getTiltfilePath.mockReset().mockReturnValue("/project/Tiltfile");
  });

  it("is idle when no tilt up runs and no compose project has containers", () => {
    expect(isProjectIdle("/project")).toBe(true);
    expect(cleanup.lookupProjectTiltUpPids).toHaveBeenCalledWith("/project/Tiltfile");
  });

  it("is not idle while a tilt up still runs", () => {
    cleanup.lookupProjectTiltUpPids.mockReturnValue([123]);
    expect(isProjectIdle("/project")).toBe(false);
    expect(cleanup.projectComposeProjects).not.toHaveBeenCalled();
  });

  it("is not idle when the tilt up lookup cannot answer", () => {
    cleanup.lookupProjectTiltUpPids.mockReturnValue(null);
    expect(isProjectIdle("/project")).toBe(false);
  });

  it("is not idle while a compose project still has containers", () => {
    cleanup.projectComposeProjects.mockReturnValue(["test-traefik"]);
    expect(isProjectIdle("/project")).toBe(false);
  });

  it("is not idle when the check itself fails", () => {
    cleanup.lookupProjectTiltUpPids.mockImplementation(() => {
      throw new Error("ps failed");
    });
    expect(isProjectIdle("/project")).toBe(false);
  });
});

describe("projectArtifacts", () => {
  beforeEach(setupProject);

  it("lists the project Docker objects under its lowercase name", () => {
    const found = projectArtifacts(projectRoot);
    expect(found?.name).toBe("test-project");
    expect(found?.artifacts.images).toEqual(["img:1"]);
    expect(purge.listProjectArtifacts).toHaveBeenCalledWith("test-project", {
      stacks: ["retired", "app"],
      knownNames: ["test-project"],
      roots: ["/project", projectRoot],
    });
  });

  it("is undefined when the project config cannot be read", () => {
    writeFileSync(join(projectRoot, ".flisk", "project.json"), "{not json");
    expect(projectArtifacts(projectRoot)).toBeUndefined();
  });
});

describe("describeArtifacts", () => {
  it("lists only the kinds that hold something", () => {
    expect(
      describeArtifacts({ containers: ["web"], volumes: [], networks: ["n1"], images: [] }),
    ).toEqual(["containers: web", "networks: n1"]);
  });

  it("is empty when nothing is left", () => {
    expect(describeArtifacts({ containers: [], volumes: [], networks: [], images: [] })).toEqual(
      [],
    );
  });
});

describe("reportRetainedImages", () => {
  beforeEach(() => {
    leftovers.collectLeftovers
      .mockReset()
      .mockResolvedValue({ imageCount: 2, imageGib: 1.5, cacheGib: 3 });
    leftovers.formatLeftovers.mockReset().mockReturnValue(["retained line 1", "retained line 2"]);
    setupProject();
  });

  it("prints the retained report and returns it for the JSON emit", async () => {
    const printed: string[] = [];
    vi.spyOn(console, "log").mockImplementation((text) => printed.push(String(text)));
    const retained = await reportRetainedImages(projectRoot, {});
    expect(leftovers.collectLeftovers).toHaveBeenCalledWith(["img:1"]);
    expect(retained).toEqual({ imageCount: 2, imageGib: 1.5, cacheGib: 3 });
    expect(printed.join("\n")).toContain("retained line 1");
    expect(printed.join("\n")).toContain("retained line 2");
  });

  it("stays quiet in --json but still reports", async () => {
    const printed: string[] = [];
    vi.spyOn(console, "log").mockImplementation((text) => printed.push(String(text)));
    const retained = await reportRetainedImages(projectRoot, { json: true });
    expect(retained?.imageCount).toBe(2);
    expect(printed).toEqual([]);
  });

  it("skips the report after --purge emptied Docker", async () => {
    const retained = await reportRetainedImages(projectRoot, { purge: true });
    expect(retained).toBeUndefined();
    expect(leftovers.collectLeftovers).not.toHaveBeenCalled();
  });

  it("is undefined when Docker cannot be asked, never a failure", async () => {
    leftovers.collectLeftovers.mockRejectedValue(new Error("docker is gone"));
    await expect(reportRetainedImages(projectRoot, {})).resolves.toBeUndefined();
  });
});
