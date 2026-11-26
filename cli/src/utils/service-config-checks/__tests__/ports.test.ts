// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { discoverResourcesFromRoot } from "../../services.js";
import {
  checkDockerfilePorts,
  checkNetworkPorts,
  checkServicePorts,
  liveNetworkAddress,
} from "../ports.js";
import { tempProject } from "./helpers.js";

const project = tempProject("flisk-ports-checks-");
const { service } = project;

function dockerfile(dir: string, contents: string): void {
  mkdirSync(join(project.root, "services", dir), { recursive: true });
  writeFileSync(join(project.root, "services", dir, "Dockerfile"), contents);
}

describe("the three port checks on one project", () => {
  it("all pass together when the declared port, the Dockerfile and the binds agree", () => {
    service("api", { port: 4010 });
    dockerfile("app/api", "FROM node:20\nENV PORT=4010\nEXPOSE 4010\n");
    const resources = discoverResourcesFromRoot(project.root);
    expect(checkServicePorts(project.root, resources).didPass).toBe(true);
    expect(checkNetworkPorts(project.root, resources, () => "").didPass).toBe(true);
    expect(checkDockerfilePorts(project.root, resources).didPass).toBe(true);
  });

  it("an invalid declared port fails checkServicePorts only; checkDockerfilePorts does not repeat it", () => {
    service("api", { port: 70000 });
    dockerfile("app/api", "FROM node:20\nENV PORT=4010\nEXPOSE 4010\n");
    const resources = discoverResourcesFromRoot(project.root);
    const declared = checkServicePorts(project.root, resources);
    expect(declared.didPass).toBe(false);
    expect(declared.message).toContain("70000");
    const dockerfileResult = checkDockerfilePorts(project.root, resources);
    expect(dockerfileResult.didPass).toBe(true);
    expect(dockerfileResult.message).not.toContain("70000");
    expect(checkNetworkPorts(project.root, resources, () => "").didPass).toBe(true);
  });

  it("a Dockerfile listening on another port fails checkDockerfilePorts only", () => {
    service("api", { port: 4011 });
    dockerfile("app/api", "FROM node:20\nENV PORT=4010\nEXPOSE 4010\n");
    const resources = discoverResourcesFromRoot(project.root);
    expect(checkServicePorts(project.root, resources).didPass).toBe(true);
    expect(checkNetworkPorts(project.root, resources, () => "").didPass).toBe(true);
    const dockerfileResult = checkDockerfilePorts(project.root, resources);
    expect(dockerfileResult.didPass).toBe(false);
    expect(dockerfileResult.message).toContain("4011");
    expect(dockerfileResult.message).toContain("4010");
  });

  it("an extra port bound to every interface fails checkNetworkPorts only, as a warning", () => {
    service("api", {
      port: 4010,
      appType: "bring-your-own",
      image: "example/x:1",
      extraPorts: [{ port: 8080, bind: "0.0.0.0" }],
    });
    const resources = discoverResourcesFromRoot(project.root);
    expect(checkServicePorts(project.root, resources).didPass).toBe(true);
    expect(checkDockerfilePorts(project.root, resources).didPass).toBe(true);
    const network = checkNetworkPorts(project.root, resources, () => "");
    expect(network.didPass).toBe(false);
    expect(network.isWarning).toBe(true);
    expect(network.message).toContain("api 0.0.0.0:8080/tcp");
  });

  it("each of the three checks reports its own problem on a project with all three", () => {
    service("bad-port", { port: "http" });
    service("drifted", { port: 4020 });
    dockerfile("app/drifted", "FROM node:20\nENV PORT=4010\nEXPOSE 4010\n");
    service("open", {
      port: 4030,
      appType: "bring-your-own",
      image: "example/x:1",
      extraPorts: [{ port: 9090, bind: "0.0.0.0" }],
    });
    const resources = discoverResourcesFromRoot(project.root);
    const declared = checkServicePorts(project.root, resources);
    const network = checkNetworkPorts(project.root, resources, () => "");
    const dockerfileResult = checkDockerfilePorts(project.root, resources);
    expect(declared.didPass).toBe(false);
    expect(declared.message).toContain('"http"');
    expect(declared.message).not.toContain("9090");
    expect(network.didPass).toBe(false);
    expect(network.message).toContain("open 0.0.0.0:9090/tcp");
    expect(dockerfileResult.didPass).toBe(false);
    expect(dockerfileResult.message).toContain("drifted");
    expect(dockerfileResult.message).not.toContain("bad-port");
  });
});

describe("checkServicePorts", () => {
  it("accepts the boundary ports 1 and 65535 and a missing port", () => {
    service("low", { port: 1 });
    service("high", { port: 65535 });
    service("none", { port: undefined });
    expect(checkServicePorts(project.root).didPass).toBe(true);
  });

  it.each([[0], [-1], [65536], [4000.5], ["4000"], [null]])(
    "rejects port %j and names the file",
    (port) => {
      service("api", { port });
      const result = checkServicePorts(project.root);
      expect(result.didPass).toBe(false);
      expect(result.message).toContain(join("services", "app", "api", "service.json"));
      expect(result.fix).toContain("1 to 65535");
    },
  );
});

describe("checkNetworkPorts", () => {
  const byo = { appType: "bring-your-own", image: "caddy:2" };

  it("passes with no extraPorts and with loopback-only binds", () => {
    service("caddy", { ...byo, extraPorts: [{ port: 80 }, { port: 443, bind: "127.0.0.1" }] });
    expect(checkNetworkPorts(project.root, undefined, () => "").didPass).toBe(true);
  });

  it("does not ask Docker at all when no loopback-declared port exists", () => {
    const dockerPorts = vi.fn(() => "");
    service("caddy", { ...byo, extraPorts: [{ port: 80, bind: "0.0.0.0" }] });
    checkNetworkPorts(project.root, undefined, dockerPorts);
    expect(dockerPorts).not.toHaveBeenCalled();
  });

  it("treats a bind that is not 0.0.0.0 as loopback, matching extraPortsOf", () => {
    service("caddy", { ...byo, extraPorts: [{ port: 80, bind: "192.168.1.5" }] });
    expect(checkNetworkPorts(project.root, undefined, () => "").didPass).toBe(true);
  });

  it("ignores extraPorts on a resource that is not bring-your-own", () => {
    service("api", { extraPorts: [{ port: 8080, bind: "0.0.0.0" }] });
    expect(checkNetworkPorts(project.root, undefined, () => "").didPass).toBe(true);
  });

  it("warns on an open udp port", () => {
    service("dns", { ...byo, extraPorts: [{ port: 53, protocol: "udp", bind: "0.0.0.0" }] });
    const udp = checkNetworkPorts(project.root, undefined, () => "");
    expect(udp.didPass).toBe(false);
    expect(udp.message).toContain("0.0.0.0:53/udp");
  });

  it("warns on a bare publish port, which resolves to every interface", () => {
    service("web", {
      port: 4001,
      ...byo,
      extraPorts: [{ port: 8080, publish: "8080" }],
    });
    const bare = checkNetworkPorts(project.root, undefined, () => "");
    expect(bare.didPass).toBe(false);
    expect(bare.message).toContain("web 0.0.0.0:8080/tcp");
  });

  it("skips a publish variable that nothing sets", () => {
    service("caddy", {
      ...byo,
      extraPorts: [{ port: 80, publish: "${UNSET_FLISK_PORT_TEST}" }],
    });
    expect(checkNetworkPorts(project.root, undefined, () => "").didPass).toBe(true);
  });

  it("warns on 0.0.0.0 and on a publish default that resolves to a bare port", () => {
    service("caddy", {
      ...byo,
      extraPorts: [{ port: 80, publish: "${HTTP_BIND:-8080}" }],
    });
    const result = checkNetworkPorts(project.root, undefined, () => "");
    expect(result.didPass).toBe(false);
    expect(result.isWarning).toBe(true);
    expect(result.message).toContain("caddy 0.0.0.0:8080/tcp");
    expect(result.message).toContain("HTTP_BIND");
  });

  it("warns when a running container publishes wider than declared, via the injected docker ps", () => {
    service("caddy", { ...byo, extraPorts: [{ port: 80 }] });
    const ps = "caddy|0.0.0.0:80->80/tcp";
    const result = checkNetworkPorts(project.root, undefined, () => ps);
    expect(result.didPass).toBe(false);
    expect(result.message).toContain("declared on this machine only");
    expect(result.fix).toContain("flisk restart");
  });

  it("names a publish value that is not a port or address:port", () => {
    service("caddy", {
      ...byo,
      extraPorts: [{ port: 80, publish: "${HTTP_BIND:-0.0.0.0:80}" }],
    });
    writeFileSync(join(project.root, ".env"), "HTTP_BIND=localhost:8080\n");
    const result = checkNetworkPorts(project.root, undefined, () => "");
    expect(result.didPass).toBe(false);
    expect(result.message).toContain("Invalid published address");
    expect(result.message).toContain('HTTP_BIND resolves to "localhost:8080"');
  });
});

describe("checkDockerfilePorts", () => {
  it("passes when PORT, EXPOSE and the healthcheck all match service.json", () => {
    service("api", { port: 4010 });
    dockerfile(
      "app/api",
      "FROM node:20\nENV PORT=4010\nEXPOSE 4010\nHEALTHCHECK CMD curl -f http://localhost:4010/health\n",
    );
    expect(checkDockerfilePorts(project.root).didPass).toBe(true);
  });

  it("reports each drifting label: ENV PORT, EXPOSE and healthcheck", () => {
    service("api", { port: 4011 });
    dockerfile(
      "app/api",
      "FROM node:20\nENV PORT=4010\nEXPOSE 4010\nHEALTHCHECK CMD curl -f http://localhost:4010/health\n",
    );
    const result = checkDockerfilePorts(project.root);
    expect(result.didPass).toBe(false);
    expect(result.message).toContain("PORT 4010 (expected 4011)");
    expect(result.message).toContain("EXPOSE 4010 (expected 4011)");
    expect(result.message).toContain("healthcheck 4010 (expected 4011)");
  });

  it("reads the stage named by build.target and ignores the others", () => {
    service("api", { port: 4010, build: { target: "prod" } });
    dockerfile(
      "app/api",
      "FROM node:20 AS dev\nENV PORT=3000\nEXPOSE 3000\nFROM node:20 AS prod\nENV PORT=4010\nEXPOSE 4010\n",
    );
    expect(checkDockerfilePorts(project.root).didPass).toBe(true);
  });

  it("skips a native image resource and a service without a Dockerfile", () => {
    service("image", { port: 4011, image: "ghcr.io/example/app:1" });
    service("local", { port: 4011 });
    expect(checkDockerfilePorts(project.root).didPass).toBe(true);
  });

  it("joins a healthcheck split across lines into one instruction", () => {
    service("api", { port: 4010 });
    dockerfile(
      "app/api",
      "FROM node:20\nENV PORT=4010\nEXPOSE 4010\nHEALTHCHECK --interval=10s \\\n  CMD nc -z localhost 4010\n",
    );
    expect(checkDockerfilePorts(project.root).didPass).toBe(true);
  });
});

describe("liveNetworkAddress", () => {
  it("finds the non-loopback address publishing the port, or null", () => {
    const ps = "a|0.0.0.0:80->80/tcp, [::]:80->80/tcp, 127.0.0.1:443->443/tcp\nb|:::8080->8080/tcp";
    expect(liveNetworkAddress(ps, 80, 80, "tcp")).toBe("0.0.0.0:80 -> 80/tcp");
    expect(liveNetworkAddress(ps, 443, 443, "tcp")).toBeNull();
    expect(liveNetworkAddress(ps, 8080, 8080, "tcp")).toBe(":::8080 -> 8080/tcp");
    expect(liveNetworkAddress("", 80, 80, "tcp")).toBeNull();
  });

  it("ignores loopback publishers, a swapped port pair, the wrong protocol and hostPort suffixes", () => {
    const ps =
      "a|[::1]:80->80/tcp\n" +
      "b|0.0.0.0:80->180/tcp\n" +
      "c|0.0.0.0:80->80/udp\n" +
      "d|10.0.0.1:180->80/tcp\n" +
      "line-without-pipe";
    expect(liveNetworkAddress(ps, 80, 80, "tcp")).toBeNull();
    expect(liveNetworkAddress("e|0.0.0.0:443->443/tcp", 80, 443, "tcp")).toBeNull();
  });
});
