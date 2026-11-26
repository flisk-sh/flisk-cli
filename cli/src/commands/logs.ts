// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import chalk from "chalk";
import { Command } from "commander";
import { isTiltfileOrchestration } from "../generator/project-config.js";
import type { DiscoveredResource } from "../types/index.js";
import { attachNoPositionalHint } from "../utils/command-helpers.js";
import { STANDARD_PORTS } from "../utils/constants.js";
import { dependsOnOf } from "../utils/dependency-graph.js";
import { getDeferredResourceNames } from "../utils/doctor-runtime.js";
import { errorFactories, FliskError, runCommand, showErrorAndExit } from "../utils/errors.js";
import { resolveRuntimeTiltPort } from "../utils/host-port-config.js";
import { applyLogCursor, isValidCursor } from "../utils/log-cursors.js";
import { createMachineEnvelope, toMachineError } from "../utils/machine-output.js";
import { isValidNativeRun } from "../utils/native-log.js";
import {
  isNativeRunSupervisorAlive,
  nativeServiceStates,
  nativeUnhealthyServices,
  readNativeLogLines,
  readNativeRunState,
  recordedNativeServiceNames,
} from "../utils/native-runtime.js";
import { isNativeProject } from "../utils/native-service.js";
import { addProjectOption, resolveCommandProject } from "../utils/project-resolution.js";
import {
  EnvUnreadableError,
  envSecretValues,
  redactLogLines,
  redactSecrets,
  redactValue,
} from "../utils/secret-redaction.js";
import { parseServiceNames } from "../utils/service-names.js";
import { deriveServiceStates } from "../utils/service-runtime-state.js";
import { discoverResourcesWithProblems, warnAboutSkippedFiles } from "../utils/services.js";
import { type UnhealthyService, unhealthyServiceNames } from "../utils/status-groups.js";
import { isTiltAvailable, runTilt } from "../utils/tilt.js";
import {
  compileLogGrep,
  DEFAULT_LOG_TAIL,
  filterLogContent,
  filterLogLinesSince,
  filterLogSource,
  isTiltConnectionFailure,
  isValidLogContext,
  isValidLogSource,
  isValidSince,
  isValidTail,
  LOG_SOURCES,
  type LogLine,
  type LogSource,
  MAX_LOG_TAIL,
  parseTiltLogLines,
  parseTiltWebviewLogLines,
  sinceMilliseconds,
} from "../utils/tilt-logs.js";
import { tiltUnreachableMessage } from "../utils/tilt-unreachable-message.js";
import { isValidPort } from "../utils/validation.js";

/** Resource names Tilt knows about, or null when they cannot be listed (the logs call then reports the real error). */
async function tiltResourceNames(port: string): Promise<string[] | null> {
  try {
    const result = await runTilt("get", ["uiresources", "-o", "json", "--port", port], {
      inheritStdio: false,
    });
    if (result.exitCode !== 0) return null;
    const items = (JSON.parse(result.stdout) as { items?: Array<{ metadata?: { name?: string } }> })
      .items;
    return (items ?? []).flatMap((item) => (item.metadata?.name ? [item.metadata.name] : []));
  } catch {
    return null;
  }
}

/** Raw `tilt get uiresources` JSON, or null when Tilt cannot be read. */
async function tiltResourcesJson(port: string): Promise<string | null> {
  try {
    const result = await runTilt("get", ["uiresources", "-o", "json", "--port", port], {
      inheritStdio: false,
    });
    return result.exitCode === 0 ? result.stdout : null;
  } catch {
    return null;
  }
}

/** Failing or pending services among the project's, from the running Tilt; null when Tilt cannot be read. */
async function tiltUnhealthyServices(
  projectRoot: string,
  port: string,
): Promise<UnhealthyService[] | null> {
  const text = await tiltResourcesJson(port);
  if (!text) return null;
  let resources: DiscoveredResource[] = [];
  try {
    // logs already warned (with secrets masked) about skipped files in discoverProjectResources.
    resources = discoverResourcesWithProblems(projectRoot).resources;
  } catch {
    // Without discovery there are no dependsOn edges; Tilt's own states still decide.
  }
  try {
    const states = deriveServiceStates(
      text,
      Object.fromEntries(resources.map((r) => [r.name, dependsOnOf(r.config)])),
      getDeferredResourceNames(resources),
    );
    return unhealthyServiceNames(
      Object.keys(states).map((name) => ({ name })),
      states,
    ).map((name) => {
      const state = states[name];
      return {
        name,
        status: state?.status === "error" ? ("error" as const) : ("pending" as const),
        ...(state?.reason ? { reason: state.reason } : {}),
      };
    });
  } catch {
    return null;
  }
}

/**
 * The project's declared resources, or null when discovery cannot read them (the Tilt reads then report the real
 * error). `partial` is true when discovery skipped a service.json, so the list may be missing real services and
 * cannot reject a `--service` name on its own.
 */
function discoverProjectResources(
  projectRoot: string,
  secrets: readonly string[],
): { resources: DiscoveredResource[]; partial: boolean } | null {
  try {
    const { resources, problems } = discoverResourcesWithProblems(projectRoot);
    // A parser error can quote part of a malformed service.json, so mask secrets before it reaches stderr.
    warnAboutSkippedFiles(
      problems.map((problem) => ({
        ...problem,
        reason: redactSecrets(problem.reason, [...secrets]),
      })),
    );
    return { resources, partial: problems.length > 0 };
  } catch {
    // Discovery problems are reported by the commands that start the stack; logs still asks Tilt.
    return null;
  }
}

export const logsCommand = addProjectOption(attachNoPositionalHint(new Command("logs")), "logs")
  .description("Print a bounded snapshot of recent logs from the running stack")
  .option("-s, --service <names...>", "Only these services (names as in flisk resources)")
  .option("-f, --follow", "Live follow is unavailable; use flisk ui or repeat with --since")
  .option("--tail <n>", "Number of most recent lines to return", String(DEFAULT_LOG_TAIL))
  .option(
    "--since <duration>",
    "Only logs newer than this duration, using real event times, for example 30s, 5m, 1h",
  )
  .option(
    "--grep <text>",
    "Filter log content (plain text; case-insensitive unless the pattern contains uppercase)",
  )
  .option("--context <n>", "Include n lines before and after each match within the same service")
  .option(
    "--after <cursor>",
    "Only lines with a sequence number greater than this cursor, returned as data.nextCursor by a previous --json read",
  )
  .option(
    "--source <source>",
    "Only runtime output (what the service printed) or build output (image build steps); a crash cause is in runtime",
  )
  .option(
    "--run <run>",
    "Only one run of each local-process service: current, previous, or a run id",
  )
  .option("--unhealthy", "Only services that are failing or still starting", false)
  .option(
    "--port <n>",
    "Tilt UI port for Docker runtime (default: TILT_PORT, then the project's saved port, then 10350)",
  )
  .option("--json", "Output one JSON object and exit", false)
  .addHelpText(
    "after",
    "\nExamples:\n  flisk logs --tail 50\n  flisk logs --service orders-api --since 5m\n  flisk logs --service orders-api --run previous\n  flisk logs --unhealthy --json\n  flisk logs --service orders-api --source runtime --json\n  flisk logs --json --after 42",
  )
  .action(async (options, command: Command) => {
    let secrets: string[] = [];
    const fail = (
      code: string,
      rawMessage: string,
      exitCode = 1,
      suggestions: string[] = [],
    ): never => {
      const message = redactSecrets(rawMessage, secrets);
      const redactedSuggestions = redactValue(suggestions, secrets);
      if (options.json) {
        console.log(
          JSON.stringify(
            createMachineEnvelope(null, [
              {
                code,
                message,
                ...(redactedSuggestions.length > 0 ? { suggestions: redactedSuggestions } : {}),
              },
            ]),
          ),
        );
        console.error(message);
        process.exit(exitCode);
      }
      if (redactedSuggestions.length > 0) {
        return new FliskError(message, redactedSuggestions, exitCode).exit();
      }
      return showErrorAndExit(message, exitCode);
    };

    if (options.follow) {
      fail(
        "FOLLOW_NOT_SUPPORTED",
        "flisk logs prints a snapshot; live follow is not supported. Use flisk ui or repeat with --since 10s.",
      );
    }
    if (!isValidTail(options.tail))
      fail("USAGE", `--tail must be an integer from 1 to ${MAX_LOG_TAIL}`, 2);
    if (options.since !== undefined && !isValidSince(options.since)) {
      fail("USAGE", "--since must be a duration such as 30s, 5m or 1h", 2, [
        "Units: ms, s, m, h. Days are not supported: use hours, for example 24h for one day.",
      ]);
    }
    if (options.after !== undefined && !isValidCursor(String(options.after))) {
      fail("USAGE", "--after must be a non-negative integer cursor from a previous logs read", 2);
    }
    if (options.source !== undefined && !isValidLogSource(options.source)) {
      fail("USAGE", `--source must be one of: ${LOG_SOURCES.join(", ")}`, 2);
    }
    if (options.run !== undefined && !isValidNativeRun(options.run)) {
      fail("USAGE", "--run must be current, previous or a run id", 2);
    }
    const source: LogSource | undefined = options.source;
    if (options.context !== undefined && options.grep === undefined) {
      fail("USAGE", "--context requires --grep", 2);
    }
    if (options.context !== undefined && !isValidLogContext(options.context)) {
      fail("USAGE", "--context must be a non-negative safe integer", 2);
    }
    // compileLogGrep escapes the pattern before compiling, so it cannot throw and no
    // caller-controlled expression reaches the RegExp engine.
    const grep = options.grep === undefined ? undefined : compileLogGrep(options.grep);
    const context = Number(options.context ?? 0);
    const portText = options.port ?? process.env.TILT_PORT ?? String(STANDARD_PORTS.tiltUi);
    if (!isValidPort(portText)) fail("USAGE", "--port must be a valid port number", 2);
    const tail = Number(options.tail);
    const after: number | undefined =
      options.after === undefined ? undefined : Number(options.after);
    const services: string[] = parseServiceNames(options.service as string[] | undefined) ?? [];

    const reportAllHealthy = (): void => {
      if (options.json) {
        console.log(
          JSON.stringify(
            createMachineEnvelope({
              services,
              tail,
              since: options.since ?? null,
              run: options.run ?? null,
              ...(source ? { source } : {}),
              lines: [],
              unhealthy: [],
              nextCursor: after ?? 0,
              truncated: false,
            }),
          ),
        );
        return;
      }
      console.log("All services are healthy; nothing to show with --unhealthy.");
    };

    const action = async (): Promise<void> => {
      const projectRoot = await resolveCommandProject({
        commandName: "logs",
        project: options.project ?? command.optsWithGlobals().project,
        json: options.json,
        onFail: (error) =>
          fail(toMachineError(error).error.code, error.message, error.exitCode, error.suggestions),
      });

      try {
        secrets = envSecretValues(projectRoot);
      } catch (error) {
        if (!(error instanceof EnvUnreadableError)) throw error;
        fail("ENV_UNREADABLE", error.message, 1, [
          "Fix the read permission on .env, or move it out of the project",
        ]);
      }

      // A project of `command` services keeps its output in .flisk/native/logs, so no Tilt is involved.
      const project = discoverProjectResources(projectRoot, secrets);
      const projectResources = project?.resources ?? null;
      const partialDiscovery = project?.partial === true;
      // An imported Tiltfile is the orchestration even when every service.json declares `command`: `up`
      // runs Tilt for it, so the native log files are not where its output lives.
      const importsTiltfile = isTiltfileOrchestration(projectRoot);
      // When the only service.json that declared `command` was skipped, discovery finds nothing native,
      // but a live native run still records its services. Log files alone outlive a shutdown, so only a
      // supervisor that is still running counts as a current run. Complete discovery stays authoritative.
      const recordedOnly =
        partialDiscovery &&
        projectResources !== null &&
        projectResources.length === 0 &&
        recordedNativeServiceNames(projectRoot).length > 0 &&
        (await isNativeRunSupervisorAlive(readNativeRunState(projectRoot)));
      const resources =
        !importsTiltfile && projectResources !== null
          ? isNativeProject(projectResources) || recordedOnly
            ? projectResources
            : null
          : null;
      if (resources) {
        const known = resources.map((resource) => resource.name);
        // A skipped service.json hides a real service from `known`, but the recorded run and its log
        // files still name it, so a partial discovery defers a name to what the run on disk recorded.
        const available = partialDiscovery
          ? [...new Set([...known, ...recordedNativeServiceNames(projectRoot)])]
          : known;
        const unknown = services.filter((name) => !available.includes(name));
        if (unknown.length > 0) {
          const error = errorFactories.unknownServices(unknown, available);
          fail("UNKNOWN_SERVICE", error.message, error.exitCode, error.suggestions);
        }
        // A local-process project has no Tilt to reach, so an idle run is not a "Tilt not running" error.
        // Report the actual state instead, with a runtime-neutral code and command to start the stack.
        const states = nativeServiceStates(projectRoot, available);
        const reported = states ? Object.values(states) : [];
        const notRunning = (status: string) => status === "stopped" || status === "unknown";
        if (reported.length > 0 && reported.every((state) => notRunning(state.status))) {
          fail(
            "SERVICES_NOT_RUNNING",
            "No services of this project are running. Start them with: flisk up",
          );
        }
        let selected = services.length > 0 ? services : available;
        let unhealthy: UnhealthyService[] | undefined;
        let sinceMs = options.since === undefined ? undefined : sinceMilliseconds(options.since);
        if (options.unhealthy) {
          const bad = new Set(
            unhealthyServiceNames(
              available.map((name) => ({ name })),
              states,
            ),
          );
          selected = selected.filter((name) => bad.has(name));
          if (selected.length === 0) return reportAllHealthy();
          const run = readNativeRunState(projectRoot);
          // The service logs are appended to across runs: without an explicit --since, only lines written since
          // this run's supervisor started can explain its state, never lines from an earlier `flisk up` (#5109).
          if (sinceMs === undefined) {
            const startedAt = Date.parse(run?.startedAt ?? "");
            if (Number.isFinite(startedAt)) sinceMs = Math.max(0, Date.now() - startedAt);
          }
          const selectedNames = new Set(selected);
          unhealthy = nativeUnhealthyServices(resources, states, run).filter((entry) =>
            selectedNames.has(entry.name),
          );
        }
        // Lines were masked when written; masking again covers a log from before a secret was added, and the guard masks a
        // private key that spans lines.
        const read = readNativeLogLines(projectRoot, selected, {
          tail: source ? MAX_LOG_TAIL : tail,
          sinceMs,
          run: options.run,
        });
        // Number before redaction: a secret added later must not move a line's seq.
        const page = applyLogCursor(
          (source ? filterLogSource(read, source) : read).slice(-tail),
          after,
        );
        const redacted = redactLogLines(page.lines, secrets);
        const lines = grep ? filterLogContent(redacted, grep, context) : redacted;
        if (options.json) {
          console.log(
            JSON.stringify(
              redactValue(
                createMachineEnvelope({
                  services,
                  tail,
                  since: options.since ?? null,
                  run: options.run ?? null,
                  ...(source ? { source } : {}),
                  lines,
                  ...(unhealthy === undefined ? {} : { unhealthy }),
                  nextCursor: page.nextCursor,
                  truncated: page.truncated,
                }),
                secrets,
              ),
            ),
          );
          return;
        }
        if (lines.length === 0) {
          if (grep) return;
          const names = selected.join(", ");
          const window = options.since === undefined ? "" : ` in the last ${options.since}`;
          console.log(
            chalk.gray(
              `No log lines yet for ${names}. It may not have started, or it printed nothing${window}.`,
            ),
          );
          return;
        }
        const width = Math.max(0, ...lines.map((line) => line.resource.length));
        for (const line of lines) {
          console.log(redactSecrets(`${line.resource.padEnd(width)} | ${line.text}`, secrets));
        }
        return;
      }

      if (options.run !== undefined) {
        fail("RUN_UNSUPPORTED", "--run is only available for local-process services", 2);
      }
      // Check the names against the project's resources before probing Tilt, so a typo reports
      // UNKNOWN_RESOURCE instead of a misleading "Could not reach Tilt" — the check restart and run do first.
      // The manifest list is not complete enough to reject a name when discovery skipped a service.json,
      // and a project orchestrated by its own imported Tiltfile keeps its resources in that Tiltfile, not
      // in service.json discovery — in both cases the running Tilt's own resource list is the check below.
      const tiltfileOrchestration = services.length > 0 && importsTiltfile;
      if (
        projectResources !== null &&
        !partialDiscovery &&
        !tiltfileOrchestration &&
        services.length > 0
      ) {
        const known = projectResources.map((resource) => resource.name);
        const unknown = services.find((name) => !known.includes(name));
        if (unknown !== undefined) {
          const error = errorFactories.unknownResource(unknown, known);
          fail(error.code, error.message, error.exitCode, error.suggestions);
        }
      }

      if (!(await isTiltAvailable())) {
        fail("TILT_MISSING", "Tilt is not installed. Run: flisk doctor");
      }

      const effectivePort =
        options.port !== undefined
          ? portText
          : resolveRuntimeTiltPort(projectRoot, { envPort: process.env.TILT_PORT });
      if (effectivePort === null) {
        fail("TILT_NOT_RUNNING", tiltUnreachableMessage(portText));
      }
      const activePortText = String(effectivePort);

      if (services.length > 0) {
        const known = await tiltResourceNames(activePortText);
        const unknown = services.filter((name) => known && !known.includes(name));
        const firstUnknown = unknown[0];
        if (tiltfileOrchestration && firstUnknown !== undefined) {
          // The manifest check cannot run for an imported Tiltfile, so Tilt's list is the resource check
          // and reports UNKNOWN_RESOURCE like the discovery check does for every other project.
          const error = errorFactories.unknownResource(firstUnknown, known ?? []);
          fail(error.code, error.message, error.exitCode, error.suggestions);
        }
        if (unknown.length > 0) {
          const error = errorFactories.unknownServices(unknown, known ?? []);
          const suggestions = error.suggestions;
          fail("UNKNOWN_SERVICE", error.message, error.exitCode, suggestions);
        }
      }
      let selectedServices = services;
      let unhealthy: UnhealthyService[] | undefined;
      if (options.unhealthy) {
        const bad = await tiltUnhealthyServices(projectRoot, activePortText);
        if (bad === null) fail("TILT_NOT_RUNNING", tiltUnreachableMessage(activePortText));
        const entries = bad ?? [];
        const badNames = new Set(entries.map((entry) => entry.name));
        selectedServices =
          services.length > 0
            ? services.filter((name) => badNames.has(name))
            : entries.map((entry) => entry.name);
        if (selectedServices.length === 0) return reportAllHealthy();
        const selectedNames = new Set(selectedServices);
        unhealthy = entries.filter((entry) => selectedNames.has(entry.name));
      }
      // In #4197, `tilt logs --since` returned the whole stored log and JSON lines carried the query time. For a
      // real time window, read the webview dump: it carries the timestamp Tilt recorded with each segment.
      const structured =
        Boolean(options.json) ||
        source !== undefined ||
        grep !== undefined ||
        options.since !== undefined;
      let windowLines: LogLine[];
      if (options.since !== undefined) {
        const dump = await runTilt("dump", ["webview", "--port", activePortText], {
          inheritStdio: false,
        });
        if (dump.exitCode !== 0) {
          const detail = dump.stderr.trim();
          if (!detail || isTiltConnectionFailure(detail)) {
            fail("TILT_NOT_RUNNING", tiltUnreachableMessage(activePortText));
          }
          fail(
            "TILT_LOG_TIMES_UNAVAILABLE",
            `Cannot read Tilt log timestamps for --since: ${detail}`,
            1,
            ["Omit --since to read all buffered logs"],
          );
        }
        // Bound the parse, then filter by service/source/time and apply --tail last, so --tail counts returned lines.
        const parsed = parseTiltWebviewLogLines(dump.stdout, MAX_LOG_TAIL);
        if (parsed === null) {
          return fail(
            "TILT_LOG_TIMES_UNAVAILABLE",
            "Tilt did not return readable log timestamps for --since.",
            1,
            ["Omit --since to read all buffered logs", "Check the Tilt version with: tilt version"],
          );
        }
        const scoped =
          selectedServices.length > 0
            ? parsed.filter(
                (line) => line.resource !== null && selectedServices.includes(line.resource),
              )
            : parsed;
        const dated = filterLogLinesSince(scoped, sinceMilliseconds(options.since));
        windowLines = redactLogLines(
          (source ? filterLogSource(dated, source) : dated).slice(-tail),
          secrets,
        );
      } else {
        const args = ["--port", activePortText, "--tail", String(source ? MAX_LOG_TAIL : tail)];
        if (structured) args.push("--json");
        // `--` so a service name that starts with "-" is never read as a Tilt flag.
        if (selectedServices.length > 0) args.push("--", ...selectedServices);

        const result = await runTilt("logs", args, { inheritStdio: false });
        if (result.exitCode !== 0) {
          const detail = result.stderr.trim();
          if (!detail || isTiltConnectionFailure(detail)) {
            fail("TILT_NOT_RUNNING", tiltUnreachableMessage(activePortText));
          }
          fail("TILT_LOGS_FAILED", `tilt logs failed: ${detail}`);
        }

        if (!structured) {
          process.stdout.write(redactSecrets(result.stdout, secrets));
          return;
        }
        const parsed = parseTiltLogLines(result.stdout, source ? MAX_LOG_TAIL : tail);
        windowLines = redactLogLines(
          (source ? filterLogSource(parsed, source) : parsed).slice(-tail),
          secrets,
        );
      }
      const page = applyLogCursor(windowLines, after);
      const redacted = page.lines;
      const lines = grep ? filterLogContent(redacted, grep, context) : redacted;
      if (!options.json) {
        const width = Math.max(0, ...lines.map((line) => line.resource?.length ?? 0));
        for (const line of lines) {
          console.log(
            redactSecrets(`${(line.resource ?? "").padEnd(width)} | ${line.text}`, secrets),
          );
        }
        return;
      }
      console.log(
        JSON.stringify(
          redactValue(
            createMachineEnvelope({
              services,
              tail,
              since: options.since ?? null,
              run: null,
              ...(source ? { source } : {}),
              lines,
              ...(unhealthy === undefined ? {} : { unhealthy }),
              nextCursor: page.nextCursor,
              truncated: page.truncated,
            }),
            secrets,
          ),
        ),
      );
    };

    await runCommand(action);
  });
