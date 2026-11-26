/**
 * `flisk os`: starts FliskOS, the local desktop app for Flisk projects, coding agents and Flisk apps.
 *
 * FliskOS lives in its own repository and ships on its own, so this command only finds it and starts it: the
 * `fliskos` command when it is on PATH, otherwise FliskOS.app on macOS. It never installs anything; when neither
 * exists it says how to install it. `flisk ui` is the separate terminal dashboard and is not touched.
 *
 * The launch surface (what FliskOS is started with) lives in `os/surface.ts` as pure data builders and the process
 * launch (starting it and reporting it) in `os/launch.ts`; this file keeps the command tree and re-exports both.
 */
import { Command } from "commander";
export type { OsDeps, OsLaunch } from "./os/launch.js";
export { FLISKOS_COMMAND_REQUIRED_CODE, launchFliskOs, READY_TIMEOUT_MS, runOs, } from "./os/launch.js";
export type { FliskOsHost, FliskOsLocation, OsOptions, OsReport } from "./os/surface.js";
export { appBundles, defaultHost, FLISKOS_APP, FLISKOS_COMMAND, FLISKOS_PACKAGE, FLISKOS_REPOSITORY, fliskOsArgs, locateFliskOs, notInstalledError, parsePort, resolveOsProject, } from "./os/surface.js";
export declare const osCommand: Command;
