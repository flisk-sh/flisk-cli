// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CheckResult, DiscoveredResource } from "../../types/index.js";
import { isGatewayEnabled } from "../capabilities.js";
import { PROJECT_JSON, STANDARD_PORTS } from "../constants.js";
import { formatCount } from "../formatting.js";
import { resolveRuntimeTiltPort } from "../host-port-config.js";
import { findProjectRoot } from "../paths.js";
import { discoverResources, discoverResourcesFromRoot } from "../services.js";
import {
  findForeignTiltOnPort,
  findTiltPortOwner,
  type TiltPortOwner,
} from "../tilt-port-owner.js";
import {
  effectiveRuntimeStatus,
  isNeverStarted,
  isTiltResourcePending,
  UNHEALTHY_CONTAINER_MESSAGE,
} from "../tilt-resource-state.js";
import { getTiltPollingPort } from "../tilt-startup.js";
import {
  EXEC_TIMEOUT_MS,
  probeContainerRuntimeError,
  projectConfigEnablesVerdaccio,
  runHostCommand,
} from "./process.js";

export interface TiltResourceFailure {
  name: string;
  updateStatus: string;
  runtimeStatus: string;
  error: string;
  /** True when waiting cannot fix this failure (a host port the runtime refuses to publish). */
  final?: boolean;
}

/**
 * Docker refusing to publish a host port another owner already holds. Retrying cannot fix it: the port
 * stays taken until that owner stops, so the failure is final the moment the runtime answers it (#4216).
 */
const PORT_PUBLISH_FAILURE =
  /port is already allocated|bind: address already in use|failed to bind host port/i;

export function isPortPublishFailure(error: string): boolean {
  return PORT_PUBLISH_FAILURE.test(error);
}

interface TiltUiResourceItem {
  metadata?: { name?: string };
  status?: {
    updateStatus?: string;
    runtimeStatus?: string;
    disableStatus?: { state?: string };
    buildHistory?: Array<{ error?: string }>;
    composeResourceInfo?: { healthStatus?: string };
  };
}

/**
 * Tilt persists each resource's disable state in a `<name>-disable` ConfigMap on
 * first load. When `flisk config regenerate` (or a Tiltfile edit) adds a resource
 * to the focus allowlist while Tilt is already running, Tilt reloads the Tiltfile
 * but leaves that ConfigMap at `isDisabled: "true"`, so `disableStatus.state`
 * stays `Disabled` until `flisk down && flisk up`.
 *
 * Returns the names of resources in `tilt get uiresources -o json` that the
 * Tiltfile enables for the current run yet Tilt still reports as `Disabled`.
 *
 * `*-run-only` companions are never stale-disabled: they are manual
 * `docker compose up --no-build` triggers that a healthy focused run leaves
 * Disabled by design, so counting them sends callers to restart a stack that
 * needs no restart (flisk#3660).
 */
export function findStaleDisabledResources(
  jsonText: string,
  projectRoot: string | null = findProjectRoot(),
): string[] {
  let items: TiltUiResourceItem[] = [];
  try {
    const parsed = JSON.parse(jsonText) as { items?: TiltUiResourceItem[] };
    items = parsed.items ?? [];
  } catch {
    return [];
  }
  if (items.length === 0) return [];

  const enabledNames = new Set(
    items
      .filter((item) => item.status?.disableStatus?.state !== "Disabled")
      .flatMap((item) => (item.metadata?.name ? [item.metadata.name] : [])),
  );
  if (enabledNames.size === 0) {
    return [];
  }

  const autoDiscoverEnabled = process.env.AUTO_DISCOVER?.toLowerCase() !== "false";
  const expectedEnabled = new Set<string>();
  const focusTargets = new Set<string>();

  const tiltfilePath = projectRoot ? join(projectRoot, ".flisk", ".flisk-out", "Tiltfile") : null;
  if (tiltfilePath && existsSync(tiltfilePath)) {
    try {
      const tiltfile = readFileSync(tiltfilePath, "utf-8");
      const listMatch = tiltfile.match(
        /^[ \t]*_ALWAYS_ENABLED_INFRA_RESOURCES\s*=\s*\[([^\]]*)\]/m,
      );
      if (listMatch?.[1]) {
        for (const match of listMatch[1].matchAll(/['"]([^'"]+)['"]/g)) {
          if (match[1]) expectedEnabled.add(match[1]);
        }
      }
      for (const match of tiltfile.matchAll(
        /_ALWAYS_ENABLED_INFRA_RESOURCES\.append\(\s*['"]([^'"]+)['"]\s*\)/g,
      )) {
        const name = match[1];
        if (!name) continue;
        if (name === "service-discovery-daemon" && !autoDiscoverEnabled) continue;
        expectedEnabled.add(name);
      }
      for (const match of tiltfile.matchAll(
        /(?:config\.set_enabled_resources\(\s*\[([^\]]*)\]\s*\)|^[ \t]*_FILTERED_RESOURCES\s*=\s*\[([^\]]*)\])/gm,
      )) {
        const listBody = match[1] ?? match[2] ?? "";
        for (const itemMatch of listBody.matchAll(/['"]([^'"]+)['"]/g)) {
          if (itemMatch[1]) {
            expectedEnabled.add(itemMatch[1]);
            focusTargets.add(itemMatch[1]);
          }
        }
      }
    } catch {
      // If the Tiltfile cannot be read, add no names from it. Defaults apply only when the file is missing.
    }
  } else {
    expectedEnabled.add("init-networks");
    if (projectRoot ? isGatewayEnabled(projectRoot) : true) {
      expectedEnabled.add("traefik");
    }
    expectedEnabled.add("golden-layers-build");
    if (autoDiscoverEnabled) {
      expectedEnabled.add("service-discovery-daemon");
    }
    expectedEnabled.add("postgres");
  }

  if (projectRoot) {
    const specMasterPath = join(projectRoot, ".flisk", ".flisk-out", "spec.master");
    if (existsSync(specMasterPath)) {
      try {
        const specMaster = readFileSync(specMasterPath, "utf-8");
        for (const preAlphaMatch of specMaster.matchAll(
          /PRE_ALPHA_RESOURCES\s*=\s*\{([^}]*)\}/gm,
        )) {
          for (const entry of (preAlphaMatch[1] ?? "").matchAll(/['"]([^'"]+)['"]\s*:\s*True/g)) {
            if (entry[1]) focusTargets.add(entry[1]);
          }
        }
      } catch {
        // Ignore unreadable spec.master.
      }
    }

    const projectJsonPath = join(projectRoot, ".flisk", PROJECT_JSON);
    if (existsSync(projectJsonPath)) {
      try {
        const projectJson = JSON.parse(readFileSync(projectJsonPath, "utf-8")) as {
          phases?: { pre_alpha?: { enabledStacks?: unknown } };
        };
        const stacks = projectJson.phases?.pre_alpha?.enabledStacks;
        if (Array.isArray(stacks)) {
          for (const stack of stacks) {
            if (typeof stack === "string" && stack.length > 0) {
              focusTargets.add(stack);
            }
          }
        }
      } catch {
        // Ignore unreadable project.json.
      }
    }

    if (focusTargets.size > 0) {
      for (const target of focusTargets) {
        expectedEnabled.add(target);
      }
      try {
        for (const res of discoverResourcesFromRoot(projectRoot)) {
          if (
            focusTargets.has(res.name) ||
            (res.stack && focusTargets.has(res.stack)) ||
            [...focusTargets].some((target) => res.name.startsWith(`${target}-`))
          ) {
            expectedEnabled.add(res.name);
          }
        }
      } catch {
        // Ignore discovery errors outside a valid project root.
      }
    }

    if (projectConfigEnablesVerdaccio(projectRoot)) {
      expectedEnabled.add("verdaccio");
    }
  }

  for (const baseName of [...expectedEnabled, ...enabledNames]) {
    if (baseName === "(Tiltfile)") continue;
    for (const suffix of ["-config-gen", "-typecheck", "-image", "-done"]) {
      expectedEnabled.add(`${baseName}${suffix}`);
    }
  }

  return items
    .filter((item) => {
      const name = item.metadata?.name;
      return Boolean(
        name &&
          !name.endsWith("-run-only") &&
          expectedEnabled.has(name) &&
          item.status?.disableStatus?.state === "Disabled",
      );
    })
    .map((item) => item.metadata?.name as string);
}

/**
 * Resource names with `sablier: {enable: true, deferStart: true}` in their
 * manifest (openspec/changes/prioritized-cold-start): these are expected to
 * sit at `runtimeStatus: none` until their first request, not a sign of
 * anything stuck. Best-effort — returns an empty set if discovery fails
 * (e.g. not run from inside a project), so callers degrade to today's
 * behavior rather than erroring.
 */
export function getDeferredResourceNames(
  resources?: DiscoveredResource[],
  projectRoot?: string | null,
): Set<string> {
  // A caller that selected no project cannot have deferred resources; skip
  // discovery entirely so the check (and its unit tests) read no host state.
  if (projectRoot === null) return new Set();
  try {
    const list =
      resources ?? (projectRoot ? discoverResourcesFromRoot(projectRoot) : discoverResources());
    return new Set(
      list
        .filter((svc) => svc.config?.sablier?.enable && svc.config?.sablier?.deferStart)
        .map((svc) => svc.name),
    );
  } catch {
    return new Set();
  }
}

/**
 * Extract failing UIResources from `tilt get uiresources -o json`.
 *
 * `deferredNames` (typically from getDeferredResourceNames()) separates a
 * `sablier.deferStart` resource's expected `none`/`pending` status into its
 * own count so it's never described as "blocked" or otherwise lumped in with
 * genuinely stuck resources.
 */
export function parseTiltResourceFailures(
  jsonText: string,
  deferredNames: Set<string> = new Set(),
): {
  failures: TiltResourceFailure[];
  pendingCount: number;
  deferredCount: number;
  okCount: number;
  total: number;
} {
  const parsed = JSON.parse(jsonText) as { items?: TiltUiResourceItem[] };
  const items = parsed.items ?? [];
  const failures: TiltResourceFailure[] = [];
  let pendingCount = 0;
  let deferredCount = 0;
  let okCount = 0;

  for (const item of items) {
    const name = item.metadata?.name ?? "unknown";
    const updateStatus = item.status?.updateStatus ?? "";
    const runtimeStatus = effectiveRuntimeStatus(item.status);
    const unhealthy = runtimeStatus === "error" && item.status?.runtimeStatus === "ok";
    // A failed build's own error is the cause to show; the health message only fills in when there is none.
    const buildError = (item.status?.buildHistory?.[0]?.error ?? "").trim();
    const error = buildError || (unhealthy ? UNHEALTHY_CONTAINER_MESSAGE : "");

    if (updateStatus === "error" || runtimeStatus === "error") {
      failures.push({
        name,
        updateStatus,
        runtimeStatus,
        // Keep enough of the raw Tilt error for summarizers; display uses
        // summarizeTiltBuildError() which extracts the actionable root cause.
        error: error.replace(/\s+/g, " ").slice(0, 800),
        ...(isPortPublishFailure(error) ? { final: true } : {}),
      });
      continue;
    }

    if (updateStatus === "ok" && (runtimeStatus === "ok" || runtimeStatus === "not_applicable")) {
      okCount += 1;
      continue;
    }

    if (name !== "(Tiltfile)" && isTiltResourcePending(updateStatus, runtimeStatus)) {
      // A deferred resource (sablier.deferStart) also sits at none/none, so it has to be recognised before
      // never-started resources are dropped, or it would be counted as neither deferred nor pending.
      if (deferredNames.has(name)) {
        deferredCount += 1;
      } else if (!isNeverStarted(item.status)) {
        pendingCount += 1;
      }
    }
  }

  return {
    failures,
    pendingCount,
    deferredCount,
    okCount,
    total: items.length,
  };
}

/**
 * Turn noisy Tilt/Docker build errors into an actionable one-liner.
 * Prefer registry/network root causes over truncated ImageBuild exit lines.
 */
const GOLDEN_BASE_IMAGE_PULL_FAILURE =
  /failed to resolve source metadata for docker\.io\/library\/([A-Za-z0-9._-]+-l[1-4](?:-[a-z]+)*)(?::[^\s:]+)?:/i;
const SCRIPT_PATH = /(?:^|[^\w./-])([\w./-]+\.sh)\b/i;
const SCRIPT_EXEC_FAILURE = /\b(?:not found|exec format error)\b/i;
const NETWORK_OR_REGISTRY_MARKER =
  /ConnectionRefused|Verdaccio|private registry|:4873\b|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|\bnetwork\b|\bregistry\b|\bfetch failed\b|could not resolve/i;

export function summarizeTiltBuildError(error: string): string {
  const normalized = error.replace(/\s+/g, " ").trim();

  // Already summarized once; a second pass must not strip the port back out of the message.
  if (/^host port \d+ is already allocated$/i.test(normalized)) return normalized;

  const bindMatch = normalized.match(/Bind for [^ ]+:(\d+) failed: port is already allocated/i);
  if (bindMatch) {
    return `host port ${bindMatch[1]} is already allocated`;
  }
  if (/port is already allocated/i.test(normalized)) {
    return "a required host port is already allocated";
  }

  // `#!/bin/sh\r` fails with "not found"/"exec format error" that names the
  // script, not the line ending. Say so before the registry heuristic claims it.
  const scriptPath = normalized.match(SCRIPT_PATH)?.[1];
  if (scriptPath && SCRIPT_EXEC_FAILURE.test(normalized)) {
    return `${scriptPath} cannot execute on Linux — check line endings: run flisk config regenerate`;
  }

  const refusedPackages = [
    ...normalized.matchAll(/ConnectionRefused downloading package manifest (@[A-Za-z0-9._/-]+)/gi),
  ].map((match) => match[1]);
  if (refusedPackages.length > 0) {
    const unique = [...new Set(refusedPackages)];
    const shown = unique.slice(0, 4).join(", ");
    const more = unique.length > 4 ? ` (+${unique.length - 4} more)` : "";
    return `private registry ConnectionRefused for ${shown}${more} — Verdaccio (:4873) is down or unreachable from the build`;
  }

  const installScript = /install-deps\.sh/i.test(normalized);
  const installCommand = /bun install(?: --production)?|npm (?:ci|install)/i.test(normalized);
  if (installCommand || (installScript && NETWORK_OR_REGISTRY_MARKER.test(normalized))) {
    return "dependency install failed during ImageBuild — usually Verdaccio (:4873) unreachable or missing @scoped packages (ConnectionRefused downloading package manifest)";
  }
  if (installScript) {
    return "ImageBuild failed while running install-deps.sh — open the resource logs in Tilt for the actual error";
  }

  // Golden base images are named `<project>-l1`, `<project>-l2`, `<project>-l3-backend`,
  // `<project>-l4-migrator`, and so on, for whatever the project is called.
  const goldenBase = normalized.match(GOLDEN_BASE_IMAGE_PULL_FAILURE);
  if (goldenBase) {
    return `base image ${goldenBase[1]} was missing when this build started (the golden layers weren't built yet, or golden-layers-build failed) - Tilt does not retry a failed build by itself`;
  }

  const missingImage =
    normalized.match(/No such image:\s*([^\s]+)/i)?.[1] ??
    normalized.match(/pull access denied for ([^,:\s]+)/i)?.[1] ??
    undefined;
  const composeService = normalized.match(/\bup\s+-d\s+--no-build\s+([A-Za-z0-9._-]+)/i)?.[1];
  if (
    missingImage ||
    composeService ||
    /docker compose .*\bup\s+-d\s+--no-build\b/i.test(normalized)
  ) {
    const imageLabel = missingImage ?? `${composeService ?? "service"}:dev`;
    const serviceHint = composeService ? ` for ${composeService}` : "";
    return `compose run failed because image is missing (${imageLabel})${serviceHint} — wait for the ImageBuild resource to finish, then re-trigger the *-run-only resource`;
  }

  if (/bun run build/i.test(normalized)) {
    return "ImageBuild failed during `bun run build` (compile/typecheck) — open the resource logs in Tilt for the TypeScript/build error";
  }

  if (/ImageBuild:/i.test(normalized) || /^Command "/i.test(normalized)) {
    return normalized.slice(0, 220);
  }

  return normalized.slice(0, 220);
}

export function isRegistryRelatedBuildError(error: string): boolean {
  // A CRLF shebang is an executable-format problem, never a registry problem.
  if (SCRIPT_PATH.test(error) && SCRIPT_EXEC_FAILURE.test(error)) {
    return false;
  }
  return (
    /ConnectionRefused downloading package manifest|Verdaccio|private registry|dependency install failed during ImageBuild|bun install/i.test(
      error,
    ) ||
    (/install-deps\.sh/i.test(error) && NETWORK_OR_REGISTRY_MARKER.test(error))
  );
}

export interface TiltResourceCheckOptions {
  /** Override project detection; null means the check runs outside a project. */
  projectRoot?: string | null;
  /** Override the port lookup (tests and callers that already resolved it). */
  tiltPort?: number;
  /** Override the host owner lookup so no lsof/ps is spawned in unit tests. */
  ownerOf?: (port: number) => TiltPortOwner | null;
}

/**
 * When a Tilt session is active, surface resource update errors (Traefik port
 * binds, image builds, etc.) instead of claiming the environment is ready
 * while apps sit forever in pending/none. Never read resources from a Tilt
 * that belongs to another project: use the same owner lookup as `status`.
 */
export function checkTiltResourceHealth(
  exec: typeof execSync = execSync,
  options: TiltResourceCheckOptions = {},
): CheckResult {
  const ownerOf = options.ownerOf ?? findTiltPortOwner;
  const projectRoot = options.projectRoot === undefined ? findProjectRoot() : options.projectRoot;
  const tiltPort =
    options.tiltPort ??
    (projectRoot
      ? (resolveRuntimeTiltPort(projectRoot, { envPort: process.env.TILT_PORT, ownerOf }) ??
        getTiltPollingPort(process.env.TILT_PORT))
      : getTiltPollingPort(process.env.TILT_PORT));

  const foreign = findForeignTiltOnPort(tiltPort, projectRoot, ownerOf);
  if (foreign) {
    return {
      name: "Tilt Resources",
      didPass: true,
      isSkipped: true,
      message: `a Tilt for ${foreign.root} is running on ${foreign.port}; this project is not running`,
      fix: `Start this project with: flisk up. It chooses a free Tilt UI port; set TILT_PORT to a free port if you need a specific one (${foreign.port} belongs to ${foreign.root}).`,
    };
  }

  let jsonText = "";
  try {
    jsonText = runHostCommand(
      exec,
      "tilt",
      ["get", "uiresources", "-o", "json", "--port", String(tiltPort)],
      `tilt get uiresources -o json --port ${tiltPort}`,
      {
        stdio: "pipe",
        encoding: "utf-8",
        timeout: EXEC_TIMEOUT_MS,
      },
    );
  } catch {
    return {
      name: "Tilt Resources",
      didPass: true,
      isSkipped: true,
      message: "Tilt is not running - skipped resource status check",
      fix: "Start them with: flisk up",
    };
  }

  let parsed: ReturnType<typeof parseTiltResourceFailures>;
  try {
    parsed = parseTiltResourceFailures(jsonText, getDeferredResourceNames(undefined, projectRoot));
  } catch {
    return {
      name: "Tilt Resources",
      didPass: true,
      isSkipped: true,
      message: "Could not parse Tilt resource status - skipped",
    };
  }

  if (parsed.total === 0) {
    return {
      name: "Tilt Resources",
      didPass: true,
      isSkipped: true,
      message: "No Tilt UIResources found",
    };
  }

  const staleDisabled = findStaleDisabledResources(jsonText, projectRoot);

  if (parsed.failures.length === 0) {
    if (staleDisabled.length > 0) {
      return {
        name: "Tilt Resources",
        didPass: false,
        message: `Tilt keeps ${formatCount(staleDisabled.length, "resource")} Disabled that the Tiltfile enables (${staleDisabled.join(", ")}) — restart needed: flisk down && flisk up`,
        fix: "Restart the running stack so Tilt applies the updated enable list: flisk down && flisk up",
      };
    }
    const deferredNote = parsed.deferredCount > 0 ? `, ${parsed.deferredCount} deferred` : "";
    return {
      name: "Tilt Resources",
      didPass: true,
      message: `Tilt resources healthy (${parsed.okCount} ok, ${parsed.pendingCount} pending${deferredNote})`,
    };
  }

  // Always list every failed resource. Earlier logic showed only "critical"
  // infra matches (e.g. nats-http-bridge) and hid the other ImageBuild/run-only
  // failures, so doctor said "7 failed" while printing a single line.
  const ordered = orderTiltFailures(parsed.failures);
  const maxListed = 20;
  const listed = ordered.slice(0, maxListed);
  const omitted = ordered.length - listed.length;

  const described = listed.map((failure) => ({
    failure,
    why: describeTiltFailure(failure, exec),
  }));
  const details = described.map(({ failure, why }) => `${failure.name}: ${why}`).join("\n    ");
  const omittedNote =
    omitted > 0 ? `\n    …and ${formatCount(omitted, "more failed resource")}` : "";

  const pendingNote =
    parsed.pendingCount > 0
      ? `\n    ${formatCount(parsed.pendingCount, "resource")} still pending/not started — often blocked by the failures above.`
      : "";
  const deferredNote =
    parsed.deferredCount > 0
      ? `\n    ${formatCount(parsed.deferredCount, "resource")} intentionally deferred (sablier.deferStart) — not started until first request, unrelated to the failures above.`
      : "";
  const staleDisabledNote =
    staleDisabled.length > 0
      ? `\n    ${formatCount(staleDisabled.length, "resource")} still Disabled that the Tiltfile enables (${staleDisabled.join(", ")}) — restart needed: flisk down && flisk up`
      : "";

  const hasPortConflict = ordered.some((failure) =>
    /port is already allocated/i.test(failure.error),
  );
  const hasRegistryFailure = ordered.some(
    (failure) =>
      isRegistryRelatedBuildError(failure.error) ||
      isRegistryRelatedBuildError(summarizeTiltBuildError(failure.error)),
  );
  const hasKafkaRuntimeFailure = described.some(({ why }) =>
    /Kafka broker unreachable|kafka:9092/i.test(why),
  );

  let fix =
    "Open the Tilt UI URL printed by flisk up (default port " +
    STANDARD_PORTS.tiltUi +
    " when TILT_PORT is unset), inspect the red resources, fix the listed errors, then `tilt trigger <resource>` or re-run `flisk up`.";
  if (hasPortConflict) {
    fix =
      "Free the conflicting host port (usually 80/443): `docker ps --filter publish=80` then `docker stop <other-traefik>`. Re-trigger Traefik in the Tilt UI or run `flisk up` again.";
  } else if (hasRegistryFailure) {
    fix =
      "Start Verdaccio (`bun run verdaccio:start`), ensure packages are published (`bun run publish:all`), confirm `curl http://localhost:4873` works, then `tilt trigger` the failed resources.";
  } else if (hasKafkaRuntimeFailure) {
    fix =
      "Kafka is not running (optional infra). Start it, point the bridge at a real broker, or disable Kafka-dependent resources until Kafka is enabled.";
  }

  return {
    name: "Tilt Resources",
    didPass: false,
    message: `Tilt reports ${formatCount(parsed.failures.length, "failed resource")}:\n    ${details}${omittedNote}${pendingNote}${deferredNote}${staleDisabledNote}`,
    fix,
  };
}

const INFRA_FAILURE_NAME = /^(traefik|postgres|nats|infisical|verdaccio|proxy)([.-]|$)/i;

export function isInfraTiltFailure(name: string): boolean {
  return INFRA_FAILURE_NAME.test(name);
}

/** Critical infra first, then everything else — never drop failures. */
export function orderTiltFailures(failures: TiltResourceFailure[]): TiltResourceFailure[] {
  return [...failures].sort((a, b) => {
    const aInfra = isInfraTiltFailure(a.name) ? 0 : 1;
    const bInfra = isInfraTiltFailure(b.name) ? 0 : 1;
    if (aInfra !== bInfra) return aInfra - bInfra;
    return a.name.localeCompare(b.name);
  });
}

export function describeTiltFailure(
  failure: TiltResourceFailure,
  exec: typeof execSync = execSync,
): string {
  if (failure.error) {
    return summarizeTiltBuildError(failure.error);
  }
  if (failure.runtimeStatus === "error") {
    return (
      probeContainerRuntimeError(failure.name, exec) ??
      "runtime error (container crashed or unhealthy — check Tilt/docker logs)"
    );
  }
  return failure.updateStatus || failure.runtimeStatus || "unknown error";
}
