// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import {
  checkDockerCompose,
  checkDockerRuntime,
  checkDockerVersions,
  checkTilt,
  DOCTOR_FIXES,
} from "../commands/doctor.js";
import type { CheckResult, ProjectCapabilities } from "../types/index.js";
import { BUN_FLOOR_LABEL, bunMeetsFloor } from "./bun-floor.js";
import { projectNeedsBun } from "./bun-requirement.js";
import { isDatabaseCapabilityEnabled, isGatewayEnabled } from "./capabilities.js";
import { readyNextStep } from "./cli-command.js";
import { checkColimaAsync } from "./colima.js";
import { toComposeProjectName } from "./compose-project-name.js";
import { checkNatsBroker } from "./doctor-wiring.js";
import { execAsync, execFileAsync } from "./exec-async.js";
import {
  cacheExecAsync,
  createAsyncCommandCache,
  createHostCommandCache,
  fetchSharedDockerPs,
  type HostCommandCache,
} from "./host-command-cache.js";
import { describeHostPortPlan, getHostPortPlan, hostPortPlanFix } from "./host-port-config.js";
import { isNativeProject } from "./native-service.js";
import { findProjectRoot } from "./paths.js";
import { readProjectNameOrUndefined } from "./project-reader.js";
import { serviceManifestTypoNotes } from "./service-manifest.js";
import { discoverResourcesFromRoot } from "./services.js";
import { findOnPath } from "./which.js";

export type PreflightItem = {
  id: "node" | "docker" | "compose" | "tilt" | "bun" | "ports" | "nats" | "prisma" | "colima";
  ok: boolean;
  message: string;
  fix?: string;
};

/**
 * Which prerequisites a command needs.
 *
 * - `runtime` starts the local stack, so it needs Docker, Compose and Tilt.
 * - `scaffold` only writes project files, so it needs neither. The runtime
 *   executables are checked for the next-step hint, never to block setup.
 */
export type PreflightScope = "runtime" | "scaffold";

/**
 * The scope a preflight actually ran with: a requested `runtime` scope becomes `native` in a project whose services all
 * declare `command`, where only Node (and Bun, when a service needs it) can block.
 */
export type EffectivePreflightScope = PreflightScope | "native";

/** Checks a project of `command` services needs: no container runtime, no Tilt, no gateway or database ports. */
export const NATIVE_CHECK_IDS: readonly PreflightItem["id"][] = ["node", "bun"];

function blockingCheckIds(scope: EffectivePreflightScope): readonly PreflightItem["id"][] {
  if (scope === "scaffold") return SCAFFOLD_CHECK_IDS;
  if (scope === "native") return NATIVE_CHECK_IDS;
  return MACHINE_CHECK_IDS;
}

/** Checks that only the local runtime (starting a stack) needs. */
export const RUNTIME_CHECK_IDS: readonly PreflightItem["id"][] = ["docker", "compose", "tilt"];

/** Checks that writing project configuration needs. */
export const SCAFFOLD_CHECK_IDS: readonly PreflightItem["id"][] = ["node", "bun", "ports"];

/** Every check that blocks a cold start, in report order. */
export const MACHINE_CHECK_IDS: readonly PreflightItem["id"][] = [
  "node",
  ...RUNTIME_CHECK_IDS,
  "bun",
  "ports",
];

export type PreflightResult = {
  ok: boolean;
  inProject: boolean;
  /** `native` when the project's services all run as local processes and the container checks were not run. */
  scope: EffectivePreflightScope;
  items: PreflightItem[];
  header: string;
  footer: string;
};

type Check = () => Promise<CheckResult> | CheckResult;

/** Converts a doctor check result into the preflight's compact display item. */

function item(id: PreflightItem["id"], result: CheckResult): PreflightItem {
  return {
    id,
    ok: result.didPass || Boolean(result.isSkipped),
    message: result.message,
    fix: result.fix,
  };
}

/** Returns whether a Node version is below the CLI's 22.12 minimum. */
export function nodeTooOld(version: string): boolean {
  const [major = 0, minor = 0] = String(version)
    .split(".")
    .map((part) => Number.parseInt(part, 10));
  return (
    !Number.isFinite(major) || !Number.isFinite(minor) || major < 22 || (major === 22 && minor < 12)
  );
}

async function safeCheck(
  id: PreflightItem["id"],
  check: Check,
  fallback: string,
): Promise<PreflightItem> {
  try {
    return item(id, await check());
  } catch {
    return { id, ok: false, message: fallback };
  }
}

/** Requires a Docker engine and Compose version check to complete successfully. */
export function requireVerifiedDockerVersions(result: CheckResult): CheckResult {
  if (!result.isSkipped) return result;
  return {
    ...result,
    didPass: false,
    isSkipped: false,
    message: `Could not verify Docker Engine/Compose minimum versions: ${result.message}`,
    fix:
      result.fix ?? "Start Docker and ensure Docker Engine 25+ and Compose 2.20.2+ are installed.",
  };
}

export function usesPrisma(projectRoot: string): boolean {
  try {
    return discoverResourcesFromRoot(projectRoot).some((resource) => {
      return resource.config?.featuresEnabled?.includes("prisma") ?? false;
    });
  } catch {
    return false;
  }
}

async function hostPortsItem(
  root: string,
  scope: PreflightScope,
  opts?: { capabilities?: ProjectCapabilities; database?: boolean; [key: string]: unknown },
  deps?: { commandCache: HostCommandCache; dockerReady: Promise<void> },
): Promise<PreflightItem> {
  const caps = {
    gateway: isGatewayEnabled(root, opts),
    database: isDatabaseCapabilityEnabled(root, opts),
  };
  try {
    // The daemon listing is shared with the Docker check; join it before planning.
    if (deps) await deps.dockerReady;
    // Scaffolding must not talk to Docker at all, so the port plan is planned
    // from the host ports alone.
    const plan = await getHostPortPlan(root, {
      ...(scope === "scaffold" ? { inspectDocker: false } : {}),
      ...(deps ? { commandCache: deps.commandCache } : {}),
      database: caps.database,
      gateway: caps.gateway,
    });
    return {
      id: "ports",
      ok: true,
      message: describeHostPortPlan(plan, caps),
    };
  } catch (error) {
    return {
      id: "ports",
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      fix: hostPortPlanFix(caps),
    };
  }
}

async function prismaPostgresHealthy(root: string, docker: string): Promise<boolean> {
  try {
    const name = readProjectNameOrUndefined(root);
    const projectName = name ? toComposeProjectName(name).toLowerCase() : "";
    if (!projectName) return false;
    const { stdout } = await execFileAsync(
      docker,
      [
        "ps",
        "--filter",
        `label=com.docker.compose.project=${projectName}`,
        "--filter",
        "label=com.docker.compose.service=postgres",
        "--filter",
        "health=healthy",
        "--format",
        "{{.Names}}",
      ],
      { encoding: "utf-8", timeout: 3000 },
    );
    return String(stdout).trim().length > 0;
  } catch {
    /* Docker unavailable is already represented by the machine checks. */
    return false;
  }
}

export async function runColdPreflight(
  opts: {
    cwd?: string;
    scope?: PreflightScope;
    capabilities?: ProjectCapabilities;
    database?: boolean;
    gateway?: boolean;
    [key: string]: unknown;
  } = {},
): Promise<PreflightResult> {
  const cwd = opts.cwd ?? process.cwd();
  const projectRoot = findProjectRoot(cwd);
  const inProject = Boolean(projectRoot);
  const resources = projectRoot ? discoverResourcesFromRoot(projectRoot) : [];
  // A project whose services all declare `command` runs them as local processes (#2231): Docker, Compose, Tilt, the
  // gateway/database host ports and the container wiring checks do not apply, so they are not run or reported.
  const isNative = isNativeProject(resources);
  const scope = isNative ? "native" : (opts.scope ?? "runtime");
  const items: PreflightItem[] = [];
  // A misspelled service.json key (comand for command) hides `command`: the service then reads as a
  // Docker service, so a container-runtime failure names the typo instead of only blaming Docker.
  const typoNotes = serviceManifestTypoNotes(resources);
  const nameTypos = (item: PreflightItem): PreflightItem =>
    item.ok || typoNotes.length === 0
      ? item
      : { ...item, message: `${item.message}\n  ${typoNotes.join("\n  ")}` };
  const nodeVersion = process.versions.node;
  items.push({
    id: "node",
    ok: !nodeTooOld(nodeVersion),
    message: nodeVersion,
    fix: nodeTooOld(nodeVersion)
      ? `Install Node.js 22.12+ (current: ${nodeVersion}). https://nodejs.org`
      : undefined,
  });

  // Every cache is local to this invocation. A second command (or process) always
  // probes the machine again; only the concurrent probes inside this run share work.
  const hostCommandCache = createHostCommandCache();
  const cachedExec = cacheExecAsync(execAsync, createAsyncCommandCache());
  const dockerReady =
    scope === "runtime"
      ? fetchSharedDockerPs(hostCommandCache).catch(() => undefined)
      : Promise.resolve();

  // Start all independent probes before awaiting any of them. They are assembled
  // below in the original report order, so the rendered output is byte-for-byte
  // the same as when these checks ran one after another.
  const colimaResult = scope === "runtime" ? checkColimaAsync() : Promise.resolve(undefined);
  const dockerResult =
    scope === "runtime"
      ? dockerReady.then(() =>
          safeCheck(
            "docker",
            () => checkDockerRuntime(hostCommandCache),
            "Docker daemon is not running",
          ),
        )
      : Promise.resolve(undefined);
  const composeResult =
    scope === "runtime"
      ? safeCheck(
          "compose",
          async () => {
            // Both checks invoke `docker compose version --short`; the per-run
            // cached exec makes that the single call instead of two.
            const [compose, versions] = await Promise.all([
              checkDockerCompose(cachedExec),
              checkDockerVersions(cachedExec),
            ]);
            if (!compose.didPass) return compose;
            return requireVerifiedDockerVersions(versions);
          },
          "Docker Engine or Compose version check failed",
        )
      : Promise.resolve(undefined);
  const tiltResult =
    scope === "runtime"
      ? safeCheck("tilt", checkTilt, "Tilt CLI not found")
      : Promise.resolve(undefined);

  // Outside a project Bun stays required: `flisk project` is about to create services that need it.
  const bunNeeded = projectRoot ? projectNeedsBun(resources) : true;
  const bunPath = bunNeeded ? findOnPath("bun") : undefined;
  const bunVersion = bunPath
    ? // A cold start of bun can pass 3s on a busy machine; a timeout there reads as "not installed".
      execFileAsync(bunPath, ["--version"], { encoding: "utf-8", timeout: 10_000 })
        .then(({ stdout }) => String(stdout).trim())
        .catch(() => undefined)
    : Promise.resolve(undefined);

  // The host port plan places the gateway and Postgres, which only the container runtime starts.
  const portsResult =
    scope !== "native"
      ? hostPortsItem(projectRoot ?? cwd, scope, opts, {
          commandCache: hostCommandCache,
          dockerReady,
        })
      : Promise.resolve(undefined);

  // Project wiring (NATS, Prisma database) describes a running stack, so it is
  // only probed for the runtime scope.
  const wiringRoot = scope === "runtime" ? projectRoot : null;
  const natsResult = wiringRoot
    ? safeCheck("nats", () => checkNatsBroker(wiringRoot), "NATS broker check failed")
    : Promise.resolve(undefined);
  const prismaNeeded = wiringRoot
    ? isDatabaseCapabilityEnabled(wiringRoot, opts) && usesPrisma(wiringRoot)
    : false;
  const prismaHealthy =
    prismaNeeded && wiringRoot
      ? prismaPostgresHealthy(wiringRoot, findOnPath("docker") ?? "docker")
      : Promise.resolve(false);

  const [colima, docker, compose, tilt, version, ports, nats, dbUp] = await Promise.all([
    colimaResult,
    dockerResult,
    composeResult,
    tiltResult,
    bunVersion,
    portsResult,
    natsResult,
    prismaHealthy,
  ]);

  if (scope === "runtime") {
    // Docker on Colima is only useful when the VM is up: a stopped VM looks like a broken
    // Docker daemon, and the port publishing silently stops working.
    if (colima?.isColima) {
      items.push(
        nameTypos({
          id: "colima",
          ok: colima.running,
          message: colima.running
            ? `Colima VM is running${colima.arch ? ` (${colima.arch})` : ""}`
            : (colima.problem ?? "The Colima VM is not running"),
          fix: colima.running ? undefined : colima.fix,
        }),
      );
    }
    if (docker) items.push(nameTypos(docker));
    if (compose) items.push(compose);
    if (tilt) items.push(tilt);
  }

  const bun = version !== undefined && bunMeetsFloor(version);
  items.push(
    bunNeeded
      ? {
          id: "bun",
          ok: bun,
          message: bun
            ? `Bun ${BUN_FLOOR_LABEL} is available on PATH`
            : `Bun ${BUN_FLOOR_LABEL} not found on PATH`,
          fix: bun ? undefined : "curl -fsSL https://bun.sh/install | bash",
        }
      : { id: "bun", ok: true, message: "Bun not needed: no generated JS services" },
  );
  if (ports) items.push(ports);

  if (nats && !nats.ok) items.push(nats);
  if (prismaNeeded && !dbUp)
    items.push({
      id: "prisma",
      ok: false,
      message: "A Prisma resource is configured, but the project Postgres service is not healthy",
      fix: "Run `flisk up` to start the bundled Postgres, then check `flisk doctor`.",
    });

  const failures = items.filter((check) => !check.ok).slice(0, 8);
  const blockingIds = blockingCheckIds(scope);
  const machineFailed = failures.some((check) => blockingIds.includes(check.id));
  const bunFailed = failures.some((check) => check.id === "bun");
  let header = "";
  if (failures.length > 0) {
    if (!machineFailed) {
      header = "Machine is ready. Project wiring is not.";
    } else if (scope === "native") {
      header = "Cannot start the local processes. Fix the machine checks below.";
    } else if (scope === "scaffold") {
      header = bunFailed
        ? `Project setup blocked. Bun ${BUN_FLOOR_LABEL} must be installed on PATH.\nFix the machine checks below.`
        : "Project setup blocked. Fix the machine checks below.";
    } else {
      header = bunFailed
        ? `Cold start blocked. Bun ${BUN_FLOOR_LABEL} must be installed on PATH.\nPrisma/NATS configuration is project-specific and generated after \`flisk project\`. Fix the machine checks below.`
        : "Cold start blocked. Bun/Prisma/NATS are not the first failure.\nThey are generated after `flisk project`. Fix the machine checks below.";
    }
  }
  let footer = "";
  if (failures.length === 0) {
    footer = inProject
      ? "Environment ready for Flisk"
      : `This machine is ready for Flisk.\n${readyNextStep()}`;
  }
  return { ok: failures.length === 0, inProject, scope, items: failures, header, footer };
}

/** Formats only failed preflight checks and the applicable readiness message. */
export function formatColdPreflight(
  result: PreflightResult,
  options: { includeSuccessFooter?: boolean } = {},
): string {
  const lines = [result.header];
  for (const check of result.items) {
    lines.push(`FAIL ${check.id.padEnd(7)} ${check.message}`);
    if (check.fix) lines.push(`  ${check.fix}`);
  }
  if (result.footer && (options.includeSuccessFooter ?? true)) lines.push(result.footer);
  return lines.filter(Boolean).join("\n");
}

/** Exits before machine-dependent command work when any machine check fails. */
export async function assertMachineReadyOrExit(
  opts: { scope?: PreflightScope; hints?: string[] } = {},
): Promise<void> {
  const result = await runColdPreflight({ scope: opts.scope });
  const blockingIds = blockingCheckIds(result.scope);
  const machineFailure = result.items.some((check) => blockingIds.includes(check.id));
  if (machineFailure) {
    console.error(formatColdPreflight(result));
    // What to run once the machine checks pass; the caller knows its own next step.
    for (const hint of opts.hints ?? []) console.error(`→ ${hint}`);
    process.exit(1);
  }
}

export type RuntimePrerequisiteStatus = {
  hasDockerCli: boolean;
  hasTiltCli: boolean;
};

/**
 * Reports which runtime executables are installed.
 *
 * It only looks at `PATH`: no Docker daemon is contacted, so a machine without
 * Docker still gets a usable answer.
 */
export function detectRuntimePrerequisites(
  find: (command: string) => string | null = findOnPath,
): RuntimePrerequisiteStatus {
  return {
    hasDockerCli: Boolean(find("docker")),
    hasTiltCli: Boolean(find("tilt")),
  };
}

/**
 * Builds the next-step lines shown after project setup.
 *
 * Docker and Tilt are only needed to start the stack, so a missing runtime is
 * reported as a hint instead of a failure.
 */
export function formatRuntimeNextSteps(status: RuntimePrerequisiteStatus): string[] {
  const lines: string[] = [];
  if (!status.hasDockerCli) {
    lines.push(`Docker is not installed. ${DOCTOR_FIXES.dockerMissing}`);
  }
  if (!status.hasTiltCli) {
    lines.push(`Tilt is not installed. ${DOCTOR_FIXES.tiltMissing}`);
  }
  lines.push(
    "Docker and Tilt are only needed to start the stack: start them, then run `flisk doctor` (readiness) and `flisk up`.",
  );
  return lines;
}
