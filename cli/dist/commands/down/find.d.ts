/** The stack names this project offers, for `tilt down` focus targets and artifact lookups; undefined when discovery fails. */
export declare function allStackNames(): string[] | undefined;
/** True when `flisk down` stops local processes instead of Tilt: a native run is on record, or every service declares `command`. */
export declare function isNativeRun(projectRoot: string): boolean;
/**
 * The project to stop: the one at `--project`, else the one around the current folder, else the only Flisk project with
 * a `tilt up` running. Exits with the project-root error when none is found, and lists them when several are running.
 */
export declare function resolveDownProject(options: {
    project?: string;
    json?: boolean;
    yes?: boolean;
    force?: boolean;
    dryRun?: boolean;
}): Promise<string>;
