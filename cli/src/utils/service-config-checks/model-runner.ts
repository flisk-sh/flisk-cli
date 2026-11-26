// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { execFileSync } from "node:child_process";
import chalk from "chalk";
import type { CheckResult, DiscoveredResource } from "../../types/index.js";
import { findProjectRoot } from "../paths.js";
import { discoverResourcesFromRoot } from "../services.js";
import { findOnPath } from "../which.js";

/** The runtimes `docker info` lists, or null when Docker cannot be asked. */
function dockerRuntimes(): string[] | null {
  try {
    const out = execFileSync(
      findOnPath("docker") ?? "docker",
      ["info", "--format", "{{json .Runtimes}}"],
      {
        encoding: "utf-8",
        timeout: 8000,
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    return Object.keys(JSON.parse(out) ?? {});
  } catch {
    return null;
  }
}

/**
 * A bring-your-own `container.gpus` reserves NVIDIA devices in the generated Compose file. `config verify` accepts it anywhere, so
 * on a host whose Docker has no NVIDIA runtime (a laptop, Docker Desktop on a Mac) the failure comes from Docker when the container
 * is created, after the build. Warn up front instead. A Docker that cannot be asked is not a finding (the Docker checks report it),
 * and a host using CDI may not list the runtime, so this is a warning, never a gate.
 */
export function checkGpuRuntime(
  projectRoot = findProjectRoot() ?? process.cwd(),
  resources: DiscoveredResource[] = discoverResourcesFromRoot(projectRoot),
  runtimes: () => string[] | null = dockerRuntimes,
): CheckResult {
  const wanting = resources
    .filter((resource) => {
      const container = (resource.config as { container?: { gpus?: unknown } } | undefined)
        ?.container;
      return container?.gpus !== undefined;
    })
    .map((resource) => resource.name);
  if (wanting.length === 0) {
    return { name: "GPU runtime", didPass: true, message: "No service asks for a GPU" };
  }
  const found = runtimes();
  if (found === null || found.includes("nvidia")) {
    return {
      name: "GPU runtime",
      didPass: true,
      message:
        found === null
          ? "Docker did not answer; the GPU runtime was not checked"
          : "Docker has the NVIDIA runtime",
    };
  }
  return {
    name: "GPU runtime",
    didPass: false,
    isWarning: true,
    message: `${wanting.join(", ")} ask for a GPU (container.gpus), but Docker lists no nvidia runtime (found: ${found.join(", ") || "none"}); Docker will refuse to create ${wanting.length === 1 ? "it" : "them"}`,
    fix: "Install the NVIDIA Container Toolkit on a GPU host, or remove container.gpus for this machine",
  };
}

/** What Docker can tell about Model Runner: no `docker model` plugin, the plugin without a running backend, or a running backend. */
export type ModelRunnerState = "no-plugin" | "backend-not-running" | "running";

/** The Model Runner state, or null when Docker itself cannot be asked. `docker model status` exits 0 only with a running backend. */
export function dockerModelRunnerState(): ModelRunnerState | null {
  const docker = findOnPath("docker") ?? "docker";
  const quiet = {
    timeout: 8000,
    stdio: ["ignore", "ignore", "ignore"] as ["ignore", "ignore", "ignore"],
  };
  try {
    execFileSync(docker, ["version", "--format", "{{.Server.Version}}"], quiet);
  } catch {
    return null;
  }
  try {
    execFileSync(docker, ["model", "version"], quiet);
  } catch {
    return "no-plugin";
  }
  try {
    execFileSync(docker, ["model", "status"], quiet);
    return "running";
  } catch {
    return "backend-not-running";
  }
}

/**
 * A bring-your-own `models` list becomes Compose `models:`, which Docker serves through Docker Model Runner. Without the
 * `docker model` plugin (Docker Engine on a Linux host or CI runner has none unless `docker-model-plugin` is installed) Compose
 * refuses to start the service with "'models' support requires Docker Model plugin", minutes into `flisk up`; with the plugin
 * but no running backend the model cannot be served. Warn up front instead, saying which of the two it is. A Docker that cannot
 * be asked is not a finding (the Docker checks report it), so this is a warning, never a gate.
 */
export function checkModelRunner(
  projectRoot = findProjectRoot() ?? process.cwd(),
  resources: DiscoveredResource[] = discoverResourcesFromRoot(projectRoot),
  runnerState: () => ModelRunnerState | null = dockerModelRunnerState,
): CheckResult {
  const wanting = resources
    .filter((resource) => {
      const models = (resource.config as { models?: unknown[] } | undefined)?.models;
      return Array.isArray(models) && models.length > 0;
    })
    .map((resource) => resource.name);
  if (wanting.length === 0) {
    return { name: "Docker Model Runner", didPass: true, message: "No service uses models" };
  }
  const state = runnerState();
  if (state === null) {
    return {
      name: "Docker Model Runner",
      didPass: true,
      message: "Docker did not answer; Docker Model Runner was not checked",
    };
  }
  if (state === "running") {
    return {
      name: "Docker Model Runner",
      didPass: true,
      message: "Docker Model Runner is running (`docker model status`)",
    };
  }
  const verb = wanting.length === 1 ? "declares" : "declare";
  const it = wanting.length === 1 ? "it" : "them";
  if (state === "no-plugin") {
    return {
      name: "Docker Model Runner",
      didPass: false,
      isWarning: true,
      message: `${wanting.join(", ")} ${verb} models, but this Docker has no \`docker model\` plugin; Compose will refuse to start ${it} ("'models' support requires Docker Model plugin")`,
      fix: "Enable Docker Model Runner in Docker Desktop, or install docker-model-plugin (Docker Engine on Linux), then run: docker model install-runner",
    };
  }
  return {
    name: "Docker Model Runner",
    didPass: false,
    isWarning: true,
    message: `${wanting.join(", ")} ${verb} models, and the \`docker model\` plugin is installed, but \`docker model status\` says the Model Runner is not running, so Docker cannot serve the models to ${it}`,
    fix: "Enable Docker Model Runner in Docker Desktop (Settings > AI), or on Docker Engine run: docker model install-runner",
  };
}

/** Prints the Docker Model Runner warning at `flisk up`; the stack still starts, as the services without models can run. */
export function warnModelRunner(projectRoot: string, resources?: DiscoveredResource[]): void {
  const check = checkModelRunner(projectRoot, resources);
  if (check.didPass) return;
  console.warn(chalk.yellow(`⚠ ${check.message}`));
  if (check.fix) console.warn(chalk.gray(`  Fix: ${check.fix}`));
}
