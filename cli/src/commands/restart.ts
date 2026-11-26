// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import chalk from "chalk";
import { Command } from "commander";
import { isTiltfileOrchestration } from "../generator/project-config.js";
import type { DiscoveredResource } from "../types/index.js";
import { STANDARD_PORTS } from "../utils/constants.js";
import {
  collectSidecarDependents,
  isGeneratedComposeContainer,
  parseEnabledTiltResourceNames,
  restartContainer,
} from "../utils/container-restart.js";
import { dependencyEdges } from "../utils/dependency-graph.js";
import { createDiscoveryContext } from "../utils/discovery-context.js";
import {
  errorFactories,
  FliskError,
  ProcessExitError,
  runCommand,
  showErrorAndExit,
} from "../utils/errors.js";
import { resolveRuntimeTiltPort } from "../utils/host-port-config.js";
import {
  createMachineEnvelope,
  toMachineError,
  writeMachineError,
} from "../utils/machine-output.js";
import {
  dependencyWaves,
  isProcessAlive,
  type NativeRestartResult,
  readNativeRunState,
  requestNativeRestart,
} from "../utils/native-runtime.js";
import { isNativeProject } from "../utils/native-service.js";
import { withFailureLogs } from "../utils/native-up.js";
import { addProjectOption, resolveCommandProject } from "../utils/project-resolution.js";
import { isTiltAvailable, runTilt } from "../utils/tilt.js";
import { isTiltConnectionFailure } from "../utils/tilt-logs.js";
import { tiltUnreachableMessage } from "../utils/tilt-unreachable-message.js";
import { isValidPort } from "../utils/validation.js";

/**
 * The error when no `flisk up` supervises this project's local processes: restart asks that run for the
 * restart, so nothing can answer it. `flisk down && flisk up` would restart the processes only by stopping
 * them all first, which is why it is not offered as a suggestion here.
 */
function failNativeNotRunning(json: boolean): never {
  const message =
    "`flisk restart` asks the running `flisk up` to restart local processes; no `flisk up` is running for this project.";
  const suggestions = ["Start the project with: flisk up"];
  if (json) {
    console.log(
      JSON.stringify(
        createMachineEnvelope(null, [{ code: "NATIVE_NOT_RUNNING", message, suggestions }]),
      ),
    );
    process.exit(1);
  }
  throw new FliskError(message, suggestions);
}

/** `--wait` as milliseconds; a bad value is a usage error like the other flag checks. */
function nativeWaitMs(raw: unknown): number {
  const waitSeconds = Number(raw);
  if (!Number.isFinite(waitSeconds) || waitSeconds < 0) {
    throw new FliskError("--wait must be a number of seconds, 0 or more", [
      "Pass --wait 60, or --wait 0 to return once the restart has begun",
    ]);
  }
  return waitSeconds * 1000;
}

/** The `resources` entries a native restart emits: `ready` carries whether the wait saw the health check pass. */
function nativeRestartReport(
  outcomes: ReadonlyArray<{ name: string; result: NativeRestartResult }>,
  logs: ReadonlyMap<string, string[]>,
): Array<{
  resource: string;
  state: string;
  ready: boolean;
  pid?: number;
  reason?: string;
  logs?: string[];
}> {
  return outcomes.map(({ name, result }) => ({
    resource: name,
    state: result.state,
    ready: result.state === "ready",
    ...(result.pid ? { pid: result.pid } : {}),
    ...(result.reason ? { reason: result.reason } : {}),
    ...(logs.has(name) ? { logs: logs.get(name) } : {}),
  }));
}

/**
 * `flisk restart` with no name in a local-process project: restarts every local process of the run, in
 * dependency order so a service's health check finds its dependencies up. `image` containers of a mixed run
 * cannot be restarted one by one (the supervisor refuses them), so they keep running and are reported as
 * skipped. One service failing does not stop the rest; the failures are reported together at the end.
 */
async function restartAllNativeServices(
  root: string,
  resources: readonly DiscoveredResource[],
  options: { waitMs: number; json: boolean },
): Promise<void> {
  const run = readNativeRunState(root);
  if (run === null || !isProcessAlive(run.pid)) {
    failNativeNotRunning(options.json);
  }
  const edges = dependencyEdges([...resources]);
  const ordered = dependencyWaves(
    Object.keys(run.services).map((name) => ({ name, dependsOn: edges.get(name) ?? [] })),
  ).flat();
  const targets = ordered.filter((name) => run.services[name]?.container === undefined);
  const skipped = ordered.filter((name) => run.services[name]?.container !== undefined);
  if (targets.length === 0) {
    // Nothing a per-service restart can reach: the run is all `image` containers, or holds no services at all.
    throw new FliskError(
      skipped.length > 0
        ? "Every service of this run is a container; there is no local process to restart."
        : "This run has no services to restart.",
      skipped.length > 0
        ? ["Restart the project with: flisk down && flisk up"]
        : ["Check what is running with: flisk status"],
    );
  }
  const outcomes: Array<{ name: string; result: NativeRestartResult }> = [];
  for (const name of targets) {
    const result = await requestNativeRestart(root, name, { waitMs: options.waitMs });
    if (result.state === "not-running") {
      // The run ended between the state read and this request: what it did restart is reported nowhere,
      // because the run itself is gone.
      failNativeNotRunning(options.json);
    }
    outcomes.push({ name, result });
  }
  const failed = outcomes.filter(
    ({ result }) => result.state === "failed" || result.state === "timeout",
  );
  // The oldest restart marker of the failures scopes the log tail; a failure without one reads the whole tail.
  const logsSince = Math.min(
    ...failed.map(({ result }) => result.logsSince ?? Number.POSITIVE_INFINITY),
  );
  const withLogs = new Map(
    withFailureLogs(
      root,
      failed.map(({ name, result }) => ({ name, reason: result.reason ?? result.state })),
      Number.isFinite(logsSince) ? logsSince : undefined,
    ).map((failure) => [failure.name, failure.logs ?? []] as const),
  );
  if (failed.length === 0) {
    if (options.json) {
      console.log(
        JSON.stringify(
          createMachineEnvelope({
            runtime: "native",
            restarted: true,
            resources: nativeRestartReport(outcomes, withLogs),
            ...(skipped.length > 0 ? { skipped } : {}),
          }),
        ),
      );
      return;
    }
    const readyNames = outcomes
      .filter(({ result }) => result.state === "ready")
      .map(({ name }) => name);
    const pendingNames = outcomes
      .filter(({ result }) => result.state === "restarting")
      .map(({ name }) => name);
    const summary = [
      readyNames.length > 0 ? `Restarted ${readyNames.join(", ")} (ready)` : "",
      pendingNames.length > 0 ? `restarting ${pendingNames.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("; ");
    console.log(chalk.green(`✓ ${summary}`));
    if (skipped.length > 0) {
      console.log(
        chalk.gray(
          `Containers keep running (${skipped.join(", ")}); restart the run to restart them: flisk down && flisk up`,
        ),
      );
    }
    return;
  }
  if (options.json) {
    console.log(
      JSON.stringify(
        createMachineEnvelope(
          {
            ok: false,
            runtime: "native",
            restarted: false,
            resources: nativeRestartReport(outcomes, withLogs),
            ...(skipped.length > 0 ? { skipped } : {}),
          },
          failed.map(({ name, result }) => ({
            code: result.state === "failed" ? "RESTART_FAILED" : "RESTART_NOT_READY",
            message: `${name} ${result.state === "failed" ? "did not come back" : "is not ready yet"}: ${result.reason ?? result.state}`,
          })),
        ),
      ),
    );
    process.exit(1);
  }
  const lines = failed.flatMap(({ name, result }) => [
    `  ✗ ${name}: ${result.reason ?? result.state}`,
    ...(withLogs.get(name) ?? []).map((line) => `      ${line}`),
  ]);
  throw new FliskError(["Local processes did not restart:", ...lines].join("\n"), [
    ...failed.map(({ name }) => `Read the output with: flisk logs --service ${name}`),
  ]);
}

export const restartCommand = addProjectOption(new Command("restart"), "restart")
  .description("Restart a running resource in the stack")
  .argument(
    "[resource]",
    "Name of the resource (service) to restart (local-process projects: omit it to restart every service)",
  )
  .option("--port <n>", "Tilt UI port (default: TILT_PORT or 10350)")
  .option("--rebuild", "Rebuild the image through Tilt instead of restarting the container", false)
  .option(
    "--wait <seconds>",
    "Local processes: how long to wait for the service to be ready again (0: return once the restart has begun)",
    "60",
  )
  .option("--json", "Output one JSON object and exit", false)
  .addHelpText(
    "after",
    "\nExamples:\n  flisk restart orders-api\n  flisk restart orders-api --json\n  flisk restart orders-api --rebuild" +
      "\n  flisk restart             (local-process project: restart every service)" +
      "\n\nTilt resources require Tilt; local processes restart through the running `flisk up`.",
  )
  .showHelpAfterError("\nRun `flisk resources` to see the resource names you can restart.")
  .action(async (resourceName: string | undefined, options, command: Command) => {
    const portText = options.port ?? process.env.TILT_PORT ?? String(STANDARD_PORTS.tiltUi);
    if (!isValidPort(portText)) {
      const portSource = options.port !== undefined ? "--port" : "TILT_PORT";
      const message = `${portSource} must be a valid port number`;
      if (options.json) {
        console.log(JSON.stringify(createMachineEnvelope(null, [{ code: "USAGE", message }])));
        console.error(message);
        process.exit(2);
      }
      showErrorAndExit(message, 2);
    }

    const action = async (): Promise<void> => {
      const root = await resolveCommandProject({
        commandName: "restart",
        project: options.project ?? command.optsWithGlobals().project,
        json: options.json,
      });

      const discovery = createDiscoveryContext();
      const isNative = isNativeProject(discovery.resources);

      // With no name, a local-process project restarts every service of the run; a container project's
      // name stays required, so its no-name run reports the same usage error it always did.
      if (resourceName === undefined) {
        if (!isNative) {
          const message = "error: missing required argument 'resource'";
          if (options.json) {
            console.log(JSON.stringify(createMachineEnvelope(null, [{ code: "USAGE", message }])));
            process.exit(2);
          }
          console.error(chalk.red(message));
          console.error("\nRun `flisk resources` to see the resource names you can restart.");
          process.exit(2);
        }
        return await restartAllNativeServices(root, discovery.resources, {
          waitMs: nativeWaitMs(options.wait),
          json: Boolean(options.json),
        });
      }

      // Check the name against the project's resources before probing Tilt, so a
      // typo reports UNKNOWN_RESOURCE instead of a misleading "Could not reach Tilt".
      const resource = discovery.resources.find((r) => r.name === resourceName);
      if (!resource) {
        const unknownResource = errorFactories.unknownResource(
          resourceName,
          discovery.resources.map((candidate) => candidate.name),
        );
        if (options.json) {
          const { error } = toMachineError(unknownResource);
          console.log(JSON.stringify(createMachineEnvelope(null, [error])));
          process.exit(1);
        }
        throw unknownResource;
      }

      // A project of `command` services runs as local processes under `flisk up`, with no Tilt to trigger: ask that run to
      // restart the one service and report what happened to it.
      if (isNative) {
        const outcome = await requestNativeRestart(root, resourceName, {
          waitMs: nativeWaitMs(options.wait),
        });
        if (outcome.state === "not-running") {
          failNativeNotRunning(Boolean(options.json));
        }
        const fail = (code: string, message: string, logs: string[] = []): never => {
          if (options.json) {
            console.log(
              JSON.stringify(
                createMachineEnvelope(
                  {
                    ok: false,
                    resource: resourceName,
                    runtime: "native",
                    restarted: false,
                    state: outcome.state,
                    logs,
                  },
                  [{ code, message }],
                ),
              ),
            );
            process.exit(1);
          }
          throw new FliskError(message, [
            ...logs,
            `Read the output with: flisk logs --service ${resourceName}`,
          ]);
        };
        if (outcome.state === "failed" || outcome.state === "timeout") {
          const [withLogs] = withFailureLogs(
            root,
            [{ name: resourceName, reason: outcome.reason ?? outcome.state }],
            outcome.logsSince,
          );
          return fail(
            outcome.state === "failed" ? "RESTART_FAILED" : "RESTART_NOT_READY",
            `${resourceName} ${outcome.state === "failed" ? "did not come back" : "is not ready yet"}: ${outcome.reason ?? outcome.state}`,
            withLogs?.logs ?? [],
          );
        }
        if (options.json) {
          console.log(
            JSON.stringify(
              createMachineEnvelope({
                resource: resourceName,
                runtime: "native",
                restarted: true,
                state: outcome.state,
                ready: outcome.state === "ready",
                ...(outcome.pid ? { pid: outcome.pid } : {}),
              }),
            ),
          );
          return;
        }
        console.log(
          chalk.green(
            outcome.state === "ready"
              ? `✓ Restarted ${resourceName} (ready)`
              : `✓ Restarting ${resourceName}`,
          ),
        );
        return;
      }

      let tiltAvailable = false;
      try {
        tiltAvailable = await isTiltAvailable();
      } catch {
        tiltAvailable = false;
      }

      if (!tiltAvailable) {
        // isTiltAvailable checks only whether the binary is on PATH. A binary that cannot run
        // surfaces from the command that invokes it; a missing one is rare and still shows in doctor.
        // Report TILT_NOT_RUNNING when the binary is absent.
        const msg = tiltUnreachableMessage(portText);
        if (options.json) {
          console.log(
            JSON.stringify(
              createMachineEnvelope(null, [{ code: "TILT_NOT_RUNNING", message: msg }]),
            ),
          );
          process.exit(1);
        }
        throw new FliskError(msg, ["Start the stack first with: flisk up"]);
      }

      const effectivePort =
        options.port !== undefined
          ? portText
          : resolveRuntimeTiltPort(root, { envPort: process.env.TILT_PORT });
      if (effectivePort === null) {
        const msg = tiltUnreachableMessage(portText);
        if (options.json) {
          console.log(
            JSON.stringify(
              createMachineEnvelope(null, [{ code: "TILT_NOT_RUNNING", message: msg }]),
            ),
          );
          process.exit(1);
        }
        throw new FliskError(msg, ["Start the stack first with: flisk up"]);
      }
      const activePortText = String(effectivePort);

      // Generated Compose containers keep their image: `docker restart` of the labelled container stops and starts
      // the existing container, so no new tilt-<hash> image is built (#4192). Local-process (`command`) services,
      // logical/non-container resource types (`database`, `library`, `sdk`, `infra`), and --rebuild (which asks
      // for a full Tilt update and re-reads .env), plus imported Tiltfiles that own their orchestration and may not
      // use Flisk's Compose labels, all keep the original `tilt trigger` path.
      const isContainer = isGeneratedComposeContainer(resource);
      const rebuild = options.rebuild === true;
      let rebuilt = false;
      if (isContainer && !rebuild && !isTiltfileOrchestration(root)) {
        // `tilt version` only checks the binary. Confirm Tilt answers on the resolved port before
        // touching Docker, even if a container is still present after the stack has stopped.
        let tiltReachable = false;
        let enabledResources: Set<string> | null = null;
        try {
          const result = await runTilt(
            "get",
            ["uiresources", "-o", "json", "--port", activePortText],
            {
              inheritStdio: false,
              timeoutMs: 5_000,
            },
          );
          tiltReachable = result.exitCode === 0;
          if (tiltReachable) {
            enabledResources = parseEnabledTiltResourceNames(result.stdout);
          }
        } catch {
          tiltReachable = false;
        }
        if (!tiltReachable) {
          const msg = tiltUnreachableMessage(activePortText);
          if (options.json) {
            console.log(
              JSON.stringify(
                createMachineEnvelope(null, [{ code: "TILT_NOT_RUNNING", message: msg }]),
              ),
            );
            process.exit(1);
          }
          throw new FliskError(msg, ["Start the stack first with: flisk up"]);
        }
        try {
          const dependents = collectSidecarDependents(discovery.resources, resourceName).filter(
            (dep) => enabledResources === null || enabledResources.has(dep.name),
          );
          const targetsToRestart = [resource, ...dependents];
          for (const target of targetsToRestart) {
            const stopGracePeriod = target.config?.container?.stopGracePeriod;
            const targetStack = target.stack ?? resource.stack ?? target.name;
            if (stopGracePeriod !== undefined) {
              restartContainer(root, targetStack, target.name, undefined, {
                stopGracePeriod,
              });
            } else {
              restartContainer(root, targetStack, target.name);
            }
          }
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          if (options.json) {
            console.log(
              JSON.stringify(
                createMachineEnvelope(null, [{ code: "TILT_TRIGGER_FAILED", message: detail }]),
              ),
            );
            process.exit(1);
          }
          const suggestions =
            error instanceof FliskError
              ? error.suggestions
              : ["Check the container with: docker ps", "Read the logs with: flisk logs"];
          throw new FliskError(`Failed to restart ${resourceName}: ${detail}`, suggestions);
        }
      } else {
        const result = await runTilt("trigger", [resourceName, "--port", activePortText], {
          inheritStdio: false,
        });

        if (result.exitCode !== 0) {
          const detail = result.stderr.trim();
          if (!detail || isTiltConnectionFailure(detail)) {
            const msg = tiltUnreachableMessage(activePortText);
            if (options.json) {
              console.log(
                JSON.stringify(
                  createMachineEnvelope(null, [{ code: "TILT_NOT_RUNNING", message: msg }]),
                ),
              );
              process.exit(1);
            }
            throw new FliskError(msg, ["Start the stack first with: flisk up"]);
          }
          if (options.json) {
            console.log(
              JSON.stringify(
                createMachineEnvelope(null, [{ code: "TILT_TRIGGER_FAILED", message: detail }]),
              ),
            );
            process.exit(1);
          }
          throw new FliskError(`Failed to restart ${resourceName}: ${detail}`, [
            "Check that the stack is running with: flisk status",
            `Read the resource logs with: flisk logs --service ${resourceName}`,
          ]);
        }
        rebuilt = true;
      }

      if (options.json) {
        console.log(
          JSON.stringify(createMachineEnvelope({ resource: resourceName, restarted: true })),
        );
        return;
      }

      console.log(
        chalk.green(
          rebuilt ? `✓ Triggered restart for ${resourceName}` : `✓ Restarted ${resourceName}`,
        ),
      );
    };

    if (options.json) {
      try {
        await action();
      } catch (err) {
        if (err instanceof ProcessExitError) {
          throw err;
        }
        writeMachineError(err);
      }
      return;
    }
    await runCommand(action);
  });
