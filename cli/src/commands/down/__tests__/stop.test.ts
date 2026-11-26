// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
//
// Unit tests for commands/down/stop.ts: the inferred-folder stop, the Tilt stop (tilt up, tilt down, the Compose
// fallback), and the cleanup steps behind it (networks, purge, build cache, tilt image tags). Docker, Tilt, the
// native runtime and the prompt are doubled; where a project name is needed it comes from a real project.json.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureExit } from "../../../test-support/index.js";

const paths = vi.hoisted(() => ({ findProjectRoot: vi.fn((): string | null => null) }));
const inferred = vi.hoisted(() => ({
  inferNodeProject: vi.fn((): unknown => null),
  inferredStateRoot: vi.fn(() => "/inferred-root"),
}));
const native = vi.hoisted(() => ({
  stopNativeRun: vi.fn(async () => ({ wasRunning: true, services: ["web", "api"] })),
}));
const json = vi.hoisted(() => ({ emitted: [] as unknown[] }));
const checkout = vi.hoisted(() => ({ exportCheckoutEnv: vi.fn() }));
const tilt = vi.hoisted(() => ({
  buildTiltDownArgs: vi.fn(() => ["-f", "/project/Tiltfile"]),
  getTiltfilePath: vi.fn(() => "/project/Tiltfile"),
  runTilt: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" })),
}));
const cleanup = vi.hoisted(() => ({
  planProjectNetworkPrune: vi.fn(() => ({
    remove: ["flisk-test-app"],
    keep: [{ name: "flisk-test-db", reason: "container db attached" }],
  })),
  projectComposeProjects: vi.fn((): string[] => ["test-web"]),
  pruneProjectNetworks: vi.fn(() => ({
    removed: ["flisk-test-app"],
    kept: [{ name: "flisk-test-db", reason: "container db attached" }],
  })),
  stopProjectComposeProjects: vi.fn(
    (): { stopped: string[]; failed: { name: string; reason: string }[] } => ({
      stopped: ["test-web"],
      failed: [],
    }),
  ),
  stopProjectTiltUp: vi.fn((): number[] => [42]),
  waitForTiltUpExit: vi.fn(async () => true),
}));
const tiltImages = vi.hoisted(() => ({
  pruneSupersededTiltImages: vi.fn(async () => ({ removed: ["a", "b"], removedBytes: 2e9 })),
}));
const owner = vi.hoisted(() => ({
  findForeignContainerOwners: vi.fn((): unknown[] => []),
  findOtherRecordedFolders: vi.fn((): string[] => []),
  purgeOwnerRefusal: vi.fn((): { message: string; suggestions: string[] } | null => null),
}));
const purge = vi.hoisted(() => ({
  countArtifacts: vi.fn(
    (artifacts: {
      containers: string[];
      volumes: string[];
      networks: string[];
      images: string[];
    }) =>
      artifacts.containers.length +
      artifacts.volumes.length +
      artifacts.networks.length +
      artifacts.images.length,
  ),
  removeProjectArtifacts: vi.fn(() => ({
    removed: { containers: ["web"], volumes: ["db-data"], networks: [], images: ["img:1"] },
    kept: [{ kind: "images", name: "img:2", reason: "in use by another container" }],
  })),
}));
const registry = vi.hoisted(() => ({
  projectNameAt: vi.fn((): string | undefined => "test-project"),
  readProjectRecords: vi.fn(() => [
    { name: "test-project", roots: ["/project"], stacks: ["retired"], updatedAt: "" },
  ]),
}));
const prompt = vi.hoisted(() => ({ promptConfirm: vi.fn(async () => false) }));
const cache = vi.hoisted(() => ({
  pruneDockerBuildCache: vi.fn(async () => ({ reclaimed: "1.2GB" })),
}));
const colima = vi.hoisted(() => ({
  trimColimaAndMeasure: vi.fn(async () => ({ returnedBytes: 5e8 })),
}));
const find = vi.hoisted(() => ({ allStackNames: vi.fn((): string[] | undefined => ["app"]) }));
const verify = vi.hoisted(() => {
  const describeArtifactsImpl = (artifacts: {
    containers: string[];
    volumes: string[];
    networks: string[];
    images: string[];
  }) =>
    [
      artifacts.containers.length ? `containers: ${artifacts.containers.join(", ")}` : "",
      artifacts.volumes.length ? `volumes: ${artifacts.volumes.join(", ")}` : "",
      artifacts.networks.length ? `networks: ${artifacts.networks.join(", ")}` : "",
      artifacts.images.length ? `images: ${artifacts.images.join(", ")}` : "",
    ].filter(Boolean);
  return {
    describeArtifactsImpl,
    projectArtifacts: vi.fn(
      ():
        | {
            name: string;
            artifacts: {
              containers: string[];
              volumes: string[];
              networks: string[];
              images: string[];
            };
          }
        | undefined => ({
        name: "test-project",
        artifacts: { containers: ["web"], volumes: ["db-data"], networks: [], images: ["img:1"] },
      }),
    ),
    describeArtifacts: vi.fn(describeArtifactsImpl),
  };
});

vi.mock("../../../utils/paths.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/paths.js")>()),
  ...paths,
}));
vi.mock("../../../utils/inferred-node-project.js", () => ({ ...inferred }));
vi.mock("../../../utils/native-runtime.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/native-runtime.js")>()),
  ...native,
}));
vi.mock("../../../utils/json-output.js", () => ({
  createJsonEmitter: () => (data: unknown) => void json.emitted.push(data),
}));
vi.mock("../../../utils/checkout-id.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/checkout-id.js")>()),
  ...checkout,
}));
vi.mock("../../../utils/tilt.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/tilt.js")>()),
  ...tilt,
}));
vi.mock("../../../utils/down-cleanup.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/down-cleanup.js")>()),
  ...cleanup,
}));
vi.mock("../../../utils/tilt-images.js", () => ({ ...tiltImages }));
vi.mock("../../../utils/project-owner.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/project-owner.js")>()),
  ...owner,
}));
vi.mock("../../../utils/project-purge.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/project-purge.js")>()),
  ...purge,
}));
vi.mock("../../../utils/project-registry.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/project-registry.js")>()),
  ...registry,
}));
vi.mock("../../../utils/prompt.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/prompt.js")>()),
  ...prompt,
}));
vi.mock("../../../utils/docker-build-cache.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/docker-build-cache.js")>()),
  ...cache,
}));
vi.mock("../../../utils/colima-disk.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/colima-disk.js")>()),
  ...colima,
}));
vi.mock("../find.js", () => ({ ...find }));
vi.mock("../verify.js", () => ({ ...verify }));

import {
  planNetworkPruneOrWarn,
  printNativeStop,
  pruneBuildCacheWithConsent,
  pruneNetworksOrWarn,
  pruneTiltImageTags,
  purgeOrWarn,
  purgeOwnershipRefusal,
  stopInferredProject,
  stopTiltStack,
} from "../stop.js";
import { makeDownTempProject } from "./fixtures.js";

const stdinTty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");

function setStdinTty(value: boolean): void {
  Object.defineProperty(process.stdin, "isTTY", { value, configurable: true });
}

let projectRoot: string;

beforeEach(() => {
  json.emitted = [];
  setStdinTty(false);
  paths.findProjectRoot.mockReset().mockReturnValue(null);
  inferred.inferNodeProject.mockReset().mockReturnValue(null);
  inferred.inferredStateRoot.mockReset().mockReturnValue("/inferred-root");
  native.stopNativeRun
    .mockReset()
    .mockResolvedValue({ wasRunning: true, services: ["web", "api"] });
  checkout.exportCheckoutEnv.mockReset();
  tilt.buildTiltDownArgs.mockReset().mockReturnValue(["-f", "/project/Tiltfile"]);
  tilt.getTiltfilePath.mockReset().mockReturnValue("/project/Tiltfile");
  tilt.runTilt.mockReset().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
  cleanup.planProjectNetworkPrune.mockReset().mockReturnValue({
    remove: ["flisk-test-app"],
    keep: [{ name: "flisk-test-db", reason: "container db attached" }],
  });
  cleanup.projectComposeProjects.mockReset().mockReturnValue(["test-web"]);
  cleanup.pruneProjectNetworks.mockReset().mockReturnValue({
    removed: ["flisk-test-app"],
    kept: [{ name: "flisk-test-db", reason: "container db attached" }],
  });
  cleanup.stopProjectComposeProjects.mockReset().mockReturnValue({
    stopped: ["test-web"],
    failed: [],
  });
  cleanup.stopProjectTiltUp.mockReset().mockReturnValue([42]);
  cleanup.waitForTiltUpExit.mockReset().mockResolvedValue(true);
  tiltImages.pruneSupersededTiltImages
    .mockReset()
    .mockResolvedValue({ removed: ["a", "b"], removedBytes: 2e9 });
  owner.findForeignContainerOwners.mockReset().mockReturnValue([]);
  owner.findOtherRecordedFolders.mockReset().mockReturnValue([]);
  owner.purgeOwnerRefusal.mockReset().mockReturnValue(null);
  purge.countArtifacts
    .mockReset()
    .mockImplementation(
      (artifacts: {
        containers: string[];
        volumes: string[];
        networks: string[];
        images: string[];
      }) =>
        artifacts.containers.length +
        artifacts.volumes.length +
        artifacts.networks.length +
        artifacts.images.length,
    );
  purge.removeProjectArtifacts.mockReset().mockReturnValue({
    removed: { containers: ["web"], volumes: ["db-data"], networks: [], images: ["img:1"] },
    kept: [{ kind: "images", name: "img:2", reason: "in use by another container" }],
  });
  registry.projectNameAt.mockReset().mockReturnValue("test-project");
  registry.readProjectRecords
    .mockReset()
    .mockReturnValue([
      { name: "test-project", roots: ["/project"], stacks: ["retired"], updatedAt: "" },
    ]);
  prompt.promptConfirm.mockReset().mockResolvedValue(false);
  cache.pruneDockerBuildCache.mockReset().mockResolvedValue({ reclaimed: "1.2GB" });
  colima.trimColimaAndMeasure.mockReset().mockResolvedValue({ returnedBytes: 5e8 });
  find.allStackNames.mockReset().mockReturnValue(["app"]);
  verify.projectArtifacts.mockReset().mockReturnValue({
    name: "test-project",
    artifacts: { containers: ["web"], volumes: ["db-data"], networks: [], images: ["img:1"] },
  });
  verify.describeArtifacts.mockReset().mockImplementation(verify.describeArtifactsImpl);
  projectRoot = makeDownTempProject();
});

afterEach(() => {
  vi.restoreAllMocks();
  if (stdinTty) Object.defineProperty(process.stdin, "isTTY", stdinTty);
});

describe("stopInferredProject", () => {
  it("does nothing for a folder that is not an inferred Node project", async () => {
    await expect(stopInferredProject({})).resolves.toBe(false);
    expect(native.stopNativeRun).not.toHaveBeenCalled();
  });

  it("does nothing for --project, which names a real project", async () => {
    inferred.inferNodeProject.mockReturnValue({ kind: "node" });
    await expect(stopInferredProject({ project: "/real" })).resolves.toBe(false);
    expect(native.stopNativeRun).not.toHaveBeenCalled();
  });

  it("emits the dry-run preview without stopping anything", async () => {
    inferred.inferNodeProject.mockReturnValue({ kind: "node" });
    await expect(stopInferredProject({ json: true, dryRun: true })).resolves.toBe(true);
    expect(json.emitted).toEqual([{ ok: true, dryRun: true, runtime: "native", inferred: true }]);
    expect(native.stopNativeRun).not.toHaveBeenCalled();
  });

  it("stops the recorded native run of this folder and reports the services", async () => {
    inferred.inferNodeProject.mockReturnValue({ kind: "node" });
    const printed: string[] = [];
    vi.spyOn(console, "log").mockImplementation((text) => printed.push(String(text)));
    await expect(stopInferredProject({ json: true })).resolves.toBe(true);
    expect(native.stopNativeRun).toHaveBeenCalledWith("/inferred-root");
    expect(json.emitted).toEqual([
      { ok: true, runtime: "native", inferred: true, stopped: ["web", "api"] },
    ]);
    expect(printed).toEqual([]);
  });
});

describe("printNativeStop", () => {
  it("names the stopped local processes", () => {
    const printed: string[] = [];
    vi.spyOn(console, "log").mockImplementation((text) => printed.push(String(text)));
    printNativeStop({ wasRunning: true, services: ["web", "api"] }, "project");
    expect(printed.join("\n")).toContain("Stopped local processes: web, api");
  });

  it("says a stale record stopped nothing", () => {
    const printed: string[] = [];
    vi.spyOn(console, "log").mockImplementation((text) => printed.push(String(text)));
    printNativeStop({ wasRunning: false, services: [], stale: true }, "folder");
    expect(printed.join("\n")).toContain("Stale run record");
  });

  it("warns about live processes it cannot prove are Flisk's", () => {
    const printed: string[] = [];
    vi.spyOn(console, "log").mockImplementation((text) => printed.push(String(text)));
    printNativeStop(
      { wasRunning: true, services: ["web"], unverified: [{ name: "api", pid: 9 }] },
      "project",
    );
    expect(printed.join("\n")).toContain("cannot prove Flisk started them: api (pid 9)");
  });
});

describe("purgeOwnershipRefusal", () => {
  it("is undefined when the project name is not on record", () => {
    registry.projectNameAt.mockReturnValue(undefined);
    expect(purgeOwnershipRefusal(projectRoot)).toBeUndefined();
    expect(owner.purgeOwnerRefusal).not.toHaveBeenCalled();
  });

  it("is the refusal error when another folder owns the project name", () => {
    owner.purgeOwnerRefusal.mockReturnValue({
      message: "Refusing to purge",
      suggestions: ["stop the other folder first"],
    });
    const refusal = purgeOwnershipRefusal(projectRoot);
    expect(refusal?.message).toBe("Refusing to purge");
    expect(refusal?.suggestions).toEqual(["stop the other folder first"]);
  });

  it("is undefined when nothing outside owns the name", () => {
    expect(purgeOwnershipRefusal(projectRoot)).toBeUndefined();
    expect(owner.findForeignContainerOwners).toHaveBeenCalledWith(
      "test-project",
      ["retired", "app"],
      projectRoot,
    );
  });
});

describe("stopTiltStack", () => {
  it("stops tilt up first, then runs tilt down", async () => {
    const outcome = await stopTiltStack(projectRoot, { idle: false, json: false, verbose: false });
    expect(cleanup.stopProjectTiltUp).toHaveBeenCalledWith("/project/Tiltfile");
    expect(cleanup.waitForTiltUpExit).toHaveBeenCalledWith("/project/Tiltfile");
    expect(tilt.runTilt).toHaveBeenCalledWith("down", ["-f", "/project/Tiltfile"], {
      verbose: false,
      inheritStdio: true,
    });
    expect(tilt.buildTiltDownArgs).toHaveBeenCalledWith({ focusTargets: ["app"] });
    expect(checkout.exportCheckoutEnv).toHaveBeenCalledWith(projectRoot);
    expect(outcome).toEqual({ stoppedTilt: [42], composeFallback: undefined });
  });

  it("touches nothing of Tilt for an idle project, even with cleanup flags", async () => {
    const outcome = await stopTiltStack(projectRoot, { idle: true, json: true, verbose: false });
    expect(cleanup.stopProjectTiltUp).not.toHaveBeenCalled();
    expect(tilt.runTilt).not.toHaveBeenCalled();
    expect(checkout.exportCheckoutEnv).not.toHaveBeenCalled();
    expect(outcome.stoppedTilt).toEqual([]);
  });

  it("stops the project's Compose projects when tilt down fails", async () => {
    tilt.runTilt.mockResolvedValue({ exitCode: 3, stdout: "", stderr: "" });
    const printed: string[] = [];
    vi.spyOn(console, "log").mockImplementation((text) => printed.push(String(text)));
    const outcome = await stopTiltStack(projectRoot, { idle: false, json: false, verbose: false });
    expect(cleanup.stopProjectComposeProjects).toHaveBeenCalledWith(projectRoot);
    expect(outcome.composeFallback).toEqual({
      stopped: ["test-web"],
      failed: [],
      tiltDownExitCode: 3,
    });
    expect(printed.join("\n")).toContain("tilt down failed (exit 3)");
    expect(printed.join("\n")).toContain("test-web");
  });

  it("exits with the tilt code when the Compose fallback cannot stop a project", async () => {
    const { expectExit } = captureExit();
    tilt.runTilt.mockResolvedValue({ exitCode: 3, stdout: "", stderr: "" });
    cleanup.stopProjectComposeProjects.mockReturnValue({
      stopped: [],
      failed: [{ name: "test-web", reason: "daemon gone" }],
    });
    await expect(
      stopTiltStack(projectRoot, { idle: false, json: true, verbose: false }),
    ).rejects.toThrow("process.exit");
    expectExit(3);
  });
});

describe("pruneNetworksOrWarn", () => {
  it("is undefined outside a project", () => {
    expect(pruneNetworksOrWarn(false, false)).toBeUndefined();
  });

  it("reports removed networks and stays quiet about kept ones unless explicit", () => {
    paths.findProjectRoot.mockReturnValue(projectRoot);
    const printed: string[] = [];
    vi.spyOn(console, "log").mockImplementation((text) => printed.push(String(text)));
    const result = pruneNetworksOrWarn(false, false);
    expect(cleanup.pruneProjectNetworks).toHaveBeenCalledWith("test-project");
    expect(result?.removed).toEqual(["flisk-test-app"]);
    expect(printed.join("\n")).toContain("Removed networks: flisk-test-app");
    expect(printed.join("\n")).not.toContain("Kept network");
  });

  it("explains kept networks for an explicit --prune-networks", () => {
    paths.findProjectRoot.mockReturnValue(projectRoot);
    const printed: string[] = [];
    vi.spyOn(console, "log").mockImplementation((text) => printed.push(String(text)));
    pruneNetworksOrWarn(false, true);
    expect(printed.join("\n")).toContain("Kept network flisk-test-db: container db attached");
  });

  it("warns instead of failing when Docker cannot be asked", () => {
    paths.findProjectRoot.mockReturnValue(projectRoot);
    cleanup.pruneProjectNetworks.mockImplementation(() => {
      throw new Error("docker gone");
    });
    const printed: string[] = [];
    vi.spyOn(console, "log").mockImplementation((text) => printed.push(String(text)));
    expect(pruneNetworksOrWarn(false, true)).toBeUndefined();
    expect(printed.join("\n")).toContain("Could not remove networks: docker gone");
  });
});

describe("planNetworkPruneOrWarn", () => {
  it("plans with the project's stopped compose containers out of the count", () => {
    const plan = planNetworkPruneOrWarn(projectRoot, false);
    expect(cleanup.planProjectNetworkPrune).toHaveBeenCalledWith("test-project", undefined, [
      "test-web",
    ]);
    expect(plan?.remove).toEqual(["flisk-test-app"]);
    expect(plan?.keep).toEqual([{ name: "flisk-test-db", reason: "container db attached" }]);
  });

  it("warns and is undefined when the check fails", () => {
    cleanup.planProjectNetworkPrune.mockImplementation(() => {
      throw new Error("docker gone");
    });
    const printed: string[] = [];
    vi.spyOn(console, "log").mockImplementation((text) => printed.push(String(text)));
    expect(planNetworkPruneOrWarn(projectRoot, false)).toBeUndefined();
    expect(printed.join("\n")).toContain("Could not check networks: docker gone");
  });
});

describe("purgeOrWarn", () => {
  it("warns when the project name cannot be read", () => {
    verify.projectArtifacts.mockReturnValue(undefined);
    const printed: string[] = [];
    vi.spyOn(console, "log").mockImplementation((text) => printed.push(String(text)));
    expect(purgeOrWarn(projectRoot, false)).toBeUndefined();
    expect(printed.join("\n")).toContain("Could not read the project name; nothing purged.");
  });

  it("removes the project objects and reports what was kept", () => {
    const printed: string[] = [];
    vi.spyOn(console, "log").mockImplementation((text) => printed.push(String(text)));
    const result = purgeOrWarn(projectRoot, false);
    expect(result?.removed.containers).toEqual(["web"]);
    expect(printed.join("\n")).toContain("Removed 3 Docker objects of test-project");
    expect(printed.join("\n")).toContain("containers: web");
    expect(printed.join("\n")).toContain("volumes: db-data");
    expect(printed.join("\n")).toContain("images: img:1");
    expect(printed.join("\n")).toContain("Kept image img:2: in use by another container");
  });
});

describe("pruneBuildCacheWithConsent", () => {
  it("skips the prune when it cannot get consent and --json is set", async () => {
    const result = await pruneBuildCacheWithConsent("24h", { json: true, yes: false });
    expect(result).toEqual({
      until: "24h",
      skipped: true,
      reason: "confirmation required; run in a terminal or pass --yes",
    });
    expect(cache.pruneDockerBuildCache).not.toHaveBeenCalled();
  });

  it("skips the prune outside a terminal", async () => {
    const printed: string[] = [];
    vi.spyOn(console, "log").mockImplementation((text) => printed.push(String(text)));
    const result = await pruneBuildCacheWithConsent("48h", { json: false, yes: false });
    expect(result?.skipped).toBe(true);
    expect(printed.join("\n")).toContain("Skipping Docker build cache prune");
    expect(prompt.promptConfirm).not.toHaveBeenCalled();
  });

  it("prunes on --yes and reports the reclaimed and trimmed space", async () => {
    const printed: string[] = [];
    vi.spyOn(console, "log").mockImplementation((text) => printed.push(String(text)));
    const result = await pruneBuildCacheWithConsent("24h", { json: false, yes: true });
    expect(cache.pruneDockerBuildCache).toHaveBeenCalledWith({ until: "24h" });
    expect(colima.trimColimaAndMeasure).toHaveBeenCalled();
    expect(result).toEqual({ until: "24h", reclaimed: "1.2GB", hostReturned: "477 MB" });
    expect(printed.join("\n")).toContain("Pruned Docker build cache: 1.2GB reclaimed");
    expect(printed.join("\n")).toContain("returned to the Mac");
  });

  it("records the prompt decline as a skip", async () => {
    setStdinTty(true);
    prompt.promptConfirm.mockResolvedValue(false);
    const printed: string[] = [];
    vi.spyOn(console, "log").mockImplementation((text) => printed.push(String(text)));
    const result = await pruneBuildCacheWithConsent("24h", { json: false, yes: false });
    expect(result).toEqual({ until: "24h", skipped: true, reason: "not confirmed" });
    expect(printed.join("\n")).toContain("Skipped Docker build cache prune.");
    expect(cache.pruneDockerBuildCache).not.toHaveBeenCalled();
  });

  it("reports the prune failure as a skip instead of failing down", async () => {
    cache.pruneDockerBuildCache.mockRejectedValue(new Error("docker gone"));
    const printed: string[] = [];
    vi.spyOn(console, "log").mockImplementation((text) => printed.push(String(text)));
    const result = await pruneBuildCacheWithConsent("24h", { json: false, yes: true });
    expect(result).toEqual({ until: "24h", skipped: true, reason: "docker gone" });
    expect(printed.join("\n")).toContain("Could not prune Docker build cache: docker gone");
  });
});

describe("pruneTiltImageTags", () => {
  it("reports the removed superseded tags", async () => {
    const printed: string[] = [];
    vi.spyOn(console, "log").mockImplementation((text) => printed.push(String(text)));
    const tiltImageResult = await pruneTiltImageTags(false);
    expect(tiltImages.pruneSupersededTiltImages).toHaveBeenCalledWith(1);
    expect(tiltImageResult.removed).toEqual(["a", "b"]);
    expect(printed.join("\n")).toContain("Removed 2 superseded tilt-* image(s)");
  });

  it("stays quiet in --json", async () => {
    const printed: string[] = [];
    vi.spyOn(console, "log").mockImplementation((text) => printed.push(String(text)));
    await pruneTiltImageTags(true);
    expect(printed).toEqual([]);
  });
});
