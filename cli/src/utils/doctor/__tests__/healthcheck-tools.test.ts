// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExecAsync } from "../../exec-async.js";
import { checkHealthCheckTools, probeCommandTools } from "../checks/healthcheck-tools.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "flisk-hc-tools-"));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function writeService(name: string, extra: Record<string, unknown>): void {
  const dir = join(root, "services", "app", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "service.json"),
    JSON.stringify({
      schemaVersion: 1,
      appName: name,
      appType: "bring-your-own",
      stack: "app",
      ...extra,
    }),
  );
}

/** A daemon reply for an entrypoint or image that is not in the container. */
const NOT_FOUND = Object.assign(new Error('exec: "probe": executable file not found in $PATH'), {
  stderr: 'docker: Error: exec: "probe": executable file not found in $PATH',
});

interface FakeImage {
  /** Shells that run under `--entrypoint`; absent/false means the daemon cannot find them. */
  shells?: Record<string, boolean>;
  /** What `command -v` and `--version` answer per tool. */
  tools?: Record<string, boolean>;
}

/**
 * Answers the docker commands the check issues for `images`, like a small daemon.
 * Images not listed behave as not pulled.
 */
function fakeDocker(images: Record<string, FakeImage>, calls: string[] = []): ExecAsync {
  return async (command: string) => {
    calls.push(command);
    const inspect = /^docker image inspect (\S+)$/.exec(command);
    if (inspect) {
      if (images[inspect[1]]) return "sha256:deadbeef\n";
      throw new Error(`docker: Error: No such image: ${inspect[1]}`);
    }
    const run = /^docker run --rm --entrypoint (\S+) (\S+) ?(.*)$/.exec(command);
    if (!run) throw new Error(`unexpected command: ${command}`);
    const [, entrypoint, image, args] = run;
    const spec = images[image];
    if (!spec) throw new Error(`docker: Error: No such image: ${image}`);
    if (["sh", "bash", "busybox", "ash", "dash", "zsh", "ksh"].includes(entrypoint)) {
      if (spec.shells?.[entrypoint] === false || spec.shells?.[entrypoint] === undefined) {
        throw NOT_FOUND;
      }
      if (args.includes("for t in")) {
        return ["curl", "wget", "python3", "node"]
          .map((tool) => `${tool}=${spec.tools?.[tool] ? "present" : "missing"}`)
          .join("\n");
      }
      return ""; // the `true` no-op of a shell presence probe
    }
    // Direct tool probes (`--entrypoint <tool> <image> --version`).
    if (spec.tools?.[entrypoint] === true) return "probe 1.0\n";
    throw NOT_FOUND;
  };
}

describe("probeCommandTools", () => {
  it("reads the exec form as the program itself", () => {
    expect(probeCommandTools(["curl", "-f", "http://x/health"])).toEqual({
      shell: null,
      tools: ["curl"],
    });
    expect(probeCommandTools(["wget", "-q", "http://x"])).toEqual({
      shell: null,
      tools: ["wget"],
    });
  });

  it("reads CMD-SHELL and sh -c as shell probes calling their tools", () => {
    expect(probeCommandTools(["CMD-SHELL", "curl -f http://x || exit 1"])).toEqual({
      shell: "sh",
      tools: ["curl"],
    });
    expect(probeCommandTools(["sh", "-c", "wget -q http://x && echo ok"])).toEqual({
      shell: "sh",
      tools: ["wget"],
    });
  });

  it("strips a copied CMD marker and path prefixes", () => {
    expect(probeCommandTools(["CMD", "curl", "-f", "http://x"])).toEqual({
      shell: null,
      tools: ["curl"],
    });
    expect(probeCommandTools(["/usr/bin/curl", "-fsS", "http://x"])).toEqual({
      shell: null,
      tools: ["curl"],
    });
  });

  it("finds tools behind shell control flow and command substitution", () => {
    const tools = probeCommandTools(["sh", "-c", "out=$(curl -fsS http://x) || wget -q http://y"]);
    expect(tools?.shell).toBe("sh");
    expect(tools?.tools.sort()).toEqual(["curl", "wget"]);
  });

  it("does not read assignments, flags or URLs as tool calls", () => {
    const tools = probeCommandTools(["sh", "-c", "UA=curl-agent nc -z http://x/curl && echo up"]);
    expect(tools?.tools).toEqual([]);
  });

  it("returns the program for non-HTTP probes and undefined for an empty command", () => {
    expect(probeCommandTools(["grpc_health_probe", "-addr=:9090"])).toEqual({
      shell: null,
      tools: ["grpc_health_probe"],
    });
    expect(probeCommandTools([])).toBeUndefined();
  });
});

describe("checkHealthCheckTools", () => {
  it("skips a project with no image-backed curl/wget health probes", async () => {
    writeService("db", { image: "postgres:16", healthCheck: { command: ["pg_isready"] } });
    writeService("web", { image: "nginx:1", healthCheck: { path: "/health" } });
    writeService("worker", { appType: "worker" });
    const result = await checkHealthCheckTools(
      root,
      fakeDocker({ "postgres:16": {}, "nginx:1": {} }),
    );
    expect(result.name).toBe("Health check tools");
    expect(result.didPass).toBe(true);
    expect(result.isSkipped).toBe(true);
  });

  it("passes when every probed image ships the tool the health check calls", async () => {
    writeService("api", {
      image: "acme/api:1",
      healthCheck: { command: ["curl", "-f", "http://127.0.0.1:8080/health"] },
    });
    const result = await checkHealthCheckTools(
      root,
      fakeDocker({ "acme/api:1": { shells: { sh: true }, tools: { curl: true } } }),
    );
    expect(result.didPass).toBe(true);
    expect(result.isSkipped).toBeUndefined();
  });

  it("fails when the image lacks the tool and names the service, image and binary", async () => {
    writeService("facial", {
      image: "lychee/facial:2",
      healthCheck: { command: ["curl", "-f", "http://127.0.0.1:8000/health"] },
    });
    const result = await checkHealthCheckTools(
      root,
      fakeDocker({
        "lychee/facial:2": { shells: { sh: true }, tools: { python3: true } },
      }),
    );
    expect(result.didPass).toBe(false);
    expect(result.message).toContain("facial");
    expect(result.message).toContain("lychee/facial:2");
    expect(result.message).toContain("curl");
    expect(result.fix).toContain("python3");
  });

  it("skips with a note when the image is not pulled locally", async () => {
    writeService("geo", {
      image: "lychee/geo:1",
      healthCheck: { command: ["wget", "-q", "http://127.0.0.1/"] },
    });
    const result = await checkHealthCheckTools(root, fakeDocker({}));
    expect(result.didPass).toBe(true);
    expect(result.isSkipped).toBe(true);
    expect(result.message).toContain("not pulled locally");
  });

  it("verifies an exec-form probe on an image with no shell at all", async () => {
    writeService("distro", {
      image: "acme/distroless:1",
      healthCheck: { command: ["curl", "-fsS", "http://127.0.0.1/"] },
    });
    const result = await checkHealthCheckTools(
      root,
      fakeDocker({
        "acme/distroless:1": { shells: {}, tools: { curl: true } },
      }),
    );
    expect(result.didPass).toBe(true);
    expect(result.isSkipped).toBeUndefined();
  });

  it("reports a missing tool on a shell-less image through direct exec", async () => {
    writeService("distro", {
      image: "acme/distroless:1",
      healthCheck: { command: ["wget", "-q", "http://127.0.0.1/"] },
    });
    const result = await checkHealthCheckTools(
      root,
      fakeDocker({ "acme/distroless:1": { shells: {}, tools: { curl: true } } }),
    );
    expect(result.didPass).toBe(false);
    expect(result.message).toContain("wget");
  });

  it("reports a missing shell for a CMD-SHELL probe on a shell-less image", async () => {
    writeService("geo", {
      image: "acme/noshell:1",
      healthCheck: { command: ["CMD-SHELL", "curl -f http://127.0.0.1/ || exit 1"] },
    });
    const result = await checkHealthCheckTools(
      root,
      fakeDocker({
        "acme/noshell:1": { shells: {}, tools: { curl: true } },
      }),
    );
    expect(result.didPass).toBe(false);
    expect(result.message).toContain("sh");
  });

  it("fails a sh -c probe when only bash is in the image", async () => {
    writeService("svc", {
      image: "acme/bash-only:1",
      healthCheck: { command: ["sh", "-c", "curl -f http://127.0.0.1/"] },
    });
    const result = await checkHealthCheckTools(
      root,
      fakeDocker({
        "acme/bash-only:1": { shells: { sh: false, bash: true }, tools: { curl: true } },
      }),
    );
    expect(result.didPass).toBe(false);
    expect(result.message).toContain("sh");
  });

  it("passes a sh -c probe when the image has the shell and the tool", async () => {
    writeService("svc", {
      image: "acme/debian:1",
      healthCheck: { command: ["sh", "-c", "curl -f http://127.0.0.1/ || exit 1"] },
    });
    const result = await checkHealthCheckTools(
      root,
      fakeDocker({
        "acme/debian:1": { shells: { sh: true }, tools: { curl: true } },
      }),
    );
    expect(result.didPass).toBe(true);
  });

  it("warns but passes when one service is verified and another image is not pulled", async () => {
    writeService("verified", {
      image: "acme/api:1",
      healthCheck: { command: ["curl", "-f", "http://127.0.0.1/"] },
    });
    writeService("remote", {
      image: "acme/remote:1",
      healthCheck: { command: ["curl", "-f", "http://127.0.0.1/"] },
    });
    const result = await checkHealthCheckTools(
      root,
      fakeDocker({ "acme/api:1": { shells: { sh: true }, tools: { curl: true } } }),
    );
    expect(result.didPass).toBe(true);
    expect(result.isWarning).toBe(true);
    expect(result.message).toContain("remote");
    expect(result.message).toContain("not pulled locally");
  });

  it("probes each image once even when two services share it", async () => {
    for (const name of ["api-a", "api-b"]) {
      writeService(name, {
        image: "acme/shared:1",
        healthCheck: { command: ["curl", "-f", "http://127.0.0.1/"] },
      });
    }
    const calls: string[] = [];
    const result = await checkHealthCheckTools(
      root,
      fakeDocker({ "acme/shared:1": { shells: { sh: true }, tools: { curl: true } } }, calls),
    );
    expect(result.didPass).toBe(true);
    expect(calls.filter((call) => call.includes("image inspect"))).toHaveLength(1);
  });
});
