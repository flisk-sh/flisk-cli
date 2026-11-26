// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { cwd } from "node:process";
import chalk from "chalk";
import { type DemoRootOptions, tiltWatchPorts } from "../utils/demo-args.js";
import type { DemoPhase, DemoPhaseStatus } from "../utils/demo-stage.js";
import { directoryStats } from "../utils/directory-stats.js";
import { formatBytes } from "../utils/formatting.js";
import { checkColimaGate, checkPlatformGate } from "./error-gate.js";

/** What the one-command flow needs from the boot tail. The optional fields default to the real process. */
export interface DemoBootstrapInput {
  argv: readonly string[];
  rootOptions: DemoRootOptions;
  /** The CLI package version, shown by the stale-version notice and the final frame. */
  version: string;
  platform?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: () => string;
  home?: () => string;
}

/**
 * `flisk <template>` and `flisk --template <name>`: the one-command flow. It clones a starter,
 * installs the CLI globally, boots the stack and opens the frontend.
 *
 * @returns The exit code once the flow finished or was refused, or `undefined` when argv is not
 *          the one-command flow and boot should continue to `parseAsync`.
 */
export async function runDemoBootstrap(input: DemoBootstrapInput): Promise<number | undefined> {
  const templateArg = input.rootOptions.template;
  if (input.rootOptions.reset) {
    return resetDemoFolders(input);
  }
  if (templateArg === "demo") {
    const nativeCode = await runNativeDemoFallback(input);
    if (nativeCode !== undefined) return nativeCode;
  }
  if (!templateArg) return undefined;
  return runTemplateDemo(input, templateArg);
}

/**
 * `flisk demo --reset`: delete the folders a demo wrote without cloning or starting anything.
 *
 * Only folders with a demo marker are removed: the fixed path lives under `~/.flisk`, which can
 * hold other user data. Every stack is stopped before the first delete, so a stack we cannot stop
 * never leaves its containers pointing at a folder that no longer exists (#5344).
 */
async function resetDemoFolders(input: DemoBootstrapInput): Promise<number> {
  const home = input.home ?? homedir;
  const cwdFn = input.cwd ?? cwd;
  const { isNativeDemoFolder, NATIVE_DEMO_DIR } = await import("../utils/native-demo.js");
  const { PROJECT_TEMPLATES } = await import("../utils/project-templates.js");
  const { stopDemoStack } = await import("../utils/demo-reset.js");

  const project = input.rootOptions.project;
  const candidates = project
    ? [isAbsolute(project) ? project : resolve(cwdFn(), project)]
    : [
        ...(PROJECT_TEMPLATES.demo?.fixedDir
          ? [join(home(), ".flisk", PROJECT_TEMPLATES.demo.fixedDir)]
          : []),
        join(home(), ".flisk", NATIVE_DEMO_DIR),
      ];
  const dockerMarker = join(".flisk", "demo-docker.json");
  const folders = candidates.filter(
    (folder) => existsSync(join(folder, dockerMarker)) || isNativeDemoFolder(folder),
  );
  if (folders.length === 0) {
    console.log(chalk.gray("No demo folder to remove."));
    return 0;
  }

  if (!(await confirmDemoReset(folders, input.rootOptions.yes))) {
    console.log(chalk.gray("Nothing was deleted."));
    return 1;
  }

  for (const folder of folders) {
    if (!existsSync(join(folder, dockerMarker))) continue;
    try {
      await stopDemoStack(folder);
    } catch (error) {
      console.error(
        chalk.red(`❌ Could not stop the demo stack in ${folder}: ${(error as Error).message}`),
      );
      console.error(chalk.gray("   Run `flisk down` there, then try again. Nothing was deleted."));
      return 1;
    }
  }

  let reclaimed = 0;
  for (const folder of folders) {
    const bytes = directoryStats(folder, [".git"]).bytes;
    try {
      rmSync(folder, { recursive: true, force: true });
    } catch (error) {
      console.error(chalk.red(`❌ Could not remove ${folder}: ${(error as Error).message}`));
      return 1;
    }
    reclaimed += bytes;
    console.log(chalk.gray(`Removed ${folder} (${formatBytes(bytes)}).`));
  }
  console.log(chalk.green(`Reclaimed ${formatBytes(reclaimed)}.`));
  return 0;
}

/**
 * `flisk demo` without Docker: the small demo runs as local processes. It needs only Node, so it
 * is decided before the Windows refusal and the Bun preflight. `undefined` means the full demo
 * can run: no reason to stay native.
 */
async function runNativeDemoFallback(input: DemoBootstrapInput): Promise<number | undefined> {
  const platform = input.platform ?? process.platform;
  const env = input.env ?? process.env;
  const cwdFn = input.cwd ?? cwd;
  const home = input.home ?? homedir;
  // npx runs a locally installed copy before it downloads one, so tell the user when it is old (#4119).
  const { staleVersionNotice } = await import("../utils/latest-version.js");
  const staleNotice = await staleVersionNotice(input.version);
  if (staleNotice) console.log(chalk.yellow(staleNotice));
  const { NATIVE_DEMO_DIR, nativeDemoReason, runNativeDemo } = await import(
    "../utils/native-demo.js"
  );
  const { cliInvocation } = await import("../utils/cli-invocation.js");
  const { currentDockerContext } = await import("../utils/container-engine.js");
  const reason = await nativeDemoReason({
    argv: input.argv,
    platform,
    env,
    kiriContext: currentDockerContext(home(), (path) => readFileSync(path, "utf8")),
  });
  if (!reason) return undefined;
  const destination = input.rootOptions.project
    ? resolve(cwdFn(), input.rootOptions.project)
    : join(home(), ".flisk", NATIVE_DEMO_DIR);
  return runNativeDemo({
    destination,
    invocation: cliInvocation(),
    reason,
    version: input.version,
  });
}

/** The full starter flow: clone, project setup, dependencies, stack, browser. */
async function runTemplateDemo(input: DemoBootstrapInput, templateArg: string): Promise<number> {
  const { rootOptions } = input;
  const projectArg = rootOptions.project;
  const platform = input.platform ?? process.platform;
  const env = input.env ?? process.env;
  const cwdFn = input.cwd ?? cwd;
  const home = input.home ?? homedir;

  const platformCode = await checkPlatformGate(platform, env.FLISK_ALLOW_NATIVE_WINDOWS);
  if (platformCode !== undefined) return platformCode;

  const { cloneProjectTemplate, exitUnknownTemplate } = await import("../commands/project.js");
  const { PROJECT_TEMPLATES, templateTargetDir } = await import("../utils/project-templates.js");

  // A mistyped starter name is refused before the machine check and before anything is drawn,
  // so the error and the list of templates are the only output.
  if (!Object.hasOwn(PROJECT_TEMPLATES, templateArg)) {
    exitUnknownTemplate(templateArg);
  }

  const { assertMachineReadyOrExit } = await import("../utils/cold-preflight.js");
  await assertMachineReadyOrExit({ scope: "scaffold" });

  // A second demo in the same folder gets its own directory instead of failing.
  const { initializeProject, installServiceDependencies, nextAvailableProjectDir, runStackQuiet } =
    await import("../utils/one-command.js");
  const { listFrontendTargets, pickReadyFrontend } = await import("../commands/open.js");
  const { discoverResourcesWithProblems, getAllStacks } = await import("../utils/services.js");
  const { openUrl } = await import("../utils/url-actions.js");
  const { createDemoStage } = await import("../utils/demo-stage.js");
  const {
    foldersSharingProjectName,
    markDemoFolder,
    readProjectName,
    removeProjectVolumes,
    sharedNameRefusal,
    sharedNameUnreadableRefusal,
    shouldMarkDemoFolder,
    stopDemoStack,
    tryListStaleProjectVolumes,
  } = await import("../utils/demo-reset.js");

  const baseName = templateTargetDir(templateArg, projectArg);
  const fixedDir = projectArg ? undefined : PROJECT_TEMPLATES[templateArg]?.fixedDir;
  const keep = rootOptions.keep;

  let targetName: string;
  if (fixedDir) {
    // A template with a fixed directory always lands in the same place, so a demo never
    // leaves a new folder behind in whatever folder the command was typed in.
    targetName = join(home(), ".flisk", fixedDir);
  } else {
    targetName = nextAvailableProjectDir(baseName, (candidate) => {
      const path = resolve(cwdFn(), candidate);
      return existsSync(path) && readdirSync(path).length > 0;
    });
    if (targetName !== baseName) {
      console.log(chalk.gray(`The folder ${baseName} is taken, using ${targetName} instead.`));
    }
  }
  const destination = isAbsolute(targetName) ? targetName : resolve(cwdFn(), targetName);

  console.log(chalk.gray(`📁 Demo folder: ${destination}`));

  // The stage is created before the reset: `tilt down` used to evaluate the whole Tiltfile before the first
  // visible phase, hiding those ~2 minutes (#4128). Seeing `Resetting the previous demo` makes the wait honest.
  const hasPreviousDemo = fixedDir && existsSync(destination);
  let phases: DemoPhase[] = [
    ...(hasPreviousDemo
      ? [{ id: "reset", label: "Resetting the previous demo", status: "pending" } as const]
      : []),
    { id: "fetch", label: "Fetching the demo", status: "pending" },
    { id: "config", label: "Generating project config", status: "pending" },
    { id: "deps", label: "Installing dependencies", status: "pending" },
    { id: "reading", label: "Reading the project", status: "pending" },
    { id: "start", label: "Starting services", status: "pending" },
  ];

  const stage = createDemoStage({
    title: "Flisk demo",
    subtitle: `${templateArg} starter`,
    phases,
    servicesReady: 0,
    servicesTotal: 0,
    servicesBuilding: 0,
    elapsedMs: 0,
  });

  const setPhase = (id: string, status: DemoPhaseStatus, elapsedMs?: number): void => {
    phases = phases.map((phase) =>
      phase.id === id ? { ...phase, status, elapsedMs: elapsedMs ?? phase.elapsedMs } : phase,
    );
    stage.update({ phases });
  };

  const logLines: string[] = [`flisk ${input.version} ${templateArg}`, `cwd: ${destination}`];

  // Reusing an existing checkout is what keeps a second take free: the clone and the
  // dependency install are skipped, so the recording starts on the interesting part.
  let reused = false;
  if (hasPreviousDemo) {
    if (!existsSync(join(destination, ".flisk", "project.json"))) {
      console.log(chalk.yellow(`${destination} already exists and is not a Flisk project.`));
      console.log(
        chalk.gray("  Remove it, or use --project <dir> to put the demo somewhere else."),
      );
      return 1;
    }

    // A stack for this project may already be running (the same example in another folder
    // shares its compose project). Then there is nothing to start: open what is up.
    // A frontend that answers is not enough: its backends have to be up too, or the shortcut opens a broken app.
    const running = await pickReadyFrontend(await listFrontendTargets(destination), 0);
    if (running && (await isStackFullyReady(destination))) {
      console.log(chalk.gray(`The demo is already running: ${running.url}`));
      await openUrl(running.url);
      return 0;
    }

    // Take the old stack down before its folder goes, so a Traefik left behind does not keep port 80.
    // If it cannot be stopped, deleting the folder would leave containers running that nothing can stop.
    const resetStarted = Date.now();
    setPhase("reset", "active");
    try {
      await stopDemoStack(destination);
      setPhase("reset", "done", Date.now() - resetStarted);
    } catch (error) {
      stage.fail((error as Error).message, `Run \`flisk down\` in ${destination}, then try again.`);
      stage.stop();
      console.error(
        chalk.red(`❌ Could not stop the previous demo stack: ${(error as Error).message}`),
      );
      console.error(
        chalk.gray(
          `   Run \`flisk down\` in ${destination}, then run the demo again. Nothing was deleted.`,
        ),
      );
      return 1;
    }

    if (keep) {
      reused = true;
    } else {
      if (!(await confirmDemoRemoval(destination, rootOptions.yes))) {
        console.log(chalk.gray("Nothing was deleted. Use --keep to reuse the folder."));
        return 1;
      }
      rmSync(destination, { recursive: true, force: true });
    }
  }

  const colimaCode = await checkColimaGate();
  if (colimaCode !== undefined) return colimaCode;

  if (reused) {
    phases = phases.map((phase) =>
      phase.id === "fetch" ? { ...phase, label: "Reusing the demo" } : phase,
    );
    stage.update({ phases });
  }
  setPhase("fetch", "active");

  // 1. Clone (or reuse) and install the CLI. Both are silent so the frame on screen is the
  // only thing that moves.
  const fetchStarted = Date.now();
  try {
    if (!reused) {
      await cloneProjectTemplate(templateArg, targetName, [], { quiet: true });
    }
  } catch (error) {
    stage.fail(
      error instanceof Error ? error.message : String(error),
      "Check that git is installed and that you are online, then run the command again.",
    );
    stage.stop();
    return 1;
  }
  const { ensureGlobalInstall } = await import("../utils/cli-command.js");
  const { cliInvocation } = await import("../utils/cli-invocation.js");
  const install = ensureGlobalInstall();
  setPhase("fetch", "done", Date.now() - fetchStarted);

  const invocation = cliInvocation();
  if (!existsSync(destination)) {
    stage.fail(
      "The demo could not find the project folder.",
      "Reinstall the Flisk CLI package and run the command again.",
    );
    stage.stop();
    return 1;
  }

  // 2. A cloned starter has no project configuration yet, and `flisk up` refuses to run
  // without one, so the project is set up before the stack starts.
  const configStarted = Date.now();
  setPhase("config", "active");
  const setup = await initializeProject(invocation, destination);
  logLines.push("--- project setup ---", setup.output ?? "");
  if (!setup.ok) {
    const logPath = writeLog(logLines, home);
    stage.fail(
      setup.error ?? "The project setup did not finish.",
      "Run `flisk project --yes` in the project folder to see what it printed.",
      logPath,
    );
    stage.stop();
    return 1;
  }
  setPhase("config", "done", Date.now() - configStarted);

  // Mark the folder as the demo's own, so a later demo knows its leftover volume is disposable (#3963).
  if (shouldMarkDemoFolder(templateArg, reused)) markDemoFolder(destination);

  // The setup above wrote a new database password. Data a previous run left in Docker was initialised with
  // the old one, and Postgres would keep it, so the migrator could not log in. A kept demo keeps its password.
  if (!reused) {
    const projectName = readProjectName(destination);
    if (projectName) {
      // Only the Compose projects of this checkout's own stacks: another checkout may share the name prefix.
      const stacks = getAllStacks(discoverResourcesWithProblems(destination).resources);
      // The demo and `flisk project restaurant` are one repository, so another folder can hold this project name and
      // its database volume. Deleting that volume would delete its data: stop instead (#3963). One listing decides the
      // check and is the exact set removed, so a second listing cannot reach a volume the check did not see.
      const staleVolumes = tryListStaleProjectVolumes(projectName, undefined, stacks);
      const sharing = foldersSharingProjectName(projectName, destination);
      // With another folder on record, unknown is not the same as none: refuse when the volumes cannot be read either.
      if (sharing.length > 0 && (staleVolumes === undefined || staleVolumes.length > 0)) {
        const refusal = staleVolumes
          ? sharedNameRefusal(projectName, sharing, staleVolumes)
          : sharedNameUnreadableRefusal(projectName, sharing);
        logLines.push(`refused: ${refusal.detail}`);
        const logPath = writeLog(logLines, home);
        stage.fail(refusal.message, refusal.hint, logPath);
        stage.stop();
        return 1;
      }
      if (staleVolumes === undefined) {
        logLines.push("could not list Docker volumes: stale volumes were not cleared");
      } else {
        const removed = removeProjectVolumes(staleVolumes);
        if (removed.length > 0) logLines.push(`removed stale volumes: ${removed.join(", ")}`);
      }
    }
  }

  // The true service count comes from the project on disk, so the frame says "0 of 6"
  // while the stack is starting instead of "no services found".
  const discovered = discoverResourcesWithProblems(destination).resources.length;
  stage.update({ servicesTotal: discovered });

  // 3. A fresh clone has no host dependencies, and the stack typechecks the services on the
  // host, so install them before the stack starts.
  const depsStarted = Date.now();
  setPhase("deps", "active");
  const installs = await installServiceDependencies(destination);
  const failedInstalls = installs.filter((entry) => !entry.ok);
  for (const entry of installs)
    logLines.push(`install ${entry.dir}: ${entry.ok ? "ok" : "failed"}`);
  if (failedInstalls.length > 0) {
    stage.fail(
      `${failedInstalls.length} of ${installs.length} services could not install their dependencies.`,
      `Run "bun install" in ${failedInstalls[0]?.dir ?? "the failed services"}.`,
      writeLog(logLines, home),
    );
    stage.stop();
    return 1;
  }
  setPhase("deps", "done", Date.now() - depsStarted);

  // 4. Start the stack and report what Tilt is doing. Its first act is reading the Tiltfile: that load used to be
  // folded into "Starting services", so a 61 s load looked like a stalled start (#4128). Time it on its own.
  const readingStarted = Date.now();
  let startStarted = readingStarted;
  setPhase("reading", "active");
  // Docker out of network ranges fails `init-networks` at once and blocks every service behind it, so make room first.
  const { ensureNetworkCapacity } = await import("../utils/demo-networks.js");
  const capacity = await ensureNetworkCapacity();
  if (capacity.removed.length > 0)
    logLines.push(`removed unused networks: ${capacity.removed.join(", ")}`);
  if (!capacity.ok) {
    stage.fail(
      "Docker has no free network ranges left, so the demo cannot start.",
      "Run `docker network prune`, or `flisk down --prune-networks` in your other Flisk projects, then run the demo again.",
      writeLog(logLines, home),
    );
    stage.stop();
    return 1;
  }
  const { readStackProgress } = await import("../utils/stack-progress.js");
  const { readSavedTiltPort } = await import("../utils/host-port-config.js");
  const { classifyTiltPorts } = await import("../utils/tilt-port-owner.js");
  let watching = true;
  // The progress line counts the user's services plus the database and the proxy, not Tilt helpers. That is the
  // number the progress line shows, so the last frame has to finish on the same one.
  let lastTotal = discovered;
  let tiltfileLoads = 0;
  let readingDone = false;
  const noteFirstTiltfileLoad = (load: { builds: number; firstElapsedMs?: number }): void => {
    if (!watching) return;
    if (load.builds > tiltfileLoads) tiltfileLoads = load.builds;
    if (readingDone || load.builds === 0) return;
    readingDone = true;
    // Tilt's own build timestamps are the measurement, not the 2 s polling interval. They say when the load
    // actually ran, so the phase reports 61 s even if the first poll happened later.
    setPhase("reading", "done", load.firstElapsedMs ?? Date.now() - readingStarted);
    startStarted = Date.now();
    setPhase("start", "active");
  };
  void (async () => {
    while (watching) {
      try {
        // `flisk up` may move Tilt off 10350 and saves the port it chose; TILT_PORT is the one asked for.
        const candidates = tiltWatchPorts(readSavedTiltPort(destination));
        const { running } = await classifyTiltPorts(
          candidates,
          destination,
          async (port) => (await readStackProgress(port)) !== undefined,
        );
        for (const port of running) {
          const progress = await readStackProgress(port);
          if (progress) {
            lastTotal = progress.total;
            noteFirstTiltfileLoad(progress.tiltfileLoad);
            stage.update({
              servicesReady: progress.ready,
              servicesTotal: progress.total,
              servicesBuilding: progress.building,
              servicesPhase: progress.infraPhase,
            });
            break;
          }
        }
      } catch {
        // A port that closes mid-read is not a demo failure; the next pass picks it up.
      }
      await new Promise((resolve) => {
        // Never keep the process alive just because the watcher is between passes.
        const timer = setTimeout(resolve, 2000);
        timer.unref?.();
      });
    }
  })();

  const outcome = await runStackQuiet(invocation, destination);
  watching = false;
  if (!readingDone) {
    // Tilt may have gone away before a poll, or its API may not expose buildHistory. The stack is up, so the load
    // happened: fall back to the wall clock rather than leaving a phase pending forever.
    setPhase("reading", "done", Date.now() - readingStarted);
    startStarted = Date.now();
    setPhase("start", "active");
  }
  logLines.push(
    tiltfileLoads > 0
      ? `Tiltfile evaluations: ${tiltfileLoads}`
      : "Tiltfile evaluations: not reported by Tilt",
  );
  logLines.push("--- stack ---", outcome.raw ?? "");
  if (!outcome.ok) {
    const tiltUiUrl =
      (outcome.data as { tiltUrl?: string } | undefined)?.tiltUrl ?? "http://localhost:10350";
    // `up` knows the port it selected, so show its log command instead of one that reads the default port (#3958).
    const logHint = outcome.suggestions?.find((line) => line.includes("flisk logs"));
    stage.fail(
      firstMachineFailure(outcome.raw) ?? outcome.error ?? "The stack stopped before it was ready.",
      logHint ?? `Run \`flisk up\` in the project folder, or watch ${tiltUiUrl}.`,
      writeLog(logLines, home),
    );
    stage.stop();
    return 1;
  }
  setPhase("start", "done", Date.now() - startStarted);
  stage.update({
    servicesReady: lastTotal,
    servicesTotal: lastTotal,
    servicesBuilding: 0,
    servicesPhase: undefined,
  });
  // A successful run writes the log too: the Tiltfile evaluation count is the evidence that a clean start did not
  // reload the Tiltfile (#4128), and there is no other place that survives the stage leaving the screen.
  writeLog(logLines, home);

  // 5. Open the browser only when a frontend actually answers, the same way `flisk open`
  // does. A failed open is not a failed demo: the URL is already on screen.
  const targets = await listFrontendTargets(destination);
  const first = await pickReadyFrontend(targets, 30_000);
  if (first) await openUrl(first.url);

  const generated = countFiles(join(destination, ".flisk"));
  const wired = countFiles(destination, ["node_modules", ".git"]);
  stage.update({ subtitle: `${templateArg} starter \u00b7 ${countLabel(wired, "file")} wired` });
  stage.finish({
    urls: (first ? [first.url, ...targets.map((target) => target.url)] : targets.map((t) => t.url))
      .filter((url, index, all) => all.indexOf(url) === index)
      .slice(0, 2),
    summary: `${countLabel(generated, "file")} generated \u00b7 ${countLabel(
      discovered,
      "app service",
    )} \u00b7 live reload`,
    hint: "Edit any file and the browser updates.",
    version: input.version,
  });
  stage.stop();

  if (install === "failed") {
    console.log(
      chalk.gray("\n  `flisk` is not on your PATH. Next time, run this command again with npx."),
    );
  }
  console.log();
  for (const line of demoDiskNotice(destination, home).split("\n")) {
    console.log(chalk.gray(`  ${line}`));
  }
  return 0;
}

/** True when the stack of this folder reports every Tilt resource ready, backends and database included. */
async function isStackFullyReady(destination: string): Promise<boolean> {
  const { readStackProgress } = await import("../utils/stack-progress.js");
  const { readSavedTiltPort } = await import("../utils/host-port-config.js");
  const { classifyTiltPorts } = await import("../utils/tilt-port-owner.js");
  try {
    const { running } = await classifyTiltPorts(
      tiltWatchPorts(readSavedTiltPort(destination)),
      destination,
      async (port) => (await readStackProgress(port)) !== undefined,
    );
    for (const port of running) {
      const progress = await readStackProgress(port);
      if (progress) return progress.total > 0 && progress.ready >= progress.total;
    }
  } catch {
    // An unreadable Tilt is not a ready one.
  }
  return false;
}

/** Asks before the old demo checkout is deleted. A script (no terminal) or --yes goes ahead; the folder is disposable. */
async function confirmDemoRemoval(destination: string, assumeYes: boolean): Promise<boolean> {
  if (assumeYes || !process.stdin.isTTY || !process.stdout.isTTY) return true;
  const { promptConfirm } = await import("../utils/prompt.js");
  return promptConfirm({
    message: `Delete the previous demo in ${destination} and start fresh? (--keep reuses it)`,
    initial: true,
  });
}

/** Asks before `--reset` deletes demo folders. A script (no terminal) or --yes goes ahead. */
async function confirmDemoReset(folders: string[], assumeYes: boolean): Promise<boolean> {
  if (assumeYes || !process.stdin.isTTY || !process.stdout.isTTY) return true;
  const { promptConfirm } = await import("../utils/prompt.js");
  return promptConfirm({
    message: `Remove the demo folders and their installed dependencies (${folders.join(", ")})?`,
    initial: true,
  });
}

/** `1 file`, `240 files`. The frame is read by people, so the count has to agree with itself. */
export function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Counts the files under `root`, skipping the directories in `skip`. */
export function countFiles(root: string, skip: string[] = []): number {
  return directoryStats(root, skip).files;
}

/**
 * The post-demo note about the host install: where it landed, how large it is and that it is
 * disposable. The size is measured after the run, so the number is the one on disk now (#5344).
 */
export function demoDiskNotice(folder: string, home: () => string = homedir): string {
  const { bytes } = directoryStats(folder, [".git"]);
  const homeDir = home();
  const shown = folder.startsWith(homeDir) ? `~${folder.slice(homeDir.length)}` : folder;
  return [
    `Host dependencies: ${formatBytes(bytes)} in ${shown} (used to typecheck the services).`,
    "Safe to delete after `flisk down`: run `flisk demo --reset` or remove the folder.",
  ].join("\n");
}

/**
 * The first machine check that failed in the stack output.
 *
 * `up` reports "exited with code 1" when a check fails before Tilt starts, which says
 * nothing. The check line above it says what is actually missing.
 */
export function firstMachineFailure(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  for (const line of raw.split("\n")) {
    const match = /^\s*FAIL\s+(\S.*)$/.exec(line);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

/** Writes the child output and Tiltfile evaluation count somewhere the run can be inspected later. */
export function writeLog(lines: string[], home: () => string = homedir): string | undefined {
  try {
    const dir = join(home(), ".flisk", "logs");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `demo-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
    writeFileSync(path, lines.join("\n"));
    return path;
  } catch {
    return undefined;
  }
}
