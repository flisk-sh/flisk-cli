import type { DiscoveredResource, ProjectConfig } from "../../types/index.js";
/**
 * Stack names discovered from service.json files already in the repo (e.g. a
 * cloned starter template). Tilt's discovery groups app resources by this
 * same `stack` field, so a stack must appear here to ever be enabled by
 * `should_enable()` - without it, `flisk up` would launch infra only and no
 * app services would come up, however many the repo actually has.
 */
export declare function discoverExistingServiceStacks(projectRoot: string, resources?: DiscoveredResource[]): string[];
export declare function syncDiscoveredStacksToPreAlpha(projectConfig: ProjectConfig, discoveredStacks: string[]): string[];
/**
 * Adds stacks that have service.json files but aren't in any phase to
 * pre_alpha, so a resource scaffolded after `flisk project` is picked up by
 * `flisk up` without re-running `flisk project`. Returns the stacks it enabled.
 */
export declare function enableDiscoveredStacks(projectRoot: string, resources?: DiscoveredResource[]): string[];
/** The last non-empty line of a child process error, for a one-line failure message. */
export declare function lastLine(text: string): string;
/** Clones (or copies) a starter template and resolves to the absolute directory it landed in. */
export declare function cloneProjectTemplate(templateName: string, targetDir: string | undefined, runtimeNextSteps: string[], options?: {
    quiet?: boolean;
}): Promise<string>;
export declare const DEFAULT_PROJECT_JSON: ProjectConfig;
/**
 * Writes .flisk/project.json with the defaults `flisk project --yes` uses, and nothing else: no generated Tiltfile, Compose file,
 * .env or engine copy. `flisk up` uses it to adopt a directory of `command` services as a project, so `flisk down` and
 * `flisk doctor` find it afterwards.
 */
export declare function writeDefaultProjectConfig(projectRoot: string): void;
