// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it, vi } from "vitest";
import {
  explainFailures,
  machineProblemFix,
  machineProblemFixes,
  withLoggedReasons,
} from "../startup-fixes.js";
import { MAX_FAILURE_MESSAGE } from "../startup-logs.js";
import { formatFailureDetail } from "../startup-report-format.js";

const initNetworksCommand = `Command "echo \\"Initializing Docker networks...\\" && (docker network inspect db3_traefik-public >/dev/null 2>&1 && docker network inspect db3_traefik-public --format \\"{{.Labels}}\\" | grep -q \\"com.docker.compose\\" && echo \\"Removing network ...\\"${" && true".repeat(100)}" failed: exit status 1`;

describe("machineProblemFix", () => {
  const poolExhausted =
    "Error response from daemon: all predefined address pools have been fully subnetted";

  it("explains an exhausted Docker network pool", () => {
    expect(machineProblemFix(poolExhausted)).toContain("flisk doctor --fix --scope=machine");
    expect(machineProblemFix(poolExhausted)).toContain("docker network prune");
  });

  it("recognises the other wording Docker uses when it has no subnet left", () => {
    expect(
      machineProblemFix(
        "could not find an available, non-overlapping IPv4 address pool among the defaults to assign to the network",
      ),
    ).toContain("docker network prune");
  });

  it("returns null for a failure that names no known machine problem", () => {
    expect(machineProblemFix("exit status 1")).toBeNull();
    expect(machineProblemFix("host port 5432 is already allocated")).toBeNull();
    expect(machineProblemFix("")).toBeNull();
  });
});

describe("machineProblemFixes", () => {
  it("returns an empty map for no failures", async () => {
    const fetchLogs = vi.fn(async () => null);
    expect((await machineProblemFixes([], fetchLogs)).size).toBe(0);
    expect(fetchLogs).not.toHaveBeenCalled();
  });

  it("finds the fix in the failed resource's log when the message is only the exit status", async () => {
    const poolExhausted =
      "Failed to create Docker network shop_infisical-network: Error response from daemon: all predefined address pools have been fully subnetted";
    const logs: Record<string, string> = {
      "init-networks": `Initializing Docker networks...\n${poolExhausted}\n`,
    };
    const fixes = await machineProblemFixes(
      [
        { name: "init-networks", message: "Command failed: exit status 1" },
        { name: "api", message: "exit status 1" },
      ],
      async (name) => logs[name] ?? null,
    );
    expect([...fixes.keys()]).toEqual(["init-networks"]);
    expect(fixes.get("init-networks")).toContain("flisk doctor --fix --scope=machine");
  });

  it("returns the fix from the message itself without reading the log", async () => {
    const fetchLogs = vi.fn(async () => null);
    const fixes = await machineProblemFixes(
      [
        {
          name: "init-networks",
          message: "all predefined address pools have been fully subnetted",
        },
      ],
      fetchLogs,
    );
    expect(fixes.get("init-networks")).toContain("docker network prune");
    expect(fetchLogs).not.toHaveBeenCalled();
  });

  it("reads the log of only the first five failures", async () => {
    const reads = vi.fn(async () => "all predefined address pools have been fully subnetted");
    const fixes = await machineProblemFixes(
      Array.from({ length: 7 }, (_, i) => ({ name: `svc${i}`, message: "exit status 1" })),
      reads,
    );
    expect(reads).toHaveBeenCalledTimes(5);
    expect([...fixes.keys()]).toEqual(["svc0", "svc1", "svc2", "svc3", "svc4"]);
  });
});

// #3210: a failure always comes with its reason. A health gate only exits 1; the cause is the ERROR line it logged.
describe("withLoggedReasons", () => {
  const logs: Record<string, string> = {
    "postgres-healthy":
      "postgres health check is failing; waiting up to 120s for it to recover\n" +
      "ERROR: postgres is unhealthy: its health check still failed 120s after it first failed\n",
    "api-healthy":
      "postgres-healthy │ ERROR: container api exited with code 3 and will not restart (restart: no)\n",
    quiet: "nothing useful here\n",
  };
  const fetchLogs = vi.fn(async (name: string) => logs[name] ?? null);

  it("replaces a bare exit status with the last ERROR line of the resource's log", async () => {
    const failures = await withLoggedReasons(
      [
        { name: "postgres-healthy", message: "exit status 1", runtime: false },
        { name: "api-healthy", message: "Command failed: exit status 1" },
        { name: "quiet", message: "exit status 2" },
        { name: "web", message: "host port 80 is already allocated" },
      ],
      fetchLogs,
    );
    expect(failures).toEqual([
      {
        name: "postgres-healthy",
        message: "postgres is unhealthy: its health check still failed 120s after it first failed",
        runtime: false,
      },
      {
        name: "api-healthy",
        message: "container api exited with code 3 and will not restart (restart: no)",
      },
      { name: "quiet", message: "exit status 2" },
      { name: "web", message: "host port 80 is already allocated" },
    ]);
    expect(fetchLogs).not.toHaveBeenCalledWith("web");
  });
});

// #3822: a failed command or compose step is reported as its command line, so the reason Docker logged is shown instead.
describe("failed commands and compose steps", () => {
  const composeCommand = `command ["docker" "compose" "--project-name" "db3-app-autogenerated" "--project-directory" "/tmp/db3/services/app/.autogenerated"${' "--env-file" "/tmp/db3/.env"'.repeat(20)} "up" "--no-deps" "-d" "cache"] failed. error: exit status 1`;
  const poolExhausted =
    "Error response from daemon: all predefined address pools have been fully subnetted";
  const logs: Record<string, string> = {
    "init-networks": `Initializing Docker networks...\nCreating network db3_traefik-public\n${poolExhausted}\n`,
    thing:
      " Image flisk-sh/does-not-exist-image:1.0 Pulling\n" +
      "\u001b[31m Error response from daemon: pull access denied for flisk-sh/does-not-exist-image, repository does not exist\u001b[0m\n\n",
  };
  const fetchLogs = vi.fn(async (name: string) => logs[name] ?? null);

  it("replaces a failed command's text with the last lines of its log", async () => {
    const [failure] = await withLoggedReasons(
      [{ name: "init-networks", message: initNetworksCommand }],
      fetchLogs,
    );
    expect(failure?.message).toBe(
      `Initializing Docker networks... Creating network db3_traefik-public ${poolExhausted}`,
    );
  });

  it("shows Docker's reason for a failed compose step, without colour codes", async () => {
    const [failure] = await withLoggedReasons(
      [{ name: "thing", message: composeCommand }],
      fetchLogs,
    );
    expect(failure?.message).toContain("pull access denied for flisk-sh/does-not-exist-image");
    expect(failure?.message).not.toContain("--project-name");
    expect(failure?.message).not.toContain("\u001b");
  });

  it("keeps the command text, cut short, when the resource has no log", async () => {
    const [failure] = await withLoggedReasons(
      [{ name: "cache", message: composeCommand }],
      fetchLogs,
    );
    expect(failure?.message.length).toBe(MAX_FAILURE_MESSAGE);
    expect(failure?.message.startsWith('command ["docker" "compose"')).toBe(true);
    expect(failure?.message.endsWith("…")).toBe(true);
  });

  it("adds the network fix for the address-pool message only", async () => {
    const failures = await withLoggedReasons(
      [
        { name: "init-networks", message: initNetworksCommand },
        { name: "thing", message: composeCommand },
      ],
      fetchLogs,
    );
    const fixes = await machineProblemFixes(failures, fetchLogs);
    expect([...fixes.keys()]).toEqual(["init-networks"]);
  });

  it("cuts the command text of failures past the fifth, whose log is not read", async () => {
    const reads = vi.fn(async () => null);
    const failures = await withLoggedReasons(
      Array.from({ length: 6 }, (_, i) => ({ name: `svc${i}`, message: composeCommand })),
      reads,
    );
    expect(reads).toHaveBeenCalledTimes(5);
    expect(failures[5]?.message.length).toBe(MAX_FAILURE_MESSAGE);
    expect(failures[5]?.message.startsWith('command ["docker" "compose"')).toBe(true);
  });

  it("strips terminal escapes from a logged ERROR line and cuts it", async () => {
    const long = `container web exited with code 1: ${"x".repeat(400)}`;
    const [failure] = await withLoggedReasons(
      [{ name: "web-healthy", message: "exit status 1" }],
      async () => `\u001b[31mERROR: ${long}\u001b[0m\n`,
    );
    expect(failure?.message.startsWith("container web exited with code 1: ")).toBe(true);
    expect(failure?.message).not.toContain("\u001b");
    expect(failure?.message.length).toBe(MAX_FAILURE_MESSAGE);
  });

  it("says in plain words that Docker is out of address pools when init-networks has no log (#3650)", async () => {
    const [failure] = await explainFailures(
      [{ name: "init-networks", message: initNetworksCommand }],
      async () => null,
    );
    expect(failure?.message).toContain("out of network address pools");
    expect(failure?.message).not.toContain("docker network inspect");
    expect(failure?.fix).toContain("flisk down --prune-networks");
    expect(failure?.fix).toContain("docker network prune");
  });

  it("applies the init-networks fallback to no other resource name", async () => {
    const [failure] = await withLoggedReasons(
      [{ name: "other-step", message: initNetworksCommand }],
      async () => null,
    );
    expect(failure?.message).not.toContain("out of network address pools");
    expect(failure?.message.startsWith('Command "echo')).toBe(true);
  });

  it("explainFailures gives each failure its logged reason and, for the address pool, the fix", async () => {
    const failures = await explainFailures(
      [
        { name: "init-networks", message: initNetworksCommand },
        { name: "thing", message: composeCommand },
      ],
      fetchLogs,
    );
    expect(failures[0]?.message.endsWith(poolExhausted)).toBe(true);
    expect(failures[0]?.fix).toContain("flisk doctor --fix --scope=machine");
    expect(failures[1]?.message).toContain("pull access denied");
    expect(failures[1]).not.toHaveProperty("fix");
  });
});

// #3958: the demo's image builds all fail on the same registry error. The shell template is not a reason;
// the last lines of the build are, and they must be printed once with the number of affected resources.
describe("failed image builds", () => {
  const demoCommand =
    'Command "sh -c \\"cp \\"$1\\" \\"$2\\" && cd \\"$2\\" && bun install\\" -- /tmp/src /tmp/build" failed: exit status 1';
  const buildLog = [
    "Step 1/6 : FROM flisk-sh/flisk-l4-base:latest",
    "Step 2/6 : WORKDIR /app",
    "Step 3/6 : COPY install-deps.sh .",
    "Step 4/6 : RUN ./install-deps.sh",
    "bun install v1.2.20",
    "\u001b[31mERROR: error: FailedToOpenSocket downloading package manifest @flisk-sh/flisk\u001b[0m",
    "",
  ].join("\n");
  const names = Array.from({ length: 6 }, (_, index) => `svc${index}-image`);

  it("renders the build's last error line and its four preceding lines, not the shell template", async () => {
    const fetch = vi.fn(async () => buildLog);
    const [failure] = await withLoggedReasons(
      [{ name: "floor-app-image", message: demoCommand }],
      fetch,
    );
    const lines = failure?.message.split("\n") ?? [];
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe("Step 2/6 : WORKDIR /app");
    expect(lines.at(-1)).toBe(
      "ERROR: error: FailedToOpenSocket downloading package manifest @flisk-sh/flisk",
    );
    expect(failure?.message).not.toContain("sh -c");
    expect(failure?.message).not.toContain("\u001b");
  });

  it("reuses the reason of the same command instead of reading every resource's log", async () => {
    const fetch = vi.fn(async () => buildLog);
    const failures = await withLoggedReasons(
      names.map((name) => ({ name, message: demoCommand })),
      fetch,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    for (const failure of failures) {
      expect(failure.message).toContain("FailedToOpenSocket");
    }
  });

  it("prints the shared build output once, ending with it, and counts every failed resource", async () => {
    const fetch = vi.fn(async () => buildLog);
    const failures = await withLoggedReasons(
      names.map((name) => ({ name, message: demoCommand })),
      fetch,
    );
    const detail = formatFailureDetail(failures);
    const lines = detail.split("\n");
    expect(lines[0]).toBe(
      "6 resources failed the same way (svc0-image, svc1-image, svc2-image, svc3-image, svc4-image, svc5-image):",
    );
    expect(lines.at(-1)).toBe(
      "ERROR: error: FailedToOpenSocket downloading package manifest @flisk-sh/flisk",
    );
    expect(detail.match(/ERROR: error: FailedToOpenSocket/g)).toHaveLength(1);
    expect(detail).not.toContain("sh -c");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

// #4216: a host port publish refusal is shown as the port, never the compose command line that hit it, and its fix
// names the container or process that holds the port.
describe("host port publish refusals", () => {
  const composeBindCommand =
    'command ["docker" "compose" "--project-name" "shop-main-autogenerated" "up" "-d" "traefik"] failed. error: ' +
    "Error response from daemon: Bind for 127.0.0.1:80 failed: port is already allocated";

  it("summarizes a raw Docker bind error to the port, keeping it short", async () => {
    const [failure] = await explainFailures(
      [
        {
          name: "traefik",
          message:
            "Error response from daemon: Bind for 127.0.0.1:80 failed: port is already allocated",
        },
      ],
      async () => null,
    );
    expect(failure?.message).toBe("host port 80 is already allocated");
  });

  it("shrinks a failed compose command line to the port it could not publish", async () => {
    const [failure] = await explainFailures(
      [{ name: "traefik", message: composeBindCommand }],
      async () => null,
    );
    expect(failure?.message).toBe("host port 80 is already allocated");
    expect(failure?.message).not.toContain("--project-name");
    expect(failure?.message).not.toContain("docker");
  });

  it("finds the port in the failed resource's log when its message is only the command line", async () => {
    const [failure] = await explainFailures(
      [
        {
          name: "traefik",
          message: 'command ["docker" "compose" "up" "-d" "traefik"] failed. error: exit status 1',
        },
      ],
      async () =>
        " Container shop-traefik-1 Starting\n" +
        " Error response from daemon: Bind for 0.0.0.0:15432 failed: port is already allocated\n",
    );
    expect(failure?.message).toBe("host port 15432 is already allocated");
  });

  it("names the container that holds the port when the occupant lookup knows it", async () => {
    const [failure] = await explainFailures(
      [
        {
          name: "postgres",
          message:
            "Error response from daemon: Bind for 0.0.0.0:15432 failed: port is already allocated",
        },
      ],
      async () => null,
      (port) => (port === 15432 ? { pid: 0, command: "docker", container: "shop_postgres" } : null),
    );
    expect(failure?.fix).toBe(
      "Fix: port 15432 is held by the Docker container shop_postgres. Stop it (docker stop shop_postgres), or set FLISK_POSTGRES_PORT to a free port and run flisk up",
    );
  });

  it("names a non-Docker occupant with its pid and command", async () => {
    const [failure] = await explainFailures(
      [{ name: "traefik", message: "host port 80 is already allocated" }],
      async () => null,
      (port) => (port === 80 ? { pid: 412, command: "nginx" } : null),
    );
    expect(failure?.fix).toBe(
      "Fix: port 80 is held by nginx (pid 412). Stop it, or set FLISK_HTTP_PORT to a free port and run flisk up",
    );
  });

  it("falls back to the lsof command when the occupant cannot be identified", async () => {
    const [failure] = await explainFailures(
      [{ name: "traefik", message: "host port 80 is already allocated" }],
      async () => null,
      () => null,
    );
    expect(failure?.fix).toContain("lsof -nP -iTCP:80 -sTCP:LISTEN");
    expect(failure?.fix).toContain("FLISK_HTTP_PORT");
  });

  it("keeps the failure's final flag through the explanation pass", async () => {
    const [failure] = await explainFailures(
      [
        {
          name: "traefik",
          message:
            "Error response from daemon: Bind for 0.0.0.0:80 failed: port is already allocated",
          final: true,
        },
      ],
      async () => null,
    );
    expect(failure).toMatchObject({ final: true, message: "host port 80 is already allocated" });
  });
});

describe("explainFailures", () => {
  it("still attaches the generic port-conflict fix when no occupant lookup is given", async () => {
    const failures = await explainFailures(
      [{ name: "web", message: "host port 80 is already allocated" }],
      async () => null,
    );
    expect(failures[0]?.message).toBe("host port 80 is already allocated");
    expect(failures[0]?.fix).toContain("lsof -nP -iTCP:80 -sTCP:LISTEN");
  });
});
