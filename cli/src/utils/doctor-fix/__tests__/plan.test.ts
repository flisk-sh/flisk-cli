// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DoctorAction } from "../../../types/index.js";
import { type ColimaStatus, nativeLimaPath } from "../../colima.js";
import { applyDoctorFixes, hasFailedActions } from "../apply.js";
import type { DockerNetwork, DoctorFixDeps } from "../deps.js";
import { planDoctorFixes } from "../plan.js";

vi.mock("../../colima.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../colima.js")>()),
  nativeLimaPath: vi.fn(() => undefined),
}));

beforeEach(() => {
  vi.mocked(nativeLimaPath).mockReset().mockReturnValue(undefined);
});

const net = (name: string, containers = 0): DockerNetwork => ({ name, containers });

interface FakeDeps {
  deps: DoctorFixDeps;
  colimaState: ColimaStatus;
  dockerUp: { value: boolean };
  calls: string[];
  removed: string[];
}

function fakeDocker(
  networks: DockerNetwork[] = [],
  options: {
    alive?: number[];
    tilt?: Record<number, "healthy" | "stale" | "unknown">;
    freeGib?: number | null;
    buildCache?: string | null;
    dangling?: number;
    bloat?: { diskFileBytes: number; dockerBytes: number } | null;
  } = {},
): FakeDeps {
  const colimaState: ColimaStatus = { isColima: false, running: true };
  const dockerUp = { value: true };
  const calls: string[] = [];
  const removed: string[] = [];
  const deps: DoctorFixDeps = {
    listNetworks: async () => {
      calls.push("listNetworks");
      return networks;
    },
    removeNetwork: async (name) => {
      calls.push(`removeNetwork:${name}`);
      removed.push(name);
    },
    isProcessAlive: (pid) => (options.alive ?? []).includes(pid),
    tiltStatus: async (pid) => options.tilt?.[pid] ?? "unknown",
    stopProcess: (pid) => {
      calls.push(`stopProcess:${pid}`);
    },
    freeDiskGib: () => options.freeGib ?? 100,
    reclaimable: async () => ({
      buildCache: options.buildCache ?? null,
      danglingImages: options.dangling ?? 0,
    }),
    prune: async (kind) => {
      calls.push(`prune:${kind}`);
    },
    trimColima: async () => {
      calls.push("trimColima");
    },
    colima: async (action) => {
      calls.push(`colima:${action}`);
    },
    colimaStatus: () => colimaState,
    dockerAnswers: () => dockerUp.value,
    ...(options.bloat !== undefined ? { colimaDiskBloat: async () => options.bloat ?? null } : {}),
  };
  return { deps, colimaState, dockerUp, calls, removed };
}

describe("planDoctorFixes ordering", () => {
  it("plans tilt stops, then the colima repair, then disk reclaim, then networks", async () => {
    const { deps, colimaState, dockerUp } = fakeDocker(
      [net("shop_backend"), net("flisk_doctor_probe_9"), net("umami_backend")],
      { tilt: { 7: "stale" }, freeGib: 3, buildCache: "2GB", dangling: 1 },
    );
    colimaState.isColima = true;
    dockerUp.value = false;
    const plan = await planDoctorFixes("shop", deps, { tiltPids: [7] });
    expect(plan.map((a) => a.id)).toEqual([
      "stop-tilt:7",
      "colima:restart",
      "prune:builder",
      "prune:images",
      "trim:colima",
      "remove-network:shop_backend",
      "remove-network:flisk_doctor_probe_9",
    ]);
  });

  it("stops every stale Tilt while live ones still guard the project networks", async () => {
    const { deps } = fakeDocker([net("shop_backend")], {
      tilt: { 7: "stale", 8: "healthy", 9: "stale" },
    });
    const plan = await planDoctorFixes("shop", deps, { tiltPids: [7, 8, 9] });
    expect(plan.map((a) => [a.id, a.status])).toEqual([
      ["stop-tilt:7", "planned"],
      ["stop-tilt:9", "planned"],
      ["remove-network:shop_backend", "skipped"],
    ]);
    expect(plan[2]?.reason).toContain("pid 8");
    expect(plan[2]?.reason).not.toContain("7");
  });

  it("keeps the order Docker listed the networks in", async () => {
    const { deps } = fakeDocker([
      net("flisk_doctor_probe_2"),
      net("shop_backend"),
      net("flisk_doctor_probe_1"),
      net("shop_database"),
    ]);
    const plan = await planDoctorFixes("shop", deps);
    expect(plan.map((a) => a.id)).toEqual([
      "remove-network:flisk_doctor_probe_2",
      "remove-network:shop_backend",
      "remove-network:flisk_doctor_probe_1",
      "remove-network:shop_database",
    ]);
  });
});

describe("planDoctorFixes network guards", () => {
  it("reports attached containers before checking whether a probe's process is alive", async () => {
    const { deps } = fakeDocker([net("flisk_doctor_probe_42", 1)], { alive: [42] });
    const [action] = await planDoctorFixes(undefined, deps);
    expect(action?.status).toBe("skipped");
    expect(action?.reason).toBe("1 container(s) still attached");
  });

  it("names the owner on a skipped machine-scope network with containers", async () => {
    const { deps } = fakeDocker([net("umami_traefik-public"), net("umami_database", 2)]);
    const plan = await planDoctorFixes("shop", deps, { machine: true });
    const owned = plan.find((a) => a.id === "remove-network:umami_database");
    expect(owned?.scope).toBe("machine");
    expect(owned?.status).toBe("skipped");
    expect(owned?.reason).toBe("2 container(s) still attached");
  });

  it("plans nothing when the project has no networks and no findings", async () => {
    const { deps } = fakeDocker([net("umami_backend"), net("bridge")]);
    expect(await planDoctorFixes("shop", deps)).toEqual([]);
  });
});

describe("planDoctorFixes Colima repair", () => {
  it("uses the reported problem as the start reason", async () => {
    const { deps, colimaState, dockerUp } = fakeDocker();
    colimaState.isColima = true;
    colimaState.running = false;
    colimaState.problem = "colima VM stopped unexpectedly";
    dockerUp.value = false;
    const plan = await planDoctorFixes("shop", deps);
    const start = plan.find((a) => a.id === "colima:start");
    expect(start?.reason).toBe("colima VM stopped unexpectedly");
  });

  it("plans the native-lima repair with the detected limactl directory", async () => {
    vi.mocked(nativeLimaPath).mockReturnValue("/opt/homebrew/bin");
    const { deps, colimaState, dockerUp } = fakeDocker();
    colimaState.isColima = true;
    colimaState.running = false;
    colimaState.problem = "Lima is installed as an x86_64 build";
    dockerUp.value = false;
    const plan = await planDoctorFixes("shop", deps);
    const action = plan.find((a) => a.id === "colima:native-lima");
    expect(action?.command).toBe('PATH="/opt/homebrew/bin:$PATH" colima start');
    expect(action?.reason).toContain("/opt/homebrew/bin");
  });

  it("plans a brew reinstall when no native limactl exists", async () => {
    vi.mocked(nativeLimaPath).mockReturnValue(undefined);
    const { deps, colimaState, dockerUp } = fakeDocker();
    colimaState.isColima = true;
    colimaState.running = false;
    colimaState.problem = "Lima is installed as an x86_64 build";
    dockerUp.value = false;
    const plan = await planDoctorFixes("shop", deps);
    const action = plan.find((a) => a.id === "colima:native-lima");
    expect(action?.command).toBe("brew reinstall lima");
    expect(action?.reason).toContain("x86_64");
  });

  it("plans no colima repair when Docker does not run on Colima", async () => {
    const { deps, dockerUp } = fakeDocker();
    dockerUp.value = false;
    const plan = await planDoctorFixes("shop", deps);
    expect(plan.some((a) => a.id.startsWith("colima:"))).toBe(false);
  });
});

describe("planDoctorFixes disk reclaim", () => {
  it("reclaims only below the warn threshold", async () => {
    const atLimit = fakeDocker([], { freeGib: 15, buildCache: "5GB", dangling: 3 });
    expect(await planDoctorFixes("shop", atLimit.deps)).toEqual([]);
    const justUnder = fakeDocker([], { freeGib: 14.9, buildCache: "5GB", dangling: 3 });
    expect((await planDoctorFixes("shop", justUnder.deps)).map((a) => a.id)).toEqual([
      "prune:builder",
      "prune:images",
    ]);
  });

  it("skips an empty build cache in every reported spelling", async () => {
    for (const buildCache of ["0B", "0.0B", "0 B", "0.00 b"]) {
      const { deps } = fakeDocker([], { freeGib: 3, buildCache, dangling: 0 });
      const plan = await planDoctorFixes("shop", deps);
      expect(
        plan.some((a) => a.id === "prune:builder"),
        buildCache,
      ).toBe(false);
    }
    const { deps } = fakeDocker([], { freeGib: 3, buildCache: "0GB", dangling: 0 });
    expect((await planDoctorFixes("shop", deps)).map((a) => a.id)).toEqual(["prune:builder"]);
  });

  it("plans no trim when the disk report says nothing is bloated or the probe is absent", async () => {
    const noBloat = fakeDocker([], { bloat: null });
    expect((await planDoctorFixes("shop", noBloat.deps)).some((a) => a.id === "trim:colima")).toBe(
      false,
    );
    const noProbe = fakeDocker([]);
    expect((await planDoctorFixes("shop", noProbe.deps)).some((a) => a.id === "trim:colima")).toBe(
      false,
    );
  });
});

describe("planDoctorFixes dep failures", () => {
  it("lets a reclaimable failure through instead of guessing", async () => {
    const { deps } = fakeDocker([], { freeGib: 3 });
    deps.reclaimable = async () => {
      throw new Error("docker system df timed out");
    };
    await expect(planDoctorFixes("shop", deps)).rejects.toThrow("docker system df timed out");
  });

  it("lets a tiltStatus failure through instead of killing on a guess", async () => {
    const { deps } = fakeDocker([]);
    deps.tiltStatus = async () => {
      throw new Error("lsof failed");
    };
    await expect(planDoctorFixes("shop", deps, { tiltPids: [7] })).rejects.toThrow("lsof failed");
  });
});

describe("applyDoctorFixes against fakes", () => {
  const planned = (id: string): DoctorAction => ({
    id,
    check: "check",
    scope: "host",
    command: `run ${id}`,
    status: "planned",
    reason: "because",
  });

  it("passes non-planned and dry-run actions through without asking or touching deps", async () => {
    const { deps, calls } = fakeDocker();
    const skipped: DoctorAction = { ...planned("remove-network:x"), status: "skipped" };
    const confirm = vi.fn(async () => true);
    const results = await applyDoctorFixes(
      [skipped, planned("remove-network:y")],
      { dryRun: true, confirm },
      deps,
    );
    expect(results[0]).toBe(skipped);
    expect(results[1]?.status).toBe("planned");
    expect(confirm).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("asks about each action and runs the confirmed ones in plan order", async () => {
    const { deps, calls } = fakeDocker();
    const asked: string[] = [];
    const results = await applyDoctorFixes(
      [
        planned("stop-tilt:7"),
        planned("prune:builder"),
        planned("trim:colima"),
        planned("colima:start"),
        planned("remove-network:shop_backend"),
      ],
      {
        dryRun: false,
        confirm: async (a) => {
          asked.push(a.id);
          return a.id !== "trim:colima";
        },
      },
      deps,
    );
    expect(asked).toEqual([
      "stop-tilt:7",
      "prune:builder",
      "trim:colima",
      "colima:start",
      "remove-network:shop_backend",
    ]);
    expect(calls).toEqual([
      "stopProcess:7",
      "prune:builder",
      "colima:start",
      "removeNetwork:shop_backend",
    ]);
    expect(results.map((a) => a.status)).toEqual([
      "applied",
      "applied",
      "skipped",
      "applied",
      "applied",
    ]);
  });

  it("keeps going after a failed action so a re-run converges", async () => {
    const { deps, calls, removed } = fakeDocker();
    deps.colima = async () => {
      throw new Error("colima start failed\nsecond line");
    };
    const results = await applyDoctorFixes(
      [planned("colima:start"), planned("remove-network:shop_backend")],
      { dryRun: false, confirm: async () => true },
      deps,
    );
    expect(results[0]?.status).toBe("failed");
    expect(results[0]?.reason).toBe("Error: colima start failed");
    expect(removed).toEqual(["shop_backend"]);
    expect(hasFailedActions(results)).toBe(true);
    expect(calls).toEqual(["removeNetwork:shop_backend"]);
  });

  it("reports a prune failure but still applies the next prune kind", async () => {
    const { deps, calls } = fakeDocker();
    deps.prune = async (kind) => {
      calls.push(`prune:${kind}`);
      if (kind === "builder") throw new Error("daemon gone");
    };
    const results = await applyDoctorFixes(
      [planned("prune:builder"), planned("prune:images")],
      { dryRun: false, confirm: async () => true },
      deps,
    );
    expect(results.map((a) => a.status)).toEqual(["failed", "applied"]);
    expect(calls).toEqual(["prune:builder", "prune:images"]);
  });
});

describe("hasFailedActions", () => {
  it("is false for an empty or fully applied result set", () => {
    expect(hasFailedActions([])).toBe(false);
    const applied: DoctorAction = {
      id: "x",
      check: "c",
      scope: "host",
      command: "c",
      status: "applied",
      reason: "done",
    };
    expect(hasFailedActions([applied])).toBe(false);
  });
});
