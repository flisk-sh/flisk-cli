// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { execFileSync, spawn } from "node:child_process";
import chalk from "chalk";
import { Command } from "commander";
import { readProjectConfig } from "../generator/template-engine.js";
import type { ResourceStatus, ServiceUrl } from "../types/index.js";
import { attachNoPositionalHint } from "../utils/command-helpers.js";
import { getCheckoutDomain, getStackEmoji } from "../utils/constants.js";
import { createDiscoveryContext } from "../utils/discovery-context.js";
import { errorFactories, logVerbose, requireProjectRoot } from "../utils/errors.js";
import {
  colorizeByStatus,
  DEFAULT_BOX_WIDTH,
  formatBoxLine,
  formatPadded,
  getStatusIcon,
  printBoxedHeader,
} from "../utils/formatting.js";
import { readSavedHostPortPlan } from "../utils/host-port-config.js";
import { createHostPortPlan } from "../utils/host-port-plan.js";
import { createMachineEnvelope, writeMachineError } from "../utils/machine-output.js";
import { nativeServiceStates } from "../utils/native-runtime.js";
import { isNativeProject } from "../utils/native-service.js";
import { findProjectRoot } from "../utils/paths.js";
import { checkPortStatus } from "../utils/port-assignment.js";
import { DEFAULT_PROJECT_NAME, readProjectNameOrUndefined } from "../utils/project-reader.js";
import { addProjectOption } from "../utils/project-resolution.js";
import { relativeResourceFolder } from "../utils/resource-relative-path.js";
import {
  isRoutableService,
  isWebUiBringYourOwn,
  resolveServicePath,
  resolveServiceUrl,
  withTrailingSlash,
} from "../utils/service-urls.js";
import { stackExists } from "../utils/services.js";
import { buildServicePorts } from "../utils/status-ports.js";
import { isValidPort, sanitizeForShell } from "../utils/validation.js";
import { findOnPath } from "../utils/which.js";

export { withTrailingSlash };

function execSafe(
  command: string,
  args: string[],
  options: { encoding?: string; timeout?: number } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(findOnPath(command) ?? command, args, {
      timeout: options.timeout || 5000,
      shell: false,
      windowsHide: process.platform === "win32",
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code: number | null) => {
      if (code !== 0) {
        reject(new Error(`Command failed with exit code ${code}: ${stderr}`));
      } else {
        resolve(stdout);
      }
    });

    child.on("error", (err: Error) => {
      reject(err);
    });
  });
}

const HTTP_CHECK_TIMEOUT_MS = 2_000;

type HttpCheckResult = "running" | "stopped" | "unavailable";

/** One warning a status check produced. `kind` tells the summaries below which check failed. */
export interface ServiceStatusWarning {
  kind: "http" | "port" | "docker";
  /** The warning text without the leading ⚠️, so it can also ride in the `--json` warnings array. */
  message: string;
}

/** Prints a status warning to stderr; the default when the caller does not collect warnings. */
function reportStatusWarning({ message }: ServiceStatusWarning): void {
  console.warn(chalk.yellow(`⚠️ ${message}`));
}

/** Probe a service URL in-process so the status check needs neither curl nor a POSIX null device. */
async function checkHttpStatus(
  url: string,
  report: (warning: ServiceStatusWarning) => void = reportStatusWarning,
): Promise<HttpCheckResult> {
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(HTTP_CHECK_TIMEOUT_MS),
    });
    await response.body?.cancel();

    // 401 and 403 mean the service answered and asked for credentials.
    const { status } = response;
    if ((status >= 200 && status < 400) || status === 401 || status === 403) {
      return "running";
    }
    return "stopped";
  } catch (err: unknown) {
    report({ kind: "http", message: `Could not reach ${url} (HTTP check failed)` });
    logVerbose(`HTTP check error details for ${url}`, err);
    return "unavailable";
  }
}

export function determineDefaultDomain(
  dockerUp = true,
  report: (message: string) => void = (message) => console.warn(chalk.yellow(`⚠️ ${message}`)),
  projectRoot: string | null = findProjectRoot(),
): string {
  if (projectRoot) {
    const checkoutDomain = getCheckoutDomain(projectRoot);
    if (checkoutDomain) return checkoutDomain;
    const projectName = readProjectNameOrUndefined(projectRoot);
    if (projectName && projectName !== DEFAULT_PROJECT_NAME) {
      return `${projectName}.localhost`;
    }
  }

  const domains = new Set<string>();
  if (dockerUp) {
    try {
      const traefikLabels = execFileSync(
        findOnPath("docker") ?? "docker",
        ["ps", "--filter", "label=traefik.enable=true", "--format", "{{.Labels}}"],
        { encoding: "utf-8", windowsHide: process.platform === "win32" },
      );

      // Capture every Host(`...`) in a rule (multi-host rules included), avoid ReDoS with bounded classes
      const domainRegex = /Host\(`([a-zA-Z0-9_.-]{1,100})`\)/g;
      for (
        let match = domainRegex.exec(traefikLabels);
        match !== null;
        match = domainRegex.exec(traefikLabels)
      ) {
        if (match[1]) domains.add(match[1]);
      }
    } catch (err: unknown) {
      report("Could not scan Traefik domains (Docker unavailable)");
      logVerbose("Docker scan error details", err);
    }
  }

  // Filter out service-specific domains (ones that look like individual services)
  // Service domains typically contain the full service name like "myapp-api-frontend.localhost"
  const domainList = Array.from(domains);
  const projectDomains = domainList.filter((domain) => {
    if (/^(app|api)\.[\w-]+\.localhost$/.test(domain)) return true;
    // Skip domains that look like specific service instances
    // These are long, hyphen-heavy domains for individual services
    const servicePatterns = [
      /\w+-\w+-frontend\.localhost$/,
      /\w+-\w+-backend\.localhost$/,
      /\w+-\w+-worker\.localhost$/,
      /\w+-\w+-migrator\.localhost$/,
    ];
    return !servicePatterns.some((pattern) => pattern.test(domain));
  });

  // `<label>.<project>.localhost` hosts other than app./api. (the dashboard's, a web UI's) carry a service label in front of the
  // project domain, which would be doubled when a service name is prefixed to it. Drop them when an app./api. host names the project.
  const isGatewayHost = (domain: string): boolean => /^(app|api)\.[\w-]+\.localhost$/.test(domain);
  if (projectDomains.some(isGatewayHost)) {
    for (let i = projectDomains.length - 1; i >= 0; i--) {
      const domain = projectDomains[i] as string;
      if (!isGatewayHost(domain) && domain.split(".").length > 2) projectDomains.splice(i, 1);
    }
  }

  // Prefer project-level domains (shorter, simpler ones)
  if (projectDomains.length > 0) {
    // Sort by length - shortest is likely the project domain
    projectDomains.sort((a, b) => a.length - b.length);
    const firstProjectDomain = projectDomains[0];
    if (firstProjectDomain) return firstProjectDomain;
  }

  // If only service-specific domains found, extract base from first one
  // e.g., "myapp-api-frontend.localhost" -> try to find "myapp.localhost"
  if (domainList.length > 0) {
    const firstDomain = domainList[0];
    if (firstDomain) {
      const localhostMatch = firstDomain.match(/([\w-]+)\.localhost$/);
      if (localhostMatch) {
        // If it looks like a service domain, try common project names
        const commonProjects = ["flisk", "project", "app", "api", "myapp"];
        for (const project of commonProjects) {
          const testDomain = `${project}.localhost`;
          if (domainList.includes(testDomain)) {
            return testDomain;
          }
        }
      }
    }
  }

  return "localhost";
}

export async function checkServiceStatus(
  serviceName: string,
  port?: number,
  url?: string,
  report: (warning: ServiceStatusWarning) => void = reportStatusWarning,
): Promise<"running" | "stopped" | "unknown"> {
  if (url) {
    let validUrl: URL;
    try {
      validUrl = new URL(url);
    } catch (err: unknown) {
      report({ kind: "http", message: `Could not reach ${url} (HTTP check failed)` });
      logVerbose(`HTTP check error details for ${url}`, err);
      return "stopped";
    }
    if (validUrl.protocol !== "http:" && validUrl.protocol !== "https:") {
      return "stopped";
    }

    const httpStatus = await checkHttpStatus(validUrl.toString(), report);
    // When the probe could not run, fall through to the port and Docker checks below.
    if (httpStatus !== "unavailable") return httpStatus;
  }

  if (port && isValidPort(port)) {
    const portStatus = await checkPortStatus(port);
    if (portStatus === "running") {
      return "running";
    }
    if (portStatus === "unknown") {
      report({
        kind: "port",
        message:
          process.platform === "win32"
            ? `Could not check port ${port} with the Windows TCP probe`
            : `Could not check port ${port} (port probe unavailable)`,
      });
    }
  }

  try {
    const containerName = sanitizeForShell(serviceName);
    const result = await execSafe(
      "docker",
      ["ps", "--filter", `name=${containerName}`, "--format", "{{.Names}}"],
      { timeout: 5000 },
    );

    if (result && result.trim().length > 0) {
      return "running";
    }
  } catch (err: unknown) {
    report({ kind: "docker", message: `Could not check Docker for ${serviceName}` });
    logVerbose(`Docker check error details for ${serviceName}`, err);
  }

  return "stopped";
}

/**
 * Whether the Docker daemon answers `docker ps`, probed once per `networks` run. When it cannot, every per-service Docker
 * lookup below would fail the same way, so the run skips them behind a single warning.
 */
export async function isDockerReachable(): Promise<boolean> {
  try {
    await execSafe("docker", ["ps"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/** The one line a dead Docker produces, in place of one warning per service per check. */
const DOCKER_DOWN_WARNING = "Docker is not running, so every service is shown as stopped";

/**
 * The reachability word a local process's run state maps to: `ready` is the only state whose address answers. A pending
 * process (starting, restarting or waiting on a dependency) reports `unknown` rather than `stopped`, since it is not
 * confirmed down; `error` (the supervisor gave up) and `unknown` (no live run on record) are states where nothing listens.
 */
function nativeReachability(status: ResourceStatus | undefined): ServiceUrl["status"] {
  if (status === "ready") return "running";
  if (status === "pending") return "unknown";
  return "stopped";
}

/**
 * Collapse the per-service warnings: when every service's HTTP check failed, N identical "Could not reach" lines become
 * one "N URLs not reachable". Warnings from other checks stay one per line.
 */
function summarizeStatusWarnings(
  statusWarnings: readonly ServiceStatusWarning[],
  serviceCount: number,
): string[] {
  const httpFailures = statusWarnings.filter((warning) => warning.kind === "http");
  const others = statusWarnings
    .filter((warning) => warning.kind !== "http")
    .map((warning) => warning.message);
  if (serviceCount > 0 && httpFailures.length === serviceCount) {
    return [`${httpFailures.length} URLs not reachable`, ...others];
  }
  return statusWarnings.map((warning) => warning.message);
}

export const networksCommand = addProjectOption(
  attachNoPositionalHint(new Command("networks")),
  "networks",
)
  .description(
    "Show service URLs: Traefik routes, or localhost addresses in a local-process project",
  )
  .alias("urls")
  .alias("traefik")
  .option("-s, --stack <stack>", "Filter by stack name")
  .option("--json", "Output a versioned JSON response")
  .option("--json-legacy", "Output the legacy JSON array (deprecated)")
  .option("--raw", "Output raw URLs only")
  .addHelpText(
    "after",
    "\nExamples:\n  flisk networks\n  flisk networks --stack shop\n  flisk networks --raw\n  flisk networks --json",
  )
  .action(async (options) => {
    const action = async (): Promise<void> => {
      const projectRoot =
        options.json || options.jsonLegacy ? findProjectRoot() : requireProjectRoot();
      if (!projectRoot) {
        throw errorFactories.notInProject();
      }
      const discovery = createDiscoveryContext();
      if (options.stack && !stackExists(options.stack, discovery.resources)) {
        const error = errorFactories.stackNotFound(options.stack, discovery.stackNames);
        if (options.json || options.jsonLegacy) throw error;
        error.exit();
      }
      const services = discovery.resources;
      // A project of `command` services runs as local processes: no Traefik runs, so each service answers on localhost
      // at its own port, and its state comes from the run on record, the same source `flisk status` reads.
      const nativeStates = isNativeProject(services)
        ? nativeServiceStates(
            projectRoot,
            services.map((s) => s.name),
          )
        : null;

      // A native run has no ingress port to plan and no Traefik labels to scan, so both probes are skipped.
      const hostPortPlan = nativeStates
        ? null
        : (readSavedHostPortPlan(projectRoot) ?? (await createHostPortPlan()));
      const httpPort = hostPortPlan?.ingressHttp;

      const routableServices = services.filter(isRoutableService);
      // Probe Docker once per run: a dead daemon makes every per-service lookup fail the same way, so the run emits one
      // warning and shows every service as stopped instead of repeating a warning per service per check.
      const dockerUp =
        nativeStates !== null || routableServices.length === 0 ? true : await isDockerReachable();
      const warnings: string[] = [];
      const collectWarning = (message: string): void => {
        warnings.push(message);
      };

      // FLISK_SERVICE_BASE_URL sets the scheme, host and port `flisk up` prints; follow it so both commands agree.
      // FLISK_PUBLIC_HOST is the same kind of override (see getBaseDomain), so either one leaves the host to resolveServiceUrl.
      const baseDomain =
        nativeStates !== null || process.env.FLISK_SERVICE_BASE_URL || process.env.FLISK_PUBLIC_HOST
          ? undefined
          : determineDefaultDomain(dockerUp, collectWarning, projectRoot);
      const warningBuckets = routableServices.map((): ServiceStatusWarning[] => []);
      const servicesWithUrls: ServiceUrl[] = nativeStates
        ? services.flatMap((s) => {
            const { directUrl, containerPort } = buildServicePorts(s, undefined, {
              native: true,
            });
            // A local process with no port has no address at all, so it is not listed, the way an unrouted worker is not.
            if (directUrl === null) return [];
            return [
              {
                name: s.name,
                stack: s.stack,
                path: relativeResourceFolder(projectRoot, s.configPath),
                basePath: "/",
                url: directUrl,
                port: containerPort ?? undefined,
                status: nativeReachability(nativeStates[s.name]?.status),
              },
            ];
          })
        : await Promise.all(
            routableServices.map(async (s, index) => {
              const url = resolveServiceUrl(s, httpPort, baseDomain) ?? "";
              const resolvedPath = resolveServicePath(s);
              const basePath = resolvedPath.startsWith("/") ? resolvedPath : `/${resolvedPath}`;
              const port = s.config?.port;
              const status = dockerUp
                ? await checkServiceStatus(s.name, port, url, (warning) =>
                    warningBuckets[index]?.push(warning),
                  )
                : "stopped";

              return {
                name: s.name,
                stack: s.stack,
                path: relativeResourceFolder(projectRoot, s.configPath),
                basePath,
                url,
                // A web UI is routed by Host header, so an IP URL would never reach its router.
                ...(process.platform === "win32" && !isWebUiBringYourOwn(s)
                  ? {
                      loopbackUrl: `http://127.0.0.1:${httpPort}${basePath}`.replace(/\/$/, ""),
                    }
                  : {}),
                port,
                status,
              };
            }),
          );

      const filteredServices = options.stack
        ? servicesWithUrls.filter((s) => s.stack === options.stack)
        : servicesWithUrls;

      // A native run probes nothing, so it collects no warnings.
      if (nativeStates === null) {
        if (dockerUp) {
          warnings.push(...summarizeStatusWarnings(warningBuckets.flat(), routableServices.length));
        } else {
          warnings.push(DOCKER_DOWN_WARNING);
        }
      }

      if (options.json) {
        // The envelope carries the warnings so an agent reading only stdout sees them; stderr stays clean.
        console.log(
          JSON.stringify(
            createMachineEnvelope({
              services: filteredServices,
              ...(warnings.length > 0 ? { warnings } : {}),
            }),
          ),
        );
        return;
      }

      // In every non-envelope mode the warnings go to stderr before the table, as they did before they were collected.
      for (const message of warnings) {
        console.warn(chalk.yellow(`⚠️ ${message}`));
      }

      if (options.jsonLegacy) {
        // The deprecated legacy array keeps its old indented form and has no field to carry the warnings.
        console.log(JSON.stringify(filteredServices, null, 2));
        return;
      }

      if (filteredServices.length === 0) {
        if (options.stack) {
          console.log(chalk.yellow(`⚠️ No routable services found in stack "${options.stack}"`));
        } else {
          console.log(chalk.yellow("⚠️ No routable services found"));
        }
        process.exit(0);
      }

      if (options.raw) {
        for (const service of filteredServices) {
          console.log(service.url);
          if (service.loopbackUrl) console.log(service.loopbackUrl);
        }
        process.exit(0);
      }
      printBoxedHeader(
        nativeStates ? "🌐  SERVICE ADDRESSES" : "🌐  TRAEFIK NETWORKS",
        nativeStates
          ? "Local processes (no Docker, no Tilt)"
          : baseDomain
            ? `Domain: http://${baseDomain}:${httpPort}`
            : `Base URL: ${process.env.FLISK_SERVICE_BASE_URL}`,
        DEFAULT_BOX_WIDTH,
      );

      // Group services by stack using discovery context's stack names for consistent ordering
      const stacks = new Map<string, ServiceUrl[]>();
      for (const stackName of discovery.stackNames) {
        const stackServices = filteredServices.filter((s) => s.stack === stackName);
        if (stackServices.length > 0) {
          stacks.set(stackName, stackServices);
        }
      }
      // Add unstacked services to 'default' group
      const unstackedServices = filteredServices.filter((s) => !s.stack);
      if (unstackedServices.length > 0) {
        stacks.set("default", unstackedServices);
      }

      let isFirstStack = true;
      for (const [stackName, stackServices] of stacks) {
        if (!isFirstStack) {
          console.log();
        }
        isFirstStack = false;

        const emoji = getStackEmoji(stackName);
        const stackTitle = `${emoji}  ${stackName.toUpperCase()} STACK`;

        console.log();
        console.log(chalk.bold.white(stackTitle));
        console.log(chalk.gray(formatBoxLine("━", DEFAULT_BOX_WIDTH - 4)));

        for (const service of stackServices) {
          const statusSymbol = getStatusIcon(service.status);
          const statusEmoji = colorizeByStatus(statusSymbol, service.status);

          const namePart = formatPadded(service.name, 22);
          const urlPart =
            service.status === "running"
              ? chalk.cyan.underline(service.url)
              : chalk.gray(service.url); // Gray out URL if stopped

          const statusLabel =
            service.status !== "running" ? chalk.gray(` [${service.status}]`) : "";

          console.log(`  ${statusEmoji} ${chalk.white(namePart)}  ${urlPart}${statusLabel}`);
          if (service.loopbackUrl) {
            console.log(
              `     ${chalk.gray(`Loopback: ${service.loopbackUrl} (Host: ${new URL(service.url).hostname})`)}`,
            );
          }
        }
      }
      console.log();
      console.log(chalk.gray(formatBoxLine("─", DEFAULT_BOX_WIDTH - 2)));
      console.log(chalk.gray("🖱️  Click any URL above to open in browser"));
      console.log(
        chalk.gray("📊 Status: ") +
          chalk.green("✓ Running") +
          " | " +
          chalk.red("✗ Stopped") +
          " | " +
          chalk.gray("? Unknown"),
      );

      if (baseDomain === "localhost") {
        console.log();
        const projectConfig = readProjectConfig(projectRoot);
        const projectName = projectConfig.project.name;
        console.log(chalk.yellow("💡 Tip: Set custom domain with:"));
        console.log(chalk.cyan(`   export FLISK_PUBLIC_HOST=${projectName}.localhost`));
      }

      console.log();
    };

    if (options.json || options.jsonLegacy) {
      try {
        await action();
      } catch (error) {
        writeMachineError(error);
      }
      return;
    }
    await action();
  });
