import type { BackendLanguageProvider } from "../backend-languages/types.js";
import type { FrontendFrameworkProvider } from "../frontend-frameworks/types.js";
import type { DiscoveredResource, FileGenerationTask } from "../types/index.js";
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
export declare const LOCAL_SCAFFOLD_TYPES: readonly ["frontend", "backend", "worker", "mcp", "agent"];
/** The types above as one readable list ("frontend, backend, worker, mcp and agent"), for errors and help text. */
export declare const LOCAL_SCAFFOLD_TYPE_LIST: string;
/** True when `flisk resource --type <type> --local` produces a working host-process scaffold. */
export declare function isLocalScaffoldType(resourceType: string): boolean;
/**
 * The scaffolds listen on every interface because a container needs that. On your own computer that would put the app
 * on the café wifi, so every generated listener is pointed at localhost: a literal 0.0.0.0, Bun's default (Hono's
 * `export default { port }`), and Go's `":" + port`. Flisk's own probes and the website's proxy all use localhost.
 */
export declare function bindToLocalhost(tasks: FileGenerationTask[]): void;
/** `flisk up` on your computer starts plain processes and no Tilt, so the starter pages must not link to its UI. */
export declare function dropTiltLinks(tasks: FileGenerationTask[]): void;
/**
 * The host command follows the scaffold's own dev script when it names a package manager, so a Bun
 * template does not go through npm (#5403). Other scaffolds keep the machine's package manager (#3609).
 */
export declare function localDevCommand(devScript: string | undefined, onPath?: (program: string) => boolean): string;
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
export declare function applyLocalScaffold(input: LocalScaffoldInput): string;
/**
 * The `featuresEnabled` entries that still make sense on the host. Every catalogued feature is an engine
 * generator (its `generator_file` is an `engine/*.star` file that only `flisk up` on Docker and Tilt runs), so a
 * `command` service listing one claims output nothing produces. A name the CLI scaffolded itself, such as
 * `drizzle`, produced real files here and stays.
 */
export declare function hostGeneratedFeatures(featuresEnabled: unknown): string[];
/**
 * The host-run (`command`) frontends of one stack that name no backend yet. A frontend scaffolded with
 * `--local` runs as a local process; a container one keeps `build`/`dev` and is wired by the engine instead.
 */
export declare function unwiredLocalFrontends(resources: readonly DiscoveredResource[], stackName: string): DiscoveredResource[];
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
export declare function localFrontendWiring(frontend: {
    name: string;
    path: string;
    config: Record<string, unknown>;
}, backendName: string, backendUrl: string): LocalFrontendWiring;
/**
 * The port a `--local` resource gets. An explicit --port is kept as given; otherwise the assigned port, or the next one
 * that no other resource in the project uses and that nothing on this computer is listening on right now.
 */
export declare function localResourcePort(assignedPort: number, explicit: boolean, taken: readonly number[], isListening: (port: number) => Promise<boolean>): Promise<number>;
