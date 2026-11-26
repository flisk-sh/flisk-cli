/** Minimum Flisk core release supporting buildContext required by flisk import (#634). */
export declare const MIN_CORE_VERSION = "1.3.104";
/**
 * Recommended core for imported stacks: 1.4.11 (#2646) runs a bring-your-own port outside 4000-5999 and two-letter
 * names, which flisk-import 0.3.0 and later write. The pin ships in the CLI itself, so a CLI that runs it is already newer.
 */
export declare const RECOMMENDED_CORE_VERSION = "1.4.11";
/** Compares two semver version strings. Returns true if current >= minimum. */
export declare function isVersionAtLeast(current: string, minimum: string): boolean;
/**
 * Checks whether the running Flisk CLI meets the minimum version required to adopt Compose repos.
 * If the installed core is older than the buildContext release (1.3.104), exit before writing
 * and print the upgrade command.
 */
export declare function checkCoreVersion(currentVersion?: string, args?: string[]): {
    ok: boolean;
    message?: string;
};
