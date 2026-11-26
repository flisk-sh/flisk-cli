/** Runs doctor checks, skips container checks once the runtime failed, and orders and summarises results. */
import type { CheckResult } from "../types/index.js";
import { CONTAINER_RUNTIME_CHECK } from "./constants.js";
import { timeDoctorCheck } from "./doctor-report.js";
import type { ExecAsync } from "./exec-async.js";

/** Failures are shown before passing statuses, with a 5432 conflict first. */
export function orderDoctorResults(results: CheckResult[]): CheckResult[] {
  const failures = results.filter(
    (result) => !result.didPass && !result.isSkipped && !result.isWarning,
  );
  const remaining = results.filter(
    (result) => result.didPass || result.isSkipped || result.isWarning,
  );
  failures.sort((left, right) => {
    const rank = (result: CheckResult) => {
      if (result.name === "Host Ports" && /\b5432\b/.test(result.message)) return 0;
      if (result.name === "Host Ports") return 1;
      if (result.name === "Ingress Ports") return 2;
      return 3;
    };
    return rank(left) - rank(right);
  });
  return [...failures, ...remaining];
}

export function getDoctorOutcomeMessage(inProject: boolean, allPassed: boolean): string {
  if (!allPassed) return "Doctor failed. Fix the items above, then run: flisk doctor";
  return inProject ? "Doctor passed. Next: flisk up" : "Doctor passed. Next: flisk project example";
}

export type DoctorCheckFn = ((exec?: ExecAsync) => CheckResult | Promise<CheckResult>) & {
  requiresContainerRuntime?: boolean;
  checkName?: string;
  /** Display name used by progress output; resolved per check when not set explicitly. */
  progressName?: string;
};

/** Human name for a check function's JS name: `checkDockerVersions` becomes `Docker Versions`. */
export function prettyCheckFunctionName(fnName: string | undefined): string | undefined {
  if (!fnName) return undefined;
  const stripped = fnName.replace(/^check/, "");
  if (!stripped || !/^[A-Z]/.test(stripped)) return undefined;
  return stripped.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

/** The name progress output and skip messages use for a check before its result is known. */
export function doctorCheckName(check: DoctorCheckFn): string {
  if (check.progressName) return check.progressName;
  if (check.checkName) return check.checkName;
  const mapped = check.name ? CONTAINER_CHECK_NAMES_MAP[check.name] : undefined;
  if (mapped) return mapped;
  return prettyCheckFunctionName(check.name) ?? "Doctor check";
}

/** Attaches the display name progress output and skip messages should use for a check. */
export function namedCheck(
  checkName: string,
  check: () => CheckResult | Promise<CheckResult>,
): DoctorCheckFn {
  const wrapped: DoctorCheckFn = () => check();
  wrapped.checkName = checkName;
  return wrapped;
}

/** Per-check lifecycle events; a stuck check is the one that started but never finished. */
export interface DoctorCheckProgress {
  onCheckStart?: (check: DoctorCheckFn) => void;
  onCheckFinish?: (check: DoctorCheckFn, result?: CheckResult) => void;
}

export const CONTAINER_CHECK_NAMES_MAP: Record<string, string> = {
  checkDockerOperatingSystem: "Docker OS",
  checkDockerCompose: "Docker Compose",
  checkDockerVersions: "Docker Versions",
  checkDockerNetworkCapacity: "Docker Network Pool",
  checkContainerResourceHealth: "Container Resource Health",
  checkCrashLoopingContainers: "Crash-looping containers",
  checkTiltResourceHealth: "Tilt Resources",
  checkServiceHealth: "Service Health",
  checkServiceSmoke: "Service Smoke",
  checkAdvertisedEndpoints: "Advertised Endpoints",
  checkDockerBuildCache: "Docker Build Cache",
  checkDockerFileSharing: "Docker File Sharing",
};

export const CONTAINER_DEPENDENT_CHECK_NAMES = new Set([
  "Docker OS",
  "Docker Compose",
  "Docker Versions",
  "Docker Network Pool",
  "Compose event watchers",
  "Container Resource Health",
  "Crash-looping containers",
  "Tilt Resources",
  "Service Health",
  "Service Smoke",
  "Advertised Endpoints",
  "Docker Build Cache",
  "Colima Disk",
  "Docker File Sharing",
  ...Object.keys(CONTAINER_CHECK_NAMES_MAP),
]);

export function isContainerDependentCheck(check: DoctorCheckFn): boolean {
  if (check.requiresContainerRuntime) return true;
  if (check.checkName && CONTAINER_DEPENDENT_CHECK_NAMES.has(check.checkName)) return true;
  if (check.name && CONTAINER_DEPENDENT_CHECK_NAMES.has(check.name)) return true;
  return false;
}

export function requiresContainerRuntime(
  checkName: string,
  check: () => CheckResult | Promise<CheckResult>,
): DoctorCheckFn {
  const wrapped: DoctorCheckFn = () => check();
  wrapped.requiresContainerRuntime = true;
  wrapped.checkName = checkName;
  return wrapped;
}

/** The synthetic result used when a container-dependent check cannot run because Docker is down. */
function skippedContainerCheck(check: DoctorCheckFn): CheckResult {
  let checkName = check.checkName;
  if (checkName === undefined) {
    const mappedName = check.name ? CONTAINER_CHECK_NAMES_MAP[check.name] : undefined;
    if (mappedName) {
      checkName = mappedName;
    } else if (check.name && check.name !== "check" && check.name !== "fn") {
      checkName = check.name;
    } else {
      checkName = "Container check";
    }
  }
  return {
    name: checkName,
    didPass: true,
    isSkipped: true,
    message: `Docker not running - skipped ${checkName} check`,
  };
}

type SettledCheck = PromiseSettledResult<CheckResult>;

function recordSettled(
  settled: SettledCheck[],
  indices: number[],
  slots: Array<SettledCheck | undefined>,
): void {
  settled.forEach((result, position) => {
    slots[indices[position]] = result;
  });
}

export async function runChecks(
  checks: DoctorCheckFn[],
  options: { all?: boolean; containerRuntimeFailed?: boolean } & DoctorCheckProgress = {},
): Promise<CheckResult[]> {
  const runtimeFailedAtStart = Boolean(options.containerRuntimeFailed);
  // Progress fires as each check settles, not after allSettled: a check that never finishes must
  // stay visibly pending instead of stalling the run silently.
  const runOne = (check: DoctorCheckFn) => {
    options.onCheckStart?.(check);
    return timeDoctorCheck(check).then(
      (result) => {
        options.onCheckFinish?.(check, result);
        return result;
      },
      (reason: unknown) => {
        options.onCheckFinish?.(check);
        throw reason;
      },
    );
  };

  // Stopping at the first failure is inherently ordered: later checks must not even start, so
  // keep this path sequential (plain `flisk doctor`).
  if (!options.all) {
    const results: CheckResult[] = [];
    let containerRuntimeFailed = runtimeFailedAtStart;
    for (const check of checks) {
      if (containerRuntimeFailed && isContainerDependentCheck(check)) {
        results.push(skippedContainerCheck(check));
        continue;
      }
      const result = await runOne(check);
      results.push(result);
      if (result.name === CONTAINER_RUNTIME_CHECK && !result.didPass) {
        containerRuntimeFailed = true;
      }
      if (!result.didPass && !result.isSkipped && !result.isWarning) break;
    }
    return results;
  }

  // `--all` runs every check, so checks that do not need the container-runtime result can start
  // together. A check that needs Docker is deferred until the runtime result is known, unless it
  // sits before the runtime check (where the sequential version ran it before learning the result)
  // or Docker was already known to be down. Results are written back by original index, so output
  // order is unchanged regardless of which probe settles first.
  const slots: Array<SettledCheck | undefined> = new Array(checks.length);
  const independent: number[] = [];
  const dependent: number[] = [];
  checks.forEach((check, index) => {
    (isContainerDependentCheck(check) ? dependent : independent).push(index);
  });

  recordSettled(
    await Promise.allSettled(independent.map((index) => runOne(checks[index]))),
    independent,
    slots,
  );

  const runtimeIndex = independent.find(
    (index) =>
      slots[index]?.status === "fulfilled" && slots[index].value.name === CONTAINER_RUNTIME_CHECK,
  );
  const runtimeFailed =
    runtimeFailedAtStart ||
    (runtimeIndex !== undefined &&
      slots[runtimeIndex]?.status === "fulfilled" &&
      !slots[runtimeIndex].value.didPass);
  const runnableDependent = dependent.filter(
    (index) =>
      !runtimeFailedAtStart &&
      (runtimeIndex === undefined || index < runtimeIndex || !runtimeFailed),
  );

  recordSettled(
    await Promise.allSettled(runnableDependent.map((index) => runOne(checks[index]))),
    runnableDependent,
    slots,
  );

  return checks.map((check, index) => {
    const settled = slots[index];
    // A rejected probe is still a failure, not a silent omission: rethrow it in check order.
    if (settled === undefined) return skippedContainerCheck(check);
    if (settled.status === "fulfilled") return settled.value;
    throw settled.reason;
  });
}

export function formatDoctorSummary(results: CheckResult[]): string {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let warned = 0;
  for (const result of results) {
    if (result.isSkipped) {
      skipped++;
    } else if (result.isWarning) {
      warned++;
    } else if (result.didPass) {
      passed++;
    } else {
      failed++;
    }
  }
  if (warned > 0) {
    return `${passed} passed, ${warned} warned, ${failed} failed, ${skipped} skipped`;
  }
  return `${passed} passed, ${failed} failed, ${skipped} skipped`;
}
