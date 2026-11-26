// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExitSignal } from "../../test-support/cli-exit.js";
import {
  countFiles,
  countLabel,
  type DemoBootstrapInput,
  demoDiskNotice,
  firstMachineFailure,
  runDemoBootstrap,
  writeLog,
} from "../demo.js";

const mocks = vi.hoisted(() => ({
  staleVersionNotice: vi.fn(async () => null as string | null),
  nativeDemoReason: vi.fn(async () => null as string | null),
  isNativeDemoFolder: vi.fn((_dir: string) => false),
  runNativeDemo: vi.fn(async () => 0),
  cliInvocation: vi.fn(() => ["flisk"] as [string, ...string[]]),
  currentDockerContext: vi.fn(() => undefined as string | undefined),
  cloneProjectTemplate: vi.fn(async (..._args: unknown[]) => {}),
  exitUnknownTemplate: vi.fn(),
  assertMachineReadyOrExit: vi.fn(async () => {}),
  initializeProject: vi.fn(async () => ({ ok: true, output: "" })),
  installServiceDependencies: vi.fn(async () => [] as Array<{ dir: string; ok: boolean }>),
  nextAvailableProjectDir: vi.fn((base: string) => base),
  runStackQuiet: vi.fn(async () => ({ ok: true, raw: "" })),
  listFrontendTargets: vi.fn(async () => [] as Array<{ name: string; url: string }>),
  pickReadyFrontend: vi.fn(async () => undefined),
  discoverResourcesWithProblems: vi.fn(() => ({ resources: [] as unknown[] })),
  getAllStacks: vi.fn(() => [] as string[]),
  openUrl: vi.fn(async () => true),
  stage: {
    update: vi.fn(),
    fail: vi.fn(),
    finish: vi.fn(),
    stop: vi.fn(),
  },
  stopDemoStack: vi.fn(async () => true),
  shouldMarkDemoFolder: vi.fn(() => false),
  markDemoFolder: vi.fn(),
  readProjectName: vi.fn(() => undefined as string | undefined),
  tryListStaleProjectVolumes: vi.fn(() => [] as string[]),
  foldersSharingProjectName: vi.fn(() => [] as string[]),
  removeProjectVolumes: vi.fn(() => [] as string[]),
  sharedNameRefusal: vi.fn(() => ({ message: "", hint: "", detail: "" })),
  sharedNameUnreadableRefusal: vi.fn(() => ({ message: "", hint: "", detail: "" })),
  checkColimaAsync: vi.fn(async () => ({ isColima: false, running: true })),
  ensureGlobalInstall: vi.fn(() => "present" as const),
  ensureNetworkCapacity: vi.fn(async () => ({ ok: true, removed: [] as string[] })),
  readStackProgress: vi.fn(async () => undefined),
  readSavedTiltPort: vi.fn(() => undefined as string | undefined),
  classifyTiltPorts: vi.fn(async () => ({ running: [] as number[] })),
  promptConfirm: vi.fn(async () => true),
}));

vi.mock("../../utils/latest-version.js", () => ({
  staleVersionNotice: mocks.staleVersionNotice,
}));

vi.mock("../../utils/native-demo.js", () => ({
  NATIVE_DEMO_DIR: "flisk-demo-native",
  nativeDemoReason: mocks.nativeDemoReason,
  isNativeDemoFolder: mocks.isNativeDemoFolder,
  runNativeDemo: mocks.runNativeDemo,
}));

vi.mock("../../utils/cli-invocation.js", () => ({ cliInvocation: mocks.cliInvocation }));

vi.mock("../../utils/container-engine.js", () => ({
  currentDockerContext: mocks.currentDockerContext,
}));

vi.mock("../../commands/project.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../commands/project.js")>()),
  cloneProjectTemplate: mocks.cloneProjectTemplate,
  exitUnknownTemplate: mocks.exitUnknownTemplate,
}));

vi.mock("../../utils/cold-preflight.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/cold-preflight.js")>()),
  assertMachineReadyOrExit: mocks.assertMachineReadyOrExit,
}));

vi.mock("../../utils/one-command.js", () => ({
  initializeProject: mocks.initializeProject,
  installServiceDependencies: mocks.installServiceDependencies,
  nextAvailableProjectDir: mocks.nextAvailableProjectDir,
  runStackQuiet: mocks.runStackQuiet,
}));

vi.mock("../../commands/open.js", () => ({
  listFrontendTargets: mocks.listFrontendTargets,
  pickReadyFrontend: mocks.pickReadyFrontend,
}));

vi.mock("../../utils/services.js", () => ({
  discoverResourcesWithProblems: mocks.discoverResourcesWithProblems,
  getAllStacks: mocks.getAllStacks,
}));

vi.mock("../../utils/url-actions.js", () => ({ openUrl: mocks.openUrl }));

vi.mock("../../utils/demo-stage.js", () => ({ createDemoStage: () => mocks.stage }));

vi.mock("../../utils/demo-reset.js", () => ({
  foldersSharingProjectName: mocks.foldersSharingProjectName,
  markDemoFolder: mocks.markDemoFolder,
  readProjectName: mocks.readProjectName,
  removeProjectVolumes: mocks.removeProjectVolumes,
  sharedNameRefusal: mocks.sharedNameRefusal,
  sharedNameUnreadableRefusal: mocks.sharedNameUnreadableRefusal,
  shouldMarkDemoFolder: mocks.shouldMarkDemoFolder,
  stopDemoStack: mocks.stopDemoStack,
  tryListStaleProjectVolumes: mocks.tryListStaleProjectVolumes,
}));

vi.mock("../../utils/colima.js", () => ({ checkColimaAsync: mocks.checkColimaAsync }));

vi.mock("../../utils/cli-command.js", () => ({
  ensureGlobalInstall: mocks.ensureGlobalInstall,
}));

vi.mock("../../utils/demo-networks.js", () => ({
  ensureNetworkCapacity: mocks.ensureNetworkCapacity,
}));

vi.mock("../../utils/stack-progress.js", () => ({
  readStackProgress: mocks.readStackProgress,
}));

vi.mock("../../utils/host-port-config.js", () => ({
  readSavedTiltPort: mocks.readSavedTiltPort,
}));

vi.mock("../../utils/tilt-port-owner.js", () => ({
  classifyTiltPorts: mocks.classifyTiltPorts,
}));

vi.mock("../../utils/prompt.js", () => ({ promptConfirm: mocks.promptConfirm }));

const baseInput = (overrides: Partial<DemoBootstrapInput> = {}): DemoBootstrapInput => ({
  argv: ["node", "flisk"],
  rootOptions: { keep: false, help: false, yes: false },
  version: "0.0.0-test",
  ...overrides,
});

describe("runDemoBootstrap", () => {
  let home: string;
  let workdir: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "boot-demo-home-"));
    workdir = mkdtempSync(join(tmpdir(), "boot-demo-cwd-"));
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    for (const value of Object.values(mocks)) {
      if (typeof value === "function") value.mockClear();
    }
    for (const fn of Object.values(mocks.stage)) fn.mockClear();
    mocks.staleVersionNotice.mockResolvedValue(null);
    mocks.nativeDemoReason.mockResolvedValue(null);
    mocks.isNativeDemoFolder.mockReturnValue(false);
    mocks.runNativeDemo.mockResolvedValue(0);
    mocks.cliInvocation.mockReturnValue(["flisk"]);
    mocks.currentDockerContext.mockReturnValue(undefined);
    mocks.cloneProjectTemplate.mockImplementation(async () => {});
    mocks.exitUnknownTemplate.mockImplementation(() => {});
    mocks.assertMachineReadyOrExit.mockResolvedValue(undefined);
    mocks.initializeProject.mockResolvedValue({ ok: true, output: "" });
    mocks.installServiceDependencies.mockResolvedValue([]);
    mocks.nextAvailableProjectDir.mockImplementation((base: string) => base);
    mocks.runStackQuiet.mockResolvedValue({ ok: true, raw: "" });
    mocks.listFrontendTargets.mockResolvedValue([]);
    mocks.pickReadyFrontend.mockResolvedValue(undefined);
    mocks.discoverResourcesWithProblems.mockReturnValue({ resources: [] });
    mocks.getAllStacks.mockReturnValue([]);
    mocks.openUrl.mockResolvedValue(true);
    mocks.stopDemoStack.mockResolvedValue(true);
    mocks.shouldMarkDemoFolder.mockReturnValue(false);
    mocks.readProjectName.mockReturnValue(undefined);
    mocks.tryListStaleProjectVolumes.mockReturnValue([]);
    mocks.foldersSharingProjectName.mockReturnValue([]);
    mocks.removeProjectVolumes.mockReturnValue([]);
    mocks.checkColimaAsync.mockResolvedValue({ isColima: false, running: true });
    mocks.ensureGlobalInstall.mockReturnValue("present");
    mocks.ensureNetworkCapacity.mockResolvedValue({ ok: true, removed: [] });
    mocks.readStackProgress.mockResolvedValue(undefined);
    mocks.readSavedTiltPort.mockReturnValue(undefined);
    mocks.classifyTiltPorts.mockResolvedValue({ running: [] });
    mocks.promptConfirm.mockResolvedValue(true);
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(workdir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const input = (overrides: Partial<DemoBootstrapInput> = {}): DemoBootstrapInput =>
    baseInput({ home: () => home, cwd: () => workdir, ...overrides });

  it("continues boot when the root options carry no template", async () => {
    expect(await runDemoBootstrap(input())).toBeUndefined();
    expect(mocks.nativeDemoReason).not.toHaveBeenCalled();
    expect(mocks.cloneProjectTemplate).not.toHaveBeenCalled();
  });

  it("warns about a stale CLI copy before the native demo decision (#4119)", async () => {
    mocks.nativeDemoReason.mockResolvedValue("--no-docker was passed");
    const code = await runDemoBootstrap(
      input({
        argv: ["node", "flisk", "demo", "--no-docker"],
        rootOptions: { keep: false, help: false, yes: false, template: "demo" },
        platform: "linux",
      }),
    );
    expect(code).toBe(0);
    expect(mocks.staleVersionNotice).toHaveBeenCalledWith("0.0.0-test");
    expect(mocks.nativeDemoReason).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "linux",
        argv: ["node", "flisk", "demo", "--no-docker"],
      }),
    );
    expect(mocks.runNativeDemo).toHaveBeenCalledWith(
      expect.objectContaining({
        destination: join(home, ".flisk", "flisk-demo-native"),
        reason: "--no-docker was passed",
        version: "0.0.0-test",
      }),
    );
  });

  it("resolves the native demo destination from --project against cwd", async () => {
    mocks.nativeDemoReason.mockResolvedValue("--no-docker was passed");
    mocks.runNativeDemo.mockResolvedValue(3);
    const code = await runDemoBootstrap(
      input({
        rootOptions: {
          keep: false,
          help: false,
          yes: false,
          template: "demo",
          project: "my-demo",
        },
      }),
    );
    expect(code).toBe(3);
    expect(mocks.runNativeDemo).toHaveBeenCalledWith(
      expect.objectContaining({ destination: resolve(workdir, "my-demo") }),
    );
  });

  it("runs the full demo when no native reason applies", async () => {
    mocks.cloneProjectTemplate.mockImplementation(async (...args: unknown[]) => {
      const destination = resolve(workdir, args[1] as string);
      mkdirSync(join(destination, ".flisk"), { recursive: true });
      writeFileSync(join(destination, ".flisk", "project.json"), "{}\n");
    });
    const code = await runDemoBootstrap(
      input({ rootOptions: { keep: false, help: false, yes: false, template: "restaurant" } }),
    );
    expect(code).toBe(0);
    expect(mocks.assertMachineReadyOrExit).toHaveBeenCalledWith({ scope: "scaffold" });
    expect(mocks.initializeProject).toHaveBeenCalled();
    expect(mocks.runStackQuiet).toHaveBeenCalled();
    expect(mocks.stage.finish).toHaveBeenCalled();
    expect(mocks.stage.stop).toHaveBeenCalled();
  });

  it("refuses native Windows before the template check", async () => {
    const code = await runDemoBootstrap(
      input({
        rootOptions: { keep: false, help: false, yes: false, template: "restaurant" },
        platform: "win32",
        env: {},
      }),
    );
    expect(code).toBe(1);
    expect(console.error).toHaveBeenCalled();
    expect(mocks.exitUnknownTemplate).not.toHaveBeenCalled();
    expect(mocks.cloneProjectTemplate).not.toHaveBeenCalled();
  });

  it("refuses an unknown template before the machine check", async () => {
    mocks.exitUnknownTemplate.mockImplementation(() => {
      throw new ExitSignal(1);
    });
    await expect(
      runDemoBootstrap(
        input({ rootOptions: { keep: false, help: false, yes: false, template: "nope" } }),
      ),
    ).rejects.toThrow(ExitSignal);
    expect(mocks.exitUnknownTemplate).toHaveBeenCalledWith("nope");
    expect(mocks.assertMachineReadyOrExit).not.toHaveBeenCalled();
  });

  it("refuses a previous demo folder that is not a Flisk project", async () => {
    const demoDir = join(home, ".flisk", "flisk-demo");
    mkdirSync(demoDir, { recursive: true });

    const code = await runDemoBootstrap(
      input({ rootOptions: { keep: false, help: false, yes: false, template: "demo" } }),
    );

    expect(code).toBe(1);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("already exists and is not a Flisk project"),
    );
    expect(mocks.stopDemoStack).not.toHaveBeenCalled();
    expect(mocks.cloneProjectTemplate).not.toHaveBeenCalled();
  });

  it("keeps the previous folder when the removal prompt is declined", async () => {
    const demoDir = join(home, ".flisk", "flisk-demo");
    mkdirSync(join(demoDir, ".flisk"), { recursive: true });
    writeFileSync(join(demoDir, ".flisk", "project.json"), "{}\n");
    const marker = join(demoDir, "keep-me.txt");
    writeFileSync(marker, "mine");
    mocks.promptConfirm.mockResolvedValue(false);
    const stdinTty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    const stdoutTty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    try {
      const code = await runDemoBootstrap(
        input({ rootOptions: { keep: false, help: false, yes: false, template: "demo" } }),
      );
      expect(code).toBe(1);
    } finally {
      if (stdinTty) Object.defineProperty(process.stdin, "isTTY", stdinTty);
      else delete (process.stdin as { isTTY?: boolean }).isTTY;
      if (stdoutTty) Object.defineProperty(process.stdout, "isTTY", stdoutTty);
      else delete (process.stdout as { isTTY?: boolean }).isTTY;
    }
    expect(mocks.promptConfirm).toHaveBeenCalled();
    expect(existsSync(marker)).toBe(true);
    expect(mocks.cloneProjectTemplate).not.toHaveBeenCalled();
  });

  it("removes and re-creates a previous demo with --yes, then finishes with 0", async () => {
    const demoDir = join(home, ".flisk", "flisk-demo");
    mkdirSync(join(demoDir, ".flisk"), { recursive: true });
    writeFileSync(join(demoDir, ".flisk", "project.json"), "{}\n");
    const marker = join(demoDir, "stale-marker.txt");
    writeFileSync(marker, "left over");
    mocks.cloneProjectTemplate.mockImplementation(async () => {
      mkdirSync(join(demoDir, ".flisk"), { recursive: true });
      writeFileSync(join(demoDir, ".flisk", "project.json"), "{}\n");
    });

    const code = await runDemoBootstrap(
      input({
        rootOptions: { keep: false, help: false, yes: true, template: "demo" },
      }),
    );

    expect(code).toBe(0);
    expect(mocks.stopDemoStack).toHaveBeenCalledWith(demoDir);
    expect(mocks.promptConfirm).not.toHaveBeenCalled();
    expect(existsSync(marker)).toBe(false);
    expect(mocks.cloneProjectTemplate).toHaveBeenCalledWith(
      "demo",
      join(home, ".flisk", "flisk-demo"),
      [],
      { quiet: true },
    );
    expect(mocks.stage.finish).toHaveBeenCalled();
  });

  it("stops before fetching when the Colima VM is down", async () => {
    mocks.checkColimaAsync.mockResolvedValue({ isColima: true, running: false });
    const code = await runDemoBootstrap(
      input({ rootOptions: { keep: false, help: false, yes: false, template: "restaurant" } }),
    );
    expect(code).toBe(1);
    expect(mocks.cloneProjectTemplate).not.toHaveBeenCalled();
  });
});

describe("demoDiskNotice", () => {
  it("reports the measured size, shortens the home path and names the cleanup (#5344)", () => {
    const home = mkdtempSync(join(tmpdir(), "disk-home-"));
    const folder = join(home, ".flisk", "flisk-demo");
    mkdirSync(join(folder, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(folder, "node_modules", "pkg", "index.js"), "x".repeat(2048));
    try {
      const notice = demoDiskNotice(folder, () => home);
      expect(notice).toContain("2.0 KB");
      expect(notice).toContain("~/.flisk/flisk-demo");
      expect(notice).toContain("flisk demo --reset");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("runDemoBootstrap --reset", () => {
  let home: string;
  let workdir: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "reset-home-"));
    workdir = mkdtempSync(join(tmpdir(), "reset-cwd-"));
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const value of Object.values(mocks)) {
      if (typeof value === "function") value.mockClear();
    }
    mocks.isNativeDemoFolder.mockReturnValue(false);
    mocks.stopDemoStack.mockResolvedValue(true);
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(workdir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const resetInput = (overrides: Partial<DemoBootstrapInput> = {}): DemoBootstrapInput =>
    baseInput({
      home: () => home,
      cwd: () => workdir,
      rootOptions: { keep: false, reset: true, help: false, yes: true, template: "demo" },
      ...overrides,
    });

  it("reports when there is no demo folder and starts nothing", async () => {
    expect(await runDemoBootstrap(resetInput())).toBe(0);
    expect(mocks.stopDemoStack).not.toHaveBeenCalled();
    expect(mocks.runStackQuiet).not.toHaveBeenCalled();
    expect(mocks.cloneProjectTemplate).not.toHaveBeenCalled();
  });

  it("removes only marked demo folders and reports the space reclaimed", async () => {
    const docker = join(home, ".flisk", "flisk-demo");
    mkdirSync(join(docker, ".flisk"), { recursive: true });
    writeFileSync(join(docker, ".flisk", "demo-docker.json"), "{}\n");
    writeFileSync(join(docker, "big.bin"), "x".repeat(4096));

    const unmarked = join(home, ".flisk", "other");
    mkdirSync(unmarked, { recursive: true });
    writeFileSync(join(unmarked, "keep.txt"), "keep");

    expect(await runDemoBootstrap(resetInput())).toBe(0);
    expect(mocks.stopDemoStack).toHaveBeenCalledWith(docker);
    expect(existsSync(docker)).toBe(false);
    expect(existsSync(unmarked)).toBe(true);
  });

  it("honours --project and leaves unrelated folders alone", async () => {
    const project = join(workdir, "my-demo");
    mkdirSync(join(project, ".flisk"), { recursive: true });
    writeFileSync(join(project, ".flisk", "demo-docker.json"), "{}\n");
    writeFileSync(join(project, "big.bin"), "x".repeat(4096));

    expect(
      await runDemoBootstrap(
        resetInput({
          rootOptions: {
            keep: false,
            reset: true,
            help: false,
            yes: true,
            template: "demo",
            project: "my-demo",
          },
        }),
      ),
    ).toBe(0);
    expect(mocks.stopDemoStack).toHaveBeenCalledWith(project);
    expect(existsSync(project)).toBe(false);
  });

  it("deletes nothing when a stack cannot be stopped", async () => {
    const docker = join(home, ".flisk", "flisk-demo");
    mkdirSync(join(docker, ".flisk"), { recursive: true });
    writeFileSync(join(docker, ".flisk", "demo-docker.json"), "{}\n");
    mocks.stopDemoStack.mockRejectedValueOnce(new Error("docker down failed"));

    expect(await runDemoBootstrap(resetInput())).toBe(1);
    expect(existsSync(docker)).toBe(true);
  });

  it("removes a native demo folder detected by its marker", async () => {
    const native = join(home, ".flisk", "flisk-demo-native");
    mkdirSync(join(native, ".flisk"), { recursive: true });
    writeFileSync(join(native, ".flisk", "demo-native.json"), "{}\n");
    mocks.isNativeDemoFolder.mockImplementation((dir: string) => dir === native);

    expect(await runDemoBootstrap(resetInput())).toBe(0);
    expect(mocks.stopDemoStack).not.toHaveBeenCalled();
    expect(existsSync(native)).toBe(false);
  });
});

describe("countLabel", () => {
  it("agrees with itself for 0, 1 and many", () => {
    expect(countLabel(0, "file")).toBe("0 files");
    expect(countLabel(1, "file")).toBe("1 file");
    expect(countLabel(240, "file")).toBe("240 files");
    expect(countLabel(1, "app service")).toBe("1 app service");
  });
});

describe("countFiles", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "boot-count-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("counts files under a tree", () => {
    writeFileSync(join(dir, "a.txt"), "a");
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "b.txt"), "b");
    expect(countFiles(dir)).toBe(2);
  });

  it("skips the named directories", () => {
    mkdirSync(join(dir, "node_modules"));
    writeFileSync(join(dir, "node_modules", "dep.js"), "x");
    writeFileSync(join(dir, "keep.txt"), "k");
    expect(countFiles(dir, ["node_modules"])).toBe(1);
  });

  it("reports 0 for a missing directory instead of throwing", () => {
    expect(countFiles(join(dir, "does-not-exist"))).toBe(0);
  });
});

describe("firstMachineFailure", () => {
  it.each([
    [undefined, undefined],
    ["", undefined],
    ["PASS Docker is running\nPASS Tilt is installed", undefined],
    [
      "PASS Docker is running\n  FAIL Docker Compose is not available\n  FAIL Tilt is not installed",
      "Docker Compose is not available",
    ],
    ["some output\nFAIL   check with spaces  \nFAIL second", "check with spaces"],
  ])("for %j returns %j", (raw, expected) => {
    expect(firstMachineFailure(raw)).toBe(expected);
  });
});

describe("writeLog", () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), "boot-log-home-"));
  });

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
  });

  it("writes the lines under <home>/.flisk/logs and returns the path", () => {
    const path = writeLog(["line one", "line two"], () => homeDir);
    expect(path).toBeDefined();
    expect(path?.startsWith(join(homeDir, ".flisk", "logs"))).toBe(true);
    expect(readFileSync(path as string, "utf8")).toBe("line one\nline two");
  });

  it("returns undefined instead of throwing when the log dir cannot be made", () => {
    writeFileSync(join(homeDir, ".flisk"), "a file blocks the directory");
    expect(writeLog(["x"], () => homeDir)).toBeUndefined();
  });
});
