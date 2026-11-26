// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
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
import { runOs } from "./os/launch.js";
import { FLISKOS_APP, FLISKOS_COMMAND, FLISKOS_PACKAGE, FLISKOS_REPOSITORY, } from "./os/surface.js";
export { FLISKOS_COMMAND_REQUIRED_CODE, launchFliskOs, READY_TIMEOUT_MS, runOs, } from "./os/launch.js";
export { appBundles, defaultHost, FLISKOS_APP, FLISKOS_COMMAND, FLISKOS_PACKAGE, FLISKOS_REPOSITORY, fliskOsArgs, locateFliskOs, notInstalledError, parsePort, resolveOsProject, } from "./os/surface.js";
function collect(value, previous) {
    return [...(previous ?? []), value];
}
export const osCommand = new Command("os")
    .description("Start FliskOS, the local desktop app for your Flisk projects, coding agents and Flisk apps")
    .option("--project <dir>", "Open this Flisk project (default: the project around the current folder)")
    .option("--port <port>", "Port FliskOS listens on (default: a free one)")
    .option("--no-open", "Start the server without opening a window or browser\nNeeds the `fliskos` command; FliskOS.app always opens a window")
    .option("--scan-root <dir>", "Also look for Flisk projects under this folder (repeatable)", collect)
    .option("--json", "Print one JSON envelope on stdout once FliskOS is up; FliskOS keeps running until it stops", false)
    .addHelpText("after", `
Runs the \`${FLISKOS_COMMAND}\` command when it is on PATH, otherwise opens ${FLISKOS_APP}.app (macOS). Flisk never
installs it: ${FLISKOS_PACKAGE} (npm install --global ${FLISKOS_PACKAGE}) or ${FLISKOS_REPOSITORY}.
${FLISKOS_APP}.app takes none of the options. For a terminal dashboard of the running stack use \`flisk ui\`.
`)
    .action(async (options, command) => {
    // The root program also defines `--project` (the one-command template flow), and Commander gives a root option to
    // the root wherever it appears, so `flisk os --project <dir>` arrives in the global options.
    const project = options.project ?? command.optsWithGlobals().project;
    await runOs({ ...options, project });
});
