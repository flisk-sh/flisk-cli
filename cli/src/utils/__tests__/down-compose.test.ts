// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  composeProjectsUnder,
  findRunningFliskProjects,
  knownProjectRoots,
  type NativeRunLookup,
  probeProjectIdle,
  projectComposeProjects,
  stopComposeProjectsUnder,
  stopProjectComposeProjects,
} from "../down-compose.js";
import type { NativeRunState } from "../native-runtime.js";
import { readNativeRunState } from "../native-runtime.js";
import { recordProjectRoot } from "../project-registry.js";

const NO_NATIVE_RUNS: NativeRunLookup = {
  roots: () => [],
  readState: () => null,
  isAlive: async () => false,
};

const WINDOWS_TILTFILE = "C:\\work\\shop\\.flisk\\.flisk-out\\Tiltfile";

/** The `pid<TAB>commandLine` output of the win32 process lookup (PowerShell, Get-CimInstance Win32_Process). */
const WINDOWS_TILT_PROCESSES = [
  `1234\t"C:\\Program Files\\Tilt\\tilt.exe" up -f "${WINDOWS_TILTFILE}" -- --focus=app`,
  `1235\tC:\\tools\\tilt.exe up -f "C:\\work\\my blog\\.flisk\\.flisk-out\\Tiltfile"`,
  `1236\tC:\\tools\\tilt.exe up -f ${WINDOWS_TILTFILE}`,
  `1237\tC:\\tools\\tilt.exe down -f ${WINDOWS_TILTFILE}`,
  `1238\tC:\\tools\\tilt.exe up -f C:\\work\\other\\Tiltfile`,
  `1239\tC:\\tools\\tilt.exe up -f C:\\work\\copy\\.flisk\\.flisk-out\\Tiltfile.backup`,
  `1240\tC:\\tools\\vim.exe up -f ${WINDOWS_TILTFILE}`,
  `1241\tC:\\tools\\tilt.exe up -f C:\\work\\deleted\\.flisk\\.flisk-out\\Tiltfile`,
  "invalid line without command",
].join("\r\n");

const windowsProcessRunner = vi.fn((command: string, _args: string[]) =>
  command === "powershell.exe" ? WINDOWS_TILT_PROCESSES : "",
);

describe("findRunningFliskProjects", () => {
  const ps = [
    "  100 /opt/homebrew/bin/tilt up -f /work/shop/.flisk/.flisk-out/Tiltfile -- --focus=app migrations web",
    "  101 /usr/local/bin/tilt up -f /work/my blog/.flisk/.flisk-out/Tiltfile",
    // A second Tilt for the same project counts once.
    "  102 tilt up -f /work/shop/.flisk/.flisk-out/Tiltfile",
    // Not `tilt up`, not a Flisk Tiltfile, a copy of one, a relative path, or not tilt at all.
    "  103 /opt/homebrew/bin/tilt down -f /work/gone/.flisk/.flisk-out/Tiltfile",
    "  104 /opt/homebrew/bin/tilt up -f /work/plain/Tiltfile",
    "  105 tilt up -f /work/copy/.flisk/.flisk-out/Tiltfile.backup",
    "  106 tilt up -f .flisk/.flisk-out/Tiltfile",
    "  107 vim /work/edit/.flisk/.flisk-out/Tiltfile",
    // Its project.json was removed after Tilt started.
    "  108 tilt up -f /work/deleted/.flisk/.flisk-out/Tiltfile",
    "  invalid line without command",
  ].join("\n");
  const isProject = (root: string) => root !== "/work/deleted";

  it("returns the roots of Flisk projects with a tilt up running, each once, sorted", async () => {
    expect(await findRunningFliskProjects("darwin", () => ps, isProject, NO_NATIVE_RUNS)).toEqual([
      "/work/my blog",
      "/work/shop",
    ]);
  });

  it("returns nothing when ps fails", async () => {
    expect(
      await findRunningFliskProjects(
        "linux",
        () => {
          throw new Error("no ps");
        },
        isProject,
        NO_NATIVE_RUNS,
      ),
    ).toEqual([]);
  });

  it("finds the roots of Flisk projects with a tilt up on Windows via PowerShell", async () => {
    windowsProcessRunner.mockClear();
    const isWindowsProject = (root: string) => root !== "C:\\work\\deleted";
    expect(
      await findRunningFliskProjects(
        "win32",
        windowsProcessRunner,
        isWindowsProject,
        NO_NATIVE_RUNS,
      ),
    ).toEqual(["C:\\work\\my blog", "C:\\work\\shop"]);
    expect(windowsProcessRunner).toHaveBeenCalledTimes(1);
    const [command, args] = windowsProcessRunner.mock.calls[0] as [string, string[]];
    expect(command).toBe("powershell.exe");
    expect(args).toContain("-NoProfile");
    expect(args).toContain("-Command");
    expect(args.join(" ")).toContain("Get-CimInstance Win32_Process");
  });

  it("returns nothing on Windows when PowerShell fails", async () => {
    expect(
      await findRunningFliskProjects(
        "win32",
        () => {
          throw new Error("spawn powershell.exe ENOENT");
        },
        (root) => Boolean(root),
        NO_NATIVE_RUNS,
      ),
    ).toEqual([]);
  });
});

describe("findRunningFliskProjects native runs (#4412)", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function tempDir(prefix: string): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
    dirs.push(dir);
    return dir;
  }

  function makeNativeProject(
    home: string,
    name: string,
    state: NativeRunState | null,
    recorded = true,
  ): string {
    const root = tempDir(`flisk-native-${name}-`);
    mkdirSync(join(root, ".flisk", "native"), { recursive: true });
    writeFileSync(join(root, ".flisk", "project.json"), JSON.stringify({ project: { name } }));
    if (state) writeFileSync(join(root, ".flisk", "native", "run.json"), JSON.stringify(state));
    if (recorded) recordProjectRoot(root, { home });
    return root;
  }

  function state(pid: number, pidStartTime: string): NativeRunState {
    return { pid, pidStartTime, startedAt: new Date().toISOString(), services: {} };
  }

  function lookupFor(home: string, isAlive: (state: NativeRunState) => boolean): NativeRunLookup {
    // The fake stands in for `isNativeRunSupervisorAlive`, whose pid-identity check is covered in native-runtime.test.ts.
    return {
      roots: () => knownProjectRoots(home),
      readState: readNativeRunState,
      isAlive: async (run) => isAlive(run),
    };
  }

  it("finds recorded native projects on Windows, without asking ps", async () => {
    const home = tempDir("flisk-native-home-");
    const live = makeNativeProject(home, "live", state(101, "current-start-time"));
    makeNativeProject(home, "stale", state(202, "reused-by-another-process"));
    makeNativeProject(home, "stopped", null);
    makeNativeProject(home, "unrecorded", state(303, "current-start-time"), false);

    expect(
      await findRunningFliskProjects(
        "win32",
        () => {
          throw new Error("ps must not be called on Windows");
        },
        undefined,
        lookupFor(home, (run) => run.pidStartTime === "current-start-time"),
      ),
    ).toEqual([live]);
  });

  it("ignores a recorded run whose supervisor is no longer alive", async () => {
    const home = tempDir("flisk-native-home-");
    makeNativeProject(home, "gone", state(404, "current-start-time"));

    expect(
      await findRunningFliskProjects(
        "win32",
        undefined,
        undefined,
        lookupFor(home, () => false),
      ),
    ).toEqual([]);
  });

  it("keeps tilt discovery and counts a project running both ways once", async () => {
    const home = tempDir("flisk-native-home-");
    const nativeOnly = makeNativeProject(home, "native", state(505, "current-start-time"));
    const both = makeNativeProject(home, "both", state(606, "current-start-time"));
    const tiltOnly = "/work/tilt-only";
    const ps = [
      `  100 /usr/local/bin/tilt up -f ${both}/.flisk/.flisk-out/Tiltfile`,
      `  101 tilt up -f ${tiltOnly}/.flisk/.flisk-out/Tiltfile`,
    ].join("\n");
    const isProject = (root: string) => root === tiltOnly || root === nativeOnly || root === both;

    expect(
      await findRunningFliskProjects(
        "darwin",
        () => ps,
        isProject,
        lookupFor(home, () => true),
      ),
    ).toEqual([both, nativeOnly, tiltOnly].sort());
  });
});

describe("the Compose fallback of flisk down (#2899)", () => {
  // `docker ps -a` lines: Compose project, then the folder of its first compose file.
  const PS = [
    "shop-shop-autogenerated\t/work/shop/services/shop/.autogenerated",
    "shop-traefik\t/work/shop/.flisk/.flisk-out",
    "shop-traefik\t/work/shop/.flisk/.flisk-out",
    "shop-admin-web-autogenerated\t/work/shop-admin/services/web/.autogenerated",
    "other\t/work/other",
    "\t",
    "loose\t",
  ].join("\n");

  it("finds the Compose projects whose files live in the project, not those of a project with a longer name", () => {
    const runner = vi.fn(() => PS);
    expect(projectComposeProjects("/work/shop", runner)).toEqual([
      "shop-shop-autogenerated",
      "shop-traefik",
    ]);
    expect(runner).toHaveBeenCalledWith("docker", expect.arrayContaining(["ps", "-a"]));
  });

  it("leaves a hand-written Compose project and a nested Flisk project alone", () => {
    const root = mkdtempSync(join(tmpdir(), "flisk-down-"));
    try {
      mkdirSync(join(root, "services", "api", ".autogenerated"), { recursive: true });
      mkdirSync(join(root, ".flisk", ".flisk-out"), { recursive: true });
      mkdirSync(join(root, "tools", "legacy"), { recursive: true });
      mkdirSync(join(root, "worktree", ".flisk"), { recursive: true });
      writeFileSync(join(root, "worktree", ".flisk", "project.json"), "{}");
      mkdirSync(join(root, "worktree", "services", "api", ".autogenerated"), { recursive: true });
      const ps = [
        `mine\t${join(root, "services", "api", ".autogenerated")}`,
        `mine-gateway\t${join(root, ".flisk", ".flisk-out")}`,
        `legacy\t${join(root, "tools", "legacy")}`,
        `nested\t${join(root, "worktree", "services", "api", ".autogenerated")}`,
        `nested-gateway\t${join(root, "worktree", ".flisk", ".flisk-out")}`,
      ].join("\n");
      expect(projectComposeProjects(root, () => ps)).toEqual(["mine", "mine-gateway"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("stops each one with docker compose down and keeps volumes", () => {
    const calls: string[][] = [];
    const runner = (command: string, args: string[]): string => {
      calls.push([command, ...args]);
      return args[0] === "ps" ? PS : "";
    };
    expect(stopProjectComposeProjects("/work/shop", runner)).toEqual({
      stopped: ["shop-shop-autogenerated", "shop-traefik"],
      failed: [],
    });
    const downs = calls.filter((call) => call[1] === "compose");
    expect(downs).toEqual([
      ["docker", "compose", "-p", "shop-shop-autogenerated", "down", "--remove-orphans"],
      ["docker", "compose", "-p", "shop-traefik", "down", "--remove-orphans"],
    ]);
    expect(downs.flat()).not.toContain("-v");
  });

  it("reports a Compose project Docker refused to stop", () => {
    const runner = (_command: string, args: string[]): string => {
      if (args[0] === "ps") return PS;
      if (args[2] === "shop-traefik") {
        throw Object.assign(new Error("failed"), { stderr: "permission denied\nmore" });
      }
      return "";
    };
    expect(stopProjectComposeProjects("/work/shop", runner)).toEqual({
      stopped: ["shop-shop-autogenerated"],
      failed: [{ name: "shop-traefik", reason: "permission denied" }],
    });
  });
});

describe("containers an older layout left in a folder (#4124)", () => {
  const ps = [
    "flisk_demo\t/home/me/.flisk/flisk-demo/services/platform/database-management",
    "flisk_demo_traefik\t/home/me/.flisk/flisk-demo/.tdk/.tdk-out",
    "other\t/home/me/.flisk/flisk-demo-2/services/x",
    "elsewhere\t/home/me/shop",
    "nolabel\t",
  ].join("\n");

  it("finds every project whose working folder is the folder or inside it, and not a sibling with the same prefix", () => {
    expect(composeProjectsUnder("/home/me/.flisk/flisk-demo", () => ps)).toEqual([
      "flisk_demo",
      "flisk_demo_traefik",
    ]);
  });

  it("stops each with compose down, and reports one that fails", () => {
    const calls: string[][] = [];
    const runner = (_cmd: string, args: string[]): string => {
      if (args[0] === "ps") return ps;
      calls.push(args);
      if (args[2] === "flisk_demo_traefik") throw new Error("boom");
      return "";
    };
    const result = stopComposeProjectsUnder("/home/me/.flisk/flisk-demo", runner);
    expect(calls.map((c) => c[2])).toEqual(["flisk_demo", "flisk_demo_traefik"]);
    expect(result.stopped).toEqual(["flisk_demo"]);
    expect(result.failed.map((f) => f.name)).toEqual(["flisk_demo_traefik"]);
  });

  it("does nothing when Docker cannot be listed", () => {
    const runner = (): string => {
      throw new Error("no docker");
    };
    expect(stopComposeProjectsUnder("/home/me/x", runner)).toEqual({ stopped: [], failed: [] });
  });

  it("flisk down recognises the legacy .tdk/.tdk-out folder", () => {
    const legacy = "p\t/work/shop/.tdk/.tdk-out";
    expect(projectComposeProjects("/work/shop", () => legacy)).toEqual(["p"]);
  });
});

describe("probeProjectIdle (#4173)", () => {
  const root = "/work/shop";
  const TILTFILE = `${root}/.flisk/.flisk-out/Tiltfile`;

  it("starts ps, docker ps -a and docker network ls together and asks for containers once", async () => {
    const calls: Array<[string, string[]]> = [];
    let releasePs!: () => void;
    const psGate = new Promise<void>((resolve) => {
      releasePs = resolve;
    });
    const commandRunner = vi.fn(async (command: string, args: string[]) => {
      calls.push([command, args]);
      if (command === "ps") await psGate;
      if (command === "docker" && args[0] === "network") return "shop_backend\n";
      // No container belongs to this project; the blank line is what `docker ps -a --format` prints.
      return "\t\n";
    });

    const probe = probeProjectIdle(root, TILTFILE, {
      platform: "darwin",
      listNetworks: true,
      commandRunner,
    });
    // If the calls were serial, ps would wait for the gate before the other two could start.
    await vi.waitFor(() => expect(calls).toHaveLength(3));
    releasePs();

    expect(await probe).toEqual({ idle: true, networkNames: ["shop_backend"] });
    expect(calls.filter(([command]) => command === "ps")).toHaveLength(1);
    expect(
      calls.filter(([command, args]) => command === "docker" && args[0] === "ps"),
    ).toHaveLength(1);
    expect(
      calls.filter(([command, args]) => command === "docker" && args[0] === "network"),
    ).toHaveLength(1);
  });

  it("treats a failed container list as not idle, even when the networks were read", async () => {
    const commandRunner = vi.fn(async (command: string, args: string[]) => {
      if (command === "docker" && args[0] === "ps") throw new Error("daemon gone");
      if (command === "docker" && args[0] === "network") return "shop_backend\n";
      return "";
    });

    expect(
      await probeProjectIdle(root, TILTFILE, {
        platform: "darwin",
        listNetworks: true,
        commandRunner,
      }),
    ).toEqual({ idle: false, networkNames: ["shop_backend"] });
  });

  it("treats an unreadable process list as not idle", async () => {
    const commandRunner = vi.fn(async (command: string) => {
      if (command === "ps") throw new Error("no ps");
      return "\t\n";
    });

    expect(
      (
        await probeProjectIdle(root, TILTFILE, {
          platform: "darwin",
          commandRunner,
        })
      ).idle,
    ).toBe(false);
  });
});
