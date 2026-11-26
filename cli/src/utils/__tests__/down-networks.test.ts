// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it, vi } from "vitest";
import {
  fliskNetworkOwner,
  fliskNetworkPrefixes,
  planProjectNetworkPrune,
  projectNetworkNames,
  pruneProjectNetworks,
} from "../down-networks.js";

describe("projectNetworkNames", () => {
  it("prefixes the engine's network names with the underscored project name", () => {
    const names = projectNetworkNames("my-shop");
    expect(names).toContain("my_shop_traefik-public");
    expect(names).toContain("my_shop_traefik-private");
    expect(names).toContain("my_shop_backend");
    expect(names).toContain("my_shop_database");
    expect(names).toContain("my_shop_infisical-network");
    expect(names).toContain("my_shop_verdaccio-network");
    expect(names).toContain("my_shop_proxy");
    expect(names).toHaveLength(7);
  });

  it("handles multi-hyphen and non-hyphen project names", () => {
    const multi = projectNetworkNames("deeply-nested-app-name");
    expect(multi[0]).toBe("deeply_nested_app_name_traefik-public");

    const single = projectNetworkNames("flisk");
    expect(single[0]).toBe("flisk_traefik-public");
  });
});

describe("fliskNetworkPrefixes", () => {
  it("extracts unique project prefixes from traefik-public and traefik-private networks", () => {
    const networks = [
      "shop_traefik-public",
      "shop_traefik-private",
      "billing_system_traefik-public",
      "other_backend",
      "bridge",
      "host",
    ];
    const prefixes = fliskNetworkPrefixes(networks);
    expect(prefixes).toEqual(new Set(["shop", "billing_system"]));
  });

  it("returns an empty set when no traefik networks are present", () => {
    const networks = ["backend", "database", "redis_network", "none"];
    expect(fliskNetworkPrefixes(networks)).toEqual(new Set());
    expect(fliskNetworkPrefixes([])).toEqual(new Set());
  });

  it("ignores traefik network names that lack a leading underscore delimiter", () => {
    const networks = ["traefik-public", "traefik-private"];
    expect(fliskNetworkPrefixes(networks)).toEqual(new Set());
  });

  it("treats a prefix with traefik-public as Flisk-owned", () => {
    const networks = ["shop_traefik-public", "shop_backend"];
    const prefixes = fliskNetworkPrefixes(networks);
    expect(prefixes.has("shop")).toBe(true);
    expect(fliskNetworkOwner("shop_backend", prefixes)).toBe("shop");
  });

  it("does not treat a prefix with no Traefik network as Flisk-owned", () => {
    const networks = ["unrelated_backend", "unrelated_database"];
    const prefixes = fliskNetworkPrefixes(networks);
    expect(prefixes.has("unrelated")).toBe(false);
    expect(fliskNetworkOwner("unrelated_backend", prefixes)).toBeNull();
  });
});

describe("fliskNetworkOwner", () => {
  const prefixes = new Set(["shop", "billing"]);

  it("returns the project prefix for networks matching known project suffixes", () => {
    expect(fliskNetworkOwner("shop_backend", prefixes)).toBe("shop");
    expect(fliskNetworkOwner("shop_database", prefixes)).toBe("shop");
    expect(fliskNetworkOwner("shop_traefik-public", prefixes)).toBe("shop");
    expect(fliskNetworkOwner("shop_traefik-private", prefixes)).toBe("shop");
    expect(fliskNetworkOwner("billing_proxy", prefixes)).toBe("billing");
    expect(fliskNetworkOwner("billing_infisical-network", prefixes)).toBe("billing");
    expect(fliskNetworkOwner("billing_verdaccio-network", prefixes)).toBe("billing");
  });

  it("returns null when the suffix is unknown or prefix is not in the set", () => {
    expect(fliskNetworkOwner("unknown_backend", prefixes)).toBeNull();
    expect(fliskNetworkOwner("shop_custom-network", prefixes)).toBeNull();
    expect(fliskNetworkOwner("shop_redis", prefixes)).toBeNull();
    expect(fliskNetworkOwner("bridge", prefixes)).toBeNull();
    expect(fliskNetworkOwner("", prefixes)).toBeNull();
  });
});

describe("pruneProjectNetworks", () => {
  it("removes only this project's networks and reports those Docker refuses to remove", () => {
    const calls: string[][] = [];
    const runner = vi.fn((_cmd: string, args: string[]) => {
      calls.push(args);
      if (args[1] === "ls")
        return "bridge\r\nshop_backend\r\nshop_database\r\nother_backend\r\nshop_proxy\r\n";
      if (args[2] === "shop_database") {
        throw Object.assign(new Error("x"), {
          stderr:
            "Error response from daemon: network shop_database has active endpoints\nsecond line",
        });
      }
      return "";
    });
    const result = pruneProjectNetworks("shop", runner);
    expect(result.removed).toEqual(["shop_backend", "shop_proxy"]);
    expect(result.kept).toEqual([
      {
        name: "shop_database",
        reason: "Error response from daemon: network shop_database has active endpoints",
      },
    ]);
    const removed = calls.filter((a) => a[1] === "rm").map((a) => a[2]);
    expect(removed).not.toContain("other_backend");
    expect(removed).not.toContain("bridge");
  });

  it("handles errors where stderr is a Buffer", () => {
    const runner = vi.fn((_cmd: string, args: string[]) => {
      if (args[1] === "ls") return "shop_backend\n";
      throw Object.assign(new Error("err"), {
        stderr: Buffer.from("network is in use\n"),
      });
    });
    const result = pruneProjectNetworks("shop", runner);
    expect(result.removed).toEqual([]);
    expect(result.kept).toEqual([{ name: "shop_backend", reason: "network is in use" }]);
  });

  it("handles empty network list without running rm", () => {
    const calls: string[][] = [];
    const runner = vi.fn((_cmd: string, args: string[]) => {
      calls.push(args);
      return "";
    });
    const result = pruneProjectNetworks("shop", runner);
    expect(result.removed).toEqual([]);
    expect(result.kept).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(["network", "ls", "--format", "{{.Name}}"]);
  });

  it("handles errors without stderr by extracting the stringified error", () => {
    const runner = vi.fn((_cmd: string, args: string[]) => {
      if (args[1] === "ls") return "shop_backend\n";
      throw "daemon connection failed";
    });
    const result = pruneProjectNetworks("shop", runner);
    expect(result.removed).toEqual([]);
    expect(result.kept).toEqual([{ name: "shop_backend", reason: "daemon connection failed" }]);
  });

  it("prunes from a prefetched network list without asking Docker to list again (#4173)", () => {
    const runner = vi.fn((_cmd: string, args: string[]) => {
      if (args[1] === "ls") throw new Error("network ls should not run again");
      return "";
    });

    expect(pruneProjectNetworks("shop", runner, ["shop_backend"]).removed).toEqual([
      "shop_backend",
    ]);
    expect(runner.mock.calls.some(([, args]) => args[1] === "ls")).toBe(false);
  });
});

describe("planProjectNetworkPrune", () => {
  it("sorts this project's networks into remove and keep by attached containers, removing nothing", () => {
    const calls: string[][] = [];
    const runner = vi.fn((_cmd: string, args: string[]) => {
      calls.push(args);
      if (args[1] === "ls")
        return "bridge\r\nshop_backend\r\nshop_database\r\nother_backend\r\nshop_proxy\n";
      if (args[0] === "ps") {
        const network = args[args.indexOf("--filter") + 1];
        // An unlabelled container prints just the prefix.
        if (network === "network=shop_database") return "c:pgadmin\r\nc:\n";
        if (network === "network=shop_proxy") return "c:other\n";
        return "";
      }
      throw new Error(`unexpected docker ${args.join(" ")}`);
    });
    const plan = planProjectNetworkPrune("shop", runner);
    expect(plan.remove).toEqual(["shop_backend"]);
    expect(plan.keep).toEqual([
      { name: "shop_database", reason: "2 containers are attached" },
      { name: "shop_proxy", reason: "1 container is attached" },
    ]);
    expect(calls.some((a) => a[1] === "rm")).toBe(false);
    const checked = calls.filter((a) => a[0] === "ps").map((a) => a[a.indexOf("--filter") + 1]);
    expect(checked).not.toContain("network=other_backend");
    expect(checked).not.toContain("network=bridge");
  });

  it("does not count containers of the stacks down stops first (#3875)", () => {
    const runner = vi.fn((_cmd: string, args: string[]) => {
      if (args[1] === "ls") return "shop_backend\nshop_database\nshop_proxy\n";
      const network = args[args.indexOf("--filter") + 1];
      // Only this project's stacks are attached: down removes them, so the network goes too.
      if (network === "network=shop_backend") return "c:shop_api\nc:shop_web\n";
      // A container of another compose project stays attached after down.
      if (network === "network=shop_database") return "c:shop_api\nc:pgadmin\n";
      // So does a container that is not part of any compose project.
      if (network === "network=shop_proxy") return "c:\n";
      return "";
    });
    expect(planProjectNetworkPrune("shop", runner, ["shop_api", "shop_web"])).toEqual({
      remove: ["shop_backend"],
      keep: [
        { name: "shop_database", reason: "1 container is attached" },
        { name: "shop_proxy", reason: "1 container is attached" },
      ],
    });
  });

  it("keeps a network Docker cannot inspect, with the first stderr line as the reason", () => {
    const runner = vi.fn((_cmd: string, args: string[]) => {
      if (args[1] === "ls") return "shop_backend\n";
      throw Object.assign(new Error("err"), { stderr: Buffer.from("permission denied\nmore\n") });
    });
    expect(planProjectNetworkPrune("shop", runner)).toEqual({
      remove: [],
      keep: [{ name: "shop_backend", reason: "permission denied" }],
    });
  });
});
