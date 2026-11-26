// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BackendLanguageProvider } from "../backend-languages/types.js";
import { LOCAL_VITE_SCRIPTS, renderLocalViteConfig } from "../frontend-frameworks/local.js";
import { FRONTEND_FRAMEWORKS } from "../frontend-frameworks/registry.js";
import type {
  FrontendFrameworkFile,
  FrontendFrameworkProvider,
} from "../frontend-frameworks/types.js";
import type { DiscoveredResource, FileGenerationTask } from "../types/index.js";
import { FliskError } from "./errors.js";
import { findFreePort } from "./native-demo.js";
import { isNativeService } from "./native-service.js";
import { RESOURCE_FEATURES } from "./resource-features.js";
import { localPackageManager } from "./which.js";

export interface LocalScaffoldInput {
  resourceName: string;
  resourceType: string;
  port: number;
  tasks: FileGenerationTask[];
  frontendFramework?: FrontendFrameworkProvider;
  /** A language that owns its runtime (Python, Go, Rust, Node); undefined for the shared Bun scaffold. */
  backendLanguage?: BackendLanguageProvider;
  /** Where the frontend's backend answers, so the dev server can proxy to it. */
  backendUrl?: string;
  /** PATH probe for the package manager pick; defaults to this machine. */
  onPath?: (program: string) => boolean;
}

/**
 * The resource types `flisk resource --local` scaffolds: every type whose scaffold is a plain process the
 * native runtime can supervise. The containers (`bring-your-own` and every infrastructure preset behind it,
 * plus `database`) stay Docker and Tilt only.
 */
export const LOCAL_SCAFFOLD_TYPES = ["frontend", "backend", "worker", "mcp", "agent"] as const;

/** The types above as one readable list ("frontend, backend, worker, mcp and agent"), for errors and help text. */
export const LOCAL_SCAFFOLD_TYPE_LIST = `${LOCAL_SCAFFOLD_TYPES.slice(0, -1).join(", ")} and ${LOCAL_SCAFFOLD_TYPES.at(-1)}`;

/** True when `flisk resource --type <type> --local` produces a working host-process scaffold. */
export function isLocalScaffoldType(resourceType: string): boolean {
  return (LOCAL_SCAFFOLD_TYPES as readonly string[]).includes(resourceType);
}

/**
 * The scaffolds listen on every interface because a container needs that. On your own computer that would put the app
 * on the café wifi, so every generated listener is pointed at localhost: a literal 0.0.0.0, Bun's default (Hono's
 * `export default { port }`), and Go's `":" + port`. Flisk's own probes and the website's proxy all use localhost.
 */
export function bindToLocalhost(tasks: FileGenerationTask[]): void {
  for (const task of tasks) {
    if (task.type !== "text") continue;
    task.content = String(task.content)
      .replaceAll("0.0.0.0", "localhost")
      .replace(/export default \{(\s*)port,/, "export default {$1hostname: 'localhost',$1port,")
      .replace('http.ListenAndServe(":"+port', 'http.ListenAndServe("localhost:"+port')
      // The agent template explains its '0.0.0.0' bind for Traefik; keep the comment true after the rewrite.
      .replace(
        "// Bind beyond loopback: Traefik reaches the container over the Docker network.",
        "// A local process has no Traefik in front of it; loopback keeps the agent off the LAN.",
      );
  }
}

/** `flisk up` on your computer starts plain processes and no Tilt, so the starter pages must not link to its UI. */
export function dropTiltLinks(tasks: FileGenerationTask[]): void {
  for (const task of tasks) {
    if (task.type !== "text") continue;
    const content = String(task.content);
    if (!content.includes("localhost:10350")) continue;
    task.content = content
      .split("\n")
      .filter((line) => !line.includes("localhost:10350"))
      .join("\n");
  }
}

const taskNamed = (tasks: FileGenerationTask[], filename: string) =>
  tasks.find((task) => task.filename === filename);

/**
 * The host command follows the scaffold's own dev script when it names a package manager, so a Bun
 * template does not go through npm (#5403). Other scaffolds keep the machine's package manager (#3609).
 */
export function localDevCommand(
  devScript: string | undefined,
  onPath?: (program: string) => boolean,
): string {
  const runner = devScript?.trim().split(/\s+/)[0];
  if (runner === "bun" || runner === "pnpm" || runner === "yarn") {
    return `${runner} run dev`;
  }
  return `${localPackageManager(onPath)} run dev`;
}

/**
 * Turns a scaffold made for containers into one that runs on the host with no Docker and no Tilt.
 *
 * Only what is coupled to containers changes: the Dockerfile goes, `service.json` gets a `command` (so `flisk up` runs it as a
 * local process) instead of a build block, and a Vite frontend gets a plain config and scripts. The framework's source files,
 * dependencies and tests are the generator's own, untouched. Returns the command the service runs.
 *
 * A package.json service runs `<manager> run dev` with the manager named by its own dev script when
 * there is one (a Bun scaffold stays on Bun, #5403); otherwise it uses the first package manager on
 * the machine (npm, bun, pnpm, yarn), so a computer without npm still starts (#3609).
 */
export function applyLocalScaffold(input: LocalScaffoldInput): string {
  const { tasks, resourceType, frontendFramework, backendLanguage } = input;

  const dockerfile = tasks.findIndex((task) => task.filename === "Dockerfile");
  if (dockerfile >= 0) tasks.splice(dockerfile, 1);

  const serviceJson = taskNamed(tasks, "service.json")?.content as
    | Record<string, unknown>
    | undefined;
  const packageJson = taskNamed(tasks, "package.json")?.content as
    | { scripts?: Record<string, string> }
    | undefined;
  // Read the original script before the Vite branch rewrites it, so a Bun scaffold stays on Bun (#5403).
  const runCommand = localDevCommand(packageJson?.scripts?.dev, input.onPath);
  if (!serviceJson) {
    throw new FliskError("The scaffold has no service.json to run locally.", [
      "Scaffold it without --local, or report this as a bug.",
    ]);
  }

  let command: string;
  if (resourceType === "frontend" && frontendFramework) {
    if (frontendFramework.kind === "server") {
      // A server framework (Next.js) owns its dev server; its own `dev` script already runs on the host. The route
      // prefix it was scaffolded for (/<name>/health) only exists behind Flisk's gateway, so the host probes the root.
      command = runCommand;
      serviceJson.healthCheckPath = "/";
    } else {
      if (!frontendFramework.vite) {
        throw new FliskError(`The ${frontendFramework.id} frontend cannot run on the host yet.`, [
          "Scaffold it without --local to use the Docker and Tilt route.",
        ]);
      }
      if (packageJson?.scripts) {
        delete packageJson.scripts.predev;
        delete packageJson.scripts.prebuild;
        Object.assign(packageJson.scripts, LOCAL_VITE_SCRIPTS);
      }
      tasks.push({
        type: "text",
        filename: "vite.config.ts",
        content: renderLocalViteConfig(frontendFramework, {
          port: input.port,
          proxyTarget: input.backendUrl,
        }),
        description: "Generating vite.config.ts for the host",
        emoji: "⚙️",
      });
      command = runCommand;
    }
  } else if (backendLanguage?.devCommand && !taskNamed(tasks, "package.json")) {
    command = backendLanguage.devCommand;
  } else {
    command = runCommand;
  }

  if (resourceType === "frontend") dropTiltLinks(tasks);
  if (resourceType === "backend" || resourceType === "mcp" || resourceType === "agent") {
    // Each of these scaffolds an HTTP server that binds every interface for its container.
    bindToLocalhost(tasks);
    command = command.replaceAll("0.0.0.0", "localhost");
  } else if (frontendFramework?.kind === "server" && packageJson?.scripts?.dev === "next dev") {
    // Next.js listens on every interface by default.
    packageJson.scripts.dev = "next dev -H localhost";
  }
  // An agent with files durability keeps its session checkpoints under its own folder on the host
  // (AGENT_STATE_DIR defaults to ./.agent-state); they are run state and must never be committed.
  const agent = serviceJson.agent as { durability?: string } | undefined;
  if (resourceType === "agent" && agent?.durability !== "postgres") {
    tasks.push({
      type: "text",
      filename: ".gitignore",
      content: ".agent-state/\n",
      description: "Ignoring the local checkpoint store",
      emoji: "🙈",
    });
  }

  // A build block points at the Dockerfile that is no longer written, and `dev` is what Tilt reloads with.
  // featuresEnabled is the same kind of claim: it lists what the engine will generate, which nothing does here.
  delete serviceJson.build;
  delete serviceJson.dev;
  serviceJson.featuresEnabled = hostGeneratedFeatures(serviceJson.featuresEnabled);
  serviceJson.command = command;
  // A worker serves no route, so a port would only have `flisk up` wait on a listener that never comes.
  // With no port and no health path, its readiness is the process staying alive.
  if (resourceType === "worker") {
    delete serviceJson.port;
  } else {
    serviceJson.port = input.port;
  }
  return command;
}

/**
 * The `featuresEnabled` entries that still make sense on the host. Every catalogued feature is an engine
 * generator (its `generator_file` is an `engine/*.star` file that only `flisk up` on Docker and Tilt runs), so a
 * `command` service listing one claims output nothing produces. A name the CLI scaffolded itself, such as
 * `drizzle`, produced real files here and stays.
 */
export function hostGeneratedFeatures(featuresEnabled: unknown): string[] {
  if (!Array.isArray(featuresEnabled)) return [];
  return featuresEnabled.filter((feature) => !(feature in RESOURCE_FEATURES));
}

/**
 * The host-run (`command`) frontends of one stack that name no backend yet. A frontend scaffolded with
 * `--local` runs as a local process; a container one keeps `build`/`dev` and is wired by the engine instead.
 */
export function unwiredLocalFrontends(
  resources: readonly DiscoveredResource[],
  stackName: string,
): DiscoveredResource[] {
  return resources.filter(
    (resource) =>
      resource.stack === stackName &&
      resource.type === "frontend" &&
      isNativeService(resource) &&
      resource.config?.backendName === undefined,
  );
}

/** The marker the `--local` Vite config carries, so a hand-replaced config is never overwritten. */
const LOCAL_VITE_CONFIG_MARKER = "flisk resource --local";

export interface LocalFrontendWiring {
  /** Files to write into the frontend's folder. */
  tasks: FileGenerationTask[];
  /** Files left alone because their contents no longer match the scaffold, named for the note to the user. */
  skipped: string[];
}

/**
 * What a `--local` frontend scaffolded before its API missed at creation: the manifest edge the
 * backend-first order writes (backendName, dependsOn), the dev-server proxy the starter page calls through,
 * and that starter page itself. A file whose contents no longer match what `flisk resource` wrote is the
 * user's own edit and is left alone, named in `skipped` so the run can say so.
 */
export function localFrontendWiring(
  frontend: { name: string; path: string; config: Record<string, unknown> },
  backendName: string,
  backendUrl: string,
): LocalFrontendWiring {
  const skipped: string[] = [];
  const dependsOn = Array.isArray(frontend.config.dependsOn) ? frontend.config.dependsOn : [];
  const tasks: FileGenerationTask[] = [
    {
      type: "json",
      filename: "service.json",
      content: {
        ...frontend.config,
        backendName,
        dependsOn: dependsOn.includes(backendName) ? dependsOn : [...dependsOn, backendName],
        featuresEnabled: hostGeneratedFeatures(frontend.config.featuresEnabled),
      },
      description: `Wiring service.json to ${backendName}`,
      emoji: "🔗",
    },
  ];

  const provider =
    typeof frontend.config.framework === "string"
      ? FRONTEND_FRAMEWORKS[frontend.config.framework]
      : undefined;
  // The proxy is a Vite-only piece: a `server` framework (Next.js) owns its dev server and answers /health itself.
  if (!provider?.vite || provider.kind === "server") return { tasks, skipped };

  const viteConfigPath = join(frontend.path, "vite.config.ts");
  const viteConfig = existsSync(viteConfigPath) ? readFileSync(viteConfigPath, "utf8") : undefined;
  if (viteConfig !== undefined && !viteConfig.includes(LOCAL_VITE_CONFIG_MARKER)) {
    // A hand-written config may not proxy /health at all, so the starter upgrade it would get is skipped too.
    skipped.push(
      "vite.config.ts (no longer the generated one; add the proxy and starter page by hand)",
    );
    return { tasks, skipped };
  }
  tasks.push({
    type: "text",
    filename: "vite.config.ts",
    content: renderLocalViteConfig(provider, {
      port: typeof frontend.config.port === "number" ? frontend.config.port : 3000,
      proxyTarget: backendUrl,
    }),
    description: `Pointing the dev proxy at ${backendName}`,
    emoji: "🔀",
  });

  // A starter that knows how to call a backend (React, Vue) differs only in the files its provider swaps for
  // backendName. The --local scaffold drops the Tilt links from whatever it writes, so both the comparison and
  // the upgrade go through the same drop: a file still byte-identical to what was written can be upgraded,
  // anything else is the user's own edit and stays.
  const localStarters = (files: FrontendFrameworkFile[]): FileGenerationTask[] => {
    const tasks: FileGenerationTask[] = files.map((file) => ({ ...file, type: "text" }));
    dropTiltLinks(tasks);
    return tasks;
  };
  const scaffolded = new Map(
    localStarters(provider.createFiles(frontend.name)).map((file) => [
      file.filename,
      String(file.content),
    ]),
  );
  for (const file of localStarters(provider.createFiles(frontend.name, { backendName }))) {
    const plain = scaffolded.get(file.filename);
    if (plain === file.content) continue;
    const filePath = join(frontend.path, file.filename);
    const onDisk = existsSync(filePath) ? readFileSync(filePath, "utf8") : undefined;
    if (onDisk === file.content) continue;
    if (onDisk !== undefined && onDisk !== plain) {
      skipped.push(`${file.filename} (edited since the scaffold)`);
      continue;
    }
    tasks.push({
      type: "text",
      filename: file.filename,
      content: file.content,
      description: `Updating ${file.filename} to call ${backendName}`,
      emoji: "📄",
    });
  }

  return { tasks, skipped };
}

/**
 * The port a `--local` resource gets. An explicit --port is kept as given; otherwise the assigned port, or the next one
 * that no other resource in the project uses and that nothing on this computer is listening on right now.
 */
export async function localResourcePort(
  assignedPort: number,
  explicit: boolean,
  taken: readonly number[],
  isListening: (port: number) => Promise<boolean>,
): Promise<number> {
  if (explicit) return assignedPort;
  return findFreePort(assignedPort, isListening, taken);
}
