import { type NpxInvocation, type PackageRunnerRuntime } from "../../utils/npx-invocation.js";
/**
 * The importer lives in its own repo so it can ship without a CLI release, and is run from npm at a
 * pinned version so a push to its main branch cannot change what `flisk import` does. Move the pin
 * when a new importer is published. `FLISK_IMPORT_PACKAGE` overrides the package spec.
 */
export declare const IMPORT_PACKAGE = "flisk-import@0.18.3";
/** The flisk-import subcommand that registers a Tiltfile (flisk-import 0.4.1 or later), forwarded as its first argument. */
export declare const TILTFILE_IMPORTER = "tiltfile";
export declare function importInvocation(args: string[], env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform, runtime?: Omit<PackageRunnerRuntime, "platform">): NpxInvocation & {
    pkg: string;
};
export declare function buildForwardedImportArgs(args: string[], options?: {
    yes?: boolean;
    force?: boolean;
    dryRun?: boolean;
}): string[];
