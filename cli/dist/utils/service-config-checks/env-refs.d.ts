import type { DiscoveredResource } from "../../types/index.js";
/**
 * A `${VAR}` with no default in a service.json `env` value that the env file of the run and the shell both lack.
 * Names only: the value a set variable holds is never part of a report.
 */
export interface UnsetEnvReference {
    /** The service.json that references the variable, relative to the project root. */
    file: string;
    /** The service that needs the variable. */
    service: string;
    /** The env key whose value carries the reference. */
    envKey: string;
    /** The referenced variable that has no value. */
    variable: string;
}
/**
 * The `${VAR}` references with no default in each service.json `env` that the env file of the run and the shell
 * both lack (#3104). Compose interpolates a missing name to an empty value and only warns, and a `command`
 * service expands it the same way, so a service starts broken with the cause only in its log (Lychee's `APP_KEY
 * is not set`). `env` applies to `command` services and bring-your-own resources; the manifest warning already
 * calls it ignored anywhere else.
 */
export declare function unsetEnvReferences(projectRoot?: string, resources?: DiscoveredResource[], env?: NodeJS.ProcessEnv): UnsetEnvReference[];
/** One human-readable warning for `flisk config verify`. Names only, never a value. */
export declare function unsetEnvWarning(reference: UnsetEnvReference): string;
