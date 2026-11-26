// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import {
  checkHostPorts,
  checkIngressPorts,
  checkPrivateNpmRegistry,
  checkTiltResourceHealth,
  createHostCommandCache,
  createVerdaccioProject,
  describe,
  expect,
  findForeignIngressHolders,
  it,
  noOwner,
  orderTiltFailures,
  parsePublishedPortHolders,
  parseTiltResourceFailures,
  probeContainerRuntimeError,
  rmSync,
  STANDARD_PORTS,
  stubLinuxProcess,
  summarizeTiltBuildError,
  vi,
} from "./test-support.js";

describe("doctor ingress + tilt runtime checks", () => {
  it("detects a foreign Traefik holding host port 80", () => {
    const dockerPs = [
      "flisk_saas_starter_traefik\t0.0.0.0:80->80/tcp,:::80->80/tcp,0.0.0.0:8080->8080/tcp",
      "flisk_project_postgres\t0.0.0.0:5432->5432/tcp",
    ].join("\n");

    const holders = parsePublishedPortHolders(dockerPs, [80, 443]);
    expect(holders).toHaveLength(1);
    expect(holders[0]?.name).toBe("flisk_saas_starter_traefik");
    expect(holders[0]?.publishedPorts).toContain(80);

    const foreign = findForeignIngressHolders(holders, "flisk_project");
    expect(foreign).toHaveLength(1);

    const result = checkIngressPorts((() => dockerPs) as never, "flisk-project");
    expect(result.didPass).toBe(false);
    expect(result.message).toContain("flisk_saas_starter_traefik");
    expect(result.fix).toContain("docker stop");
  });

  it("passes when this project's Traefik owns the ingress ports", () => {
    const dockerPs = "flisk_project_traefik\t0.0.0.0:80->80/tcp,:::80->80/tcp,0.0.0.0:443->443/tcp";
    const result = checkIngressPorts((() => dockerPs) as never, "flisk-project");
    expect(result.didPass).toBe(true);
    expect(result.message).toContain("flisk_project_traefik");
  });

  it("fails doctor when Tilt reports Traefik update errors that block apps", () => {
    const payload = {
      items: [
        {
          metadata: { name: "traefik" },
          status: {
            updateStatus: "error",
            runtimeStatus: "unknown",
            buildHistory: [
              {
                error:
                  "Bind for 0.0.0.0:80 failed: port is already allocated\nerror: exit status 1",
              },
            ],
          },
        },
        {
          metadata: { name: "salon-management-frontend" },
          status: { updateStatus: "pending", runtimeStatus: "pending" },
        },
        {
          metadata: { name: "postgres" },
          status: { updateStatus: "ok", runtimeStatus: "ok" },
        },
      ],
    };

    const parsed = parseTiltResourceFailures(JSON.stringify(payload));
    expect(parsed.failures).toHaveLength(1);
    expect(parsed.failures[0]?.name).toBe("traefik");
    expect(parsed.pendingCount).toBe(1);

    const result = checkTiltResourceHealth((() => JSON.stringify(payload)) as never);
    expect(result.didPass).toBe(false);
    expect(result.message).toContain("traefik");
    expect(result.message).toContain("port 80");
    expect(result.message).toContain("pending");
    expect(result.fix).toMatch(/docker ps --filter publish=80|Free the conflicting/);
  });

  it("points to the URL printed by flisk up when Tilt resources fail", () => {
    const payload = {
      items: [
        {
          metadata: { name: "api" },
          status: { updateStatus: "error", runtimeStatus: "unknown" },
        },
      ],
    };

    stubLinuxProcess();

    try {
      const result = checkTiltResourceHealth(((command: string) => {
        if (command.includes("tilt get uiresources -o json")) return JSON.stringify(payload);
        return "";
      }) as never);

      expect(result.didPass).toBe(false);
      expect(result.fix).toContain("Open the Tilt UI URL printed by flisk up");
      expect(result.fix).toContain(`default port ${STANDARD_PORTS.tiltUi} when TILT_PORT is unset`);
      expect(result.fix).not.toContain("localhost:10350");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("calls docker ps once when the ingress-ports and host-ports checks run together", async () => {
    stubLinuxProcess();

    const dockerPsCommand = "docker ps --format '{{.Names}}\\t{{.Image}}\\t{{.Ports}}'";
    const calls: string[] = [];
    const countingExec = ((command: string) => {
      calls.push(command);
      return "";
    }) as never;

    const commandCache = createHostCommandCache();

    try {
      checkIngressPorts(countingExec, "flisk-project", undefined, { commandCache });
      await checkHostPorts(
        countingExec,
        "flisk-project",
        async () => "in-use",
        undefined,
        noOwner,
        commandCache,
      );

      expect(calls.filter((command) => command === dockerPsCommand)).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rethrows the cached docker ps error to the next caller", async () => {
    stubLinuxProcess();

    let callCount = 0;
    const failingExec = (() => {
      callCount += 1;
      throw new Error("docker unavailable");
    }) as never;
    const commandCache = createHostCommandCache();

    try {
      const ingress = checkIngressPorts(failingExec, "flisk-project", undefined, { commandCache });
      expect(ingress.isSkipped).toBe(true);
      const host = await checkHostPorts(
        failingExec,
        "flisk-project",
        async () => "in-use",
        undefined,
        noOwner,
        commandCache,
      );
      expect(host.didPass).toBe(false);
      expect(callCount).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("separates sablier.deferStart resources from genuinely pending ones", () => {
    const payload = {
      items: [
        {
          metadata: { name: "data-governance-api" },
          status: { updateStatus: "none", runtimeStatus: "none" },
        },
        {
          metadata: { name: "some-other-stuck-resource" },
          status: { updateStatus: "pending", runtimeStatus: "pending" },
        },
        {
          metadata: { name: "postgres" },
          status: { updateStatus: "ok", runtimeStatus: "ok" },
        },
      ],
    };

    const parsed = parseTiltResourceFailures(
      JSON.stringify(payload),
      new Set(["data-governance-api"]),
    );
    expect(parsed.failures).toHaveLength(0);
    expect(parsed.deferredCount).toBe(1);
    expect(parsed.pendingCount).toBe(1);

    const result = checkTiltResourceHealth((() => JSON.stringify(payload)) as never);
    expect(result.didPass).toBe(true);
    // Without an injected deferredNames set (checkTiltResourceHealth computes
    // its own via discoverResources(), best-effort empty outside a project),
    // this specific resource isn't classified as deferred here -- covered by
    // the direct parseTiltResourceFailures assertions above instead.
  });

  it("does not describe deferred resources as blocked by unrelated failures", () => {
    const payload = {
      items: [
        {
          metadata: { name: "traefik" },
          status: {
            updateStatus: "error",
            runtimeStatus: "unknown",
            buildHistory: [{ error: "Bind for 0.0.0.0:80 failed: port is already allocated" }],
          },
        },
        {
          metadata: { name: "data-governance-api" },
          status: { updateStatus: "none", runtimeStatus: "none" },
        },
      ],
    };

    const parsed = parseTiltResourceFailures(
      JSON.stringify(payload),
      new Set(["data-governance-api"]),
    );
    expect(parsed.deferredCount).toBe(1);
    expect(parsed.pendingCount).toBe(0);
  });

  it("skips tilt resource check when tilt is not running", () => {
    const result = checkTiltResourceHealth((() => {
      throw new Error("tilt not running");
    }) as never);
    expect(result.isSkipped).toBe(true);
    expect(result.didPass).toBe(true);
  });

  it("summarizes ConnectionRefused package manifest errors from build logs", () => {
    const raw = [
      "error: ConnectionRefused downloading package manifest @flisk-sh/eventing",
      "error: ConnectionRefused downloading package manifest @flisk-sh/identity-js-sdk",
      "error: ConnectionRefused downloading package manifest @flisk-sh/observability",
      'ImageBuild: process "/bin/sh -c bun install --production --cache-dir=/cache/bun" did not complete successfully: exit code: 1',
    ].join("\n");

    const summary = summarizeTiltBuildError(raw);
    expect(summary).toContain("ConnectionRefused");
    expect(summary).toContain("@flisk-sh/eventing");
    expect(summary).toContain("Verdaccio");
  });

  it("summarizes truncated bun install ImageBuild exits as registry failures", () => {
    const summary = summarizeTiltBuildError(
      'ImageBuild: process "/bin/sh -c bun install --production --cache-dir=/cache/bun" did not complete successfully: exit code: 1',
    );
    expect(summary).toMatch(/dependency install failed|Verdaccio|ConnectionRefused/i);
  });

  it("summarizes missing compose images for run-only resources", () => {
    const summary = summarizeTiltBuildError(
      'Command "docker compose -p appointment-planner-autogenerated -f .../docker-compose.app.autogenerated.yml up -d --no-build appointment-planner-builder-backend" failed: exit status 1',
    );
    expect(summary).toContain("appointment-planner-builder-backend");
    expect(summary).toMatch(/image is missing|ImageBuild|run-only/i);
  });

  it("lists every failed resource even when an infra resource also failed", () => {
    const payload = {
      items: [
        {
          metadata: { name: "nats-http-bridge" },
          status: { updateStatus: "ok", runtimeStatus: "error" },
        },
        {
          metadata: { name: "appointment-management-backend" },
          status: {
            updateStatus: "error",
            runtimeStatus: "unknown",
            buildHistory: [
              {
                error:
                  'ImageBuild: process "/bin/sh -c bun run build" did not complete successfully: exit code: 1',
              },
            ],
          },
        },
        {
          metadata: { name: "appointment-management-backend-run-only" },
          status: {
            updateStatus: "error",
            runtimeStatus: "not_applicable",
            buildHistory: [
              {
                error:
                  'Command "docker compose -p appointment-autogenerated -f x.yml up -d --no-build appointment-management-backend" failed: exit status 1',
              },
            ],
          },
        },
      ],
    };

    const result = checkTiltResourceHealth(((command: string) => {
      if (command.includes("tilt get uiresources")) {
        return JSON.stringify(payload);
      }
      if (command.startsWith("docker ps")) {
        return "platform-autogenerated-nats-http-bridge-1\n";
      }
      if (command.includes("docker logs")) {
        return 'error: Failed to start NATS HTTP Bridge {"error":"Connection error: getaddrinfo ENOTFOUND"}\nInitializing Kafka consumer... {"brokers":["kafka:9092"]}';
      }
      throw new Error(`unexpected exec: ${command}`);
    }) as typeof import("node:child_process").execSync);

    expect(result.didPass).toBe(false);
    expect(result.message).toContain("3 failed resources");
    expect(result.message).toContain("nats-http-bridge");
    expect(result.message).toContain("appointment-management-backend");
    expect(result.message).toContain("appointment-management-backend-run-only");
    expect(result.message).toMatch(/Kafka broker unreachable|kafka:9092/i);
    expect(result.message).toMatch(/bun run build/i);
    expect(result.fix).toMatch(/Kafka/i);
    expect(
      orderTiltFailures(parseTiltResourceFailures(JSON.stringify(payload)).failures)[0]?.name,
    ).toBe("nats-http-bridge");
  });

  it("probes docker logs for Kafka ENOTFOUND runtime crashes", () => {
    const exec = ((command: string) => {
      if (command.startsWith("docker ps")) {
        return "platform-autogenerated-nats-http-bridge-1\n";
      }
      if (command.includes("docker logs")) {
        return "getaddrinfo ENOTFOUND\nbroker kafka:9092\nFailed to start NATS HTTP Bridge";
      }
      return "";
    }) as typeof import("node:child_process").execSync;

    const summary = probeContainerRuntimeError("nats-http-bridge", exec);
    expect(summary).toMatch(/Kafka broker unreachable/);
  });

  it("reads logs from this project's container when another project runs the same stack", () => {
    const logged: string[] = [];
    const exec = ((command: string) => {
      if (command.startsWith("docker ps")) {
        // Listed first, so an unscoped match would pick the other project.
        return [
          "flisk-person-crud-example-people-autogenerated-person-api-1",
          "acme-shop-people-autogenerated-person-api-1",
        ].join("\n");
      }
      if (command.includes("docker logs")) {
        logged.push(command);
        return "getaddrinfo ENOTFOUND\nbroker kafka:9092";
      }
      return "";
    }) as typeof import("node:child_process").execSync;

    probeContainerRuntimeError("person-api", exec, "acme-shop");

    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain("acme-shop-people-autogenerated-person-api-1");
    expect(logged[0]).not.toContain("flisk-person-crud-example");
  });

  it("summarizes bun run build ImageBuild failures", () => {
    const summary = summarizeTiltBuildError(
      'ImageBuild: process "/bin/sh -c bun run build" did not complete successfully: exit code: 1',
    );
    expect(summary).toMatch(/bun run build|TypeScript|Tilt/i);
  });

  it("surfaces registry-oriented fix when ImageBuild dependency installs fail", () => {
    const payload = {
      items: [
        {
          metadata: { name: "appointment-management-backend" },
          status: {
            updateStatus: "error",
            runtimeStatus: "unknown",
            buildHistory: [
              {
                error:
                  'ImageBuild: process "/bin/sh -c bun install --production --cache-dir=/cache/bun" did not complete successfully: exit code: 1',
              },
            ],
          },
        },
        {
          metadata: { name: "salon-management-frontend" },
          status: { updateStatus: "pending", runtimeStatus: "pending" },
        },
      ],
    };

    const result = checkTiltResourceHealth((() => JSON.stringify(payload)) as never);
    expect(result.didPass).toBe(false);
    expect(result.message).toContain("appointment-management-backend");
    expect(result.message).toMatch(/dependency install failed|Verdaccio|ConnectionRefused/i);
    expect(result.fix).toMatch(/verdaccio:start|publish/i);
    // #5315: the hint must not offer the docker compose alternative (it fails
    // on the missing external networks) or the publish script path that does
    // not exist in every project.
    expect(result.fix).toContain("bun run publish:all");
    expect(result.fix).not.toContain("docker compose");
    expect(result.fix).not.toContain("publish-to-verdaccio.sh");
  });

  it("fails private registry check when Verdaccio is enabled but unreachable", () => {
    const projectRoot = createVerdaccioProject("flisk-doctor-registry");

    const execDown = ((command: string) => {
      if (command.startsWith("docker ps")) {
        return "";
      }
      if (command.includes("curl")) {
        throw new Error("Failed to connect to localhost port 4873");
      }
      return "";
    }) as typeof import("node:child_process").execSync;

    const result = checkPrivateNpmRegistry(execDown, projectRoot, "http://localhost:4873");

    expect(result.didPass).toBe(false);
    expect(result.message).toContain("ConnectionRefused");
    expect(result.fix).toMatch(/verdaccio:start/);
    // #5315: the hint must not offer the docker compose alternative (it fails
    // on the missing external networks) or the publish script path that does
    // not exist in every project.
    expect(result.fix).toContain("bun run verdaccio:start");
    expect(result.fix).toContain("bun run publish:all");
    expect(result.fix).not.toContain("docker compose");
    expect(result.fix).not.toContain("publish-to-verdaccio.sh");

    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("passes private registry check when Verdaccio responds", () => {
    const projectRoot = createVerdaccioProject("flisk-doctor-registry-ok");

    const execUp = ((command: string) => {
      if (command.startsWith("docker ps")) {
        return "flisk-project-verdaccio\n";
      }
      if (command.includes("curl")) {
        return "200";
      }
      return "";
    }) as typeof import("node:child_process").execSync;

    const result = checkPrivateNpmRegistry(execUp, projectRoot, "http://localhost:4873");

    expect(result.didPass).toBe(true);
    expect(result.message).toContain("reachable");

    rmSync(projectRoot, { recursive: true, force: true });
  });
});
