import { JsonCommandError } from "../../utils/json-command.js";
/** The command the FliskOS package installs. */
export declare const FLISKOS_COMMAND = "fliskos";
/** The npm package that installs it (not published yet). */
export declare const FLISKOS_PACKAGE = "@flisk-sh/fliskos";
/** The repository FliskOS is built from. */
export declare const FLISKOS_REPOSITORY = "https://github.com/flisk-sh/fliskos";
/** The name of the macOS app, which is what `open -a` takes. */
export declare const FLISKOS_APP = "FliskOS";
/** What `flisk os` needs to know about the machine, so a test can describe one without having it. */
export interface FliskOsHost {
    platform: NodeJS.Platform;
    home: string;
    findCommand: (name: string) => string | null;
    exists: (path: string) => boolean;
}
/** The options of `flisk os` as Commander hands them over. */
export interface OsOptions {
    project?: string;
    /** Kept as typed, so a bad value is reported with the text the user wrote. */
    port?: string;
    /** False when `--no-open` was given. */
    open?: boolean;
    scanRoot?: string[];
    json?: boolean;
}
/** Where FliskOS was found: the `fliskos` executable, or the macOS app bundle. */
export interface FliskOsLocation {
    via: "command" | "app";
    path: string;
}
/** What `flisk os --json` reports. */
export interface OsReport {
    /** How FliskOS was started. */
    via: "command" | "app";
    /** The `fliskos` executable, or the app bundle. */
    path: string;
    /** The arguments it was started with (`open`'s, for the app). */
    args: string[];
    /** The Flisk project FliskOS was pointed at, or null when none was passed. */
    project: string | null;
    /**
     * Where FliskOS listens, once the command reported it, exactly as printed. The URL carries FliskOS's access token in
     * its query string, so it is a credential: keep it out of logs. Null for the app, which opens its own window.
     */
    url: string | null;
    /** The options that were given but the app cannot take. Empty for the command. */
    ignored: string[];
}
export declare function defaultHost(): FliskOsHost;
/** The places `install:mac` puts the app: the system folder when it was writable, else the user's. */
export declare function appBundles(host: Pick<FliskOsHost, "home">): string[];
/**
 * Finds FliskOS: the `fliskos` command wins, because it takes the project and the other options; the macOS app is the
 * fallback. Returns null when neither is there.
 */
export declare function locateFliskOs(host?: FliskOsHost): FliskOsLocation | null;
/** The error for a machine with neither the command nor the app. Nothing is installed on the user's behalf. */
export declare function notInstalledError(platform?: NodeJS.Platform): JsonCommandError;
/** Reads `--port` the way `fliskos` does: an integer from 0 (a free port) to 65535. */
export declare function parsePort(value: string): number;
/**
 * The project to open: the one at `--project` (an error when it is not a Flisk project), else the one around the
 * current folder, else none, and FliskOS finds the projects itself.
 */
export declare function resolveOsProject(explicit: string | undefined, cwd: string): string | null;
/** The arguments `fliskos` takes, in the order they are documented. */
export declare function fliskOsArgs(input: {
    project: string | null;
    port?: number;
    open?: boolean;
    scanRoots?: string[];
}): string[];
