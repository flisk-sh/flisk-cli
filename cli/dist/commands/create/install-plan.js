// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
/**
 * The `flisk create` install plan: renders and runs the planned `flisk project`/`flisk resource`
 * steps, claims the project folder, then installs and starts what the generators wrote.
 */
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, rmdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import chalk from "chalk";
import { DEFAULT_BACKEND_LANGUAGE, getBackendLanguage } from "../../backend-languages/registry.js";
import { arrowSelect, PromptCancelled } from "../../utils/arrow-prompt.js";
import { localBackendInstall } from "../../utils/create-catalog.js";
import { asksToStart, CREATE_STACK, describeAnswers, describeRequirements, LOCAL_BACKEND_DIR, LOCAL_FRONTEND_DIR, missingPrograms, } from "../../utils/create-plan.js";
import { FliskError } from "../../utils/errors.js";
import { installServiceDependencies } from "../../utils/one-command.js";
import { isWindows } from "../../utils/platform.js";
import { discoverResourcesWithProblems } from "../../utils/services.js";
import { findOnPath } from "../../utils/which.js";
import { commandFailureTail, installFailureSuggestions, nextSteps, recoveryMessage, whereToOpen, } from "./recovery.js";
/** Builds one report from the plan and whatever the run wrote, so both routes share a shape. */
export function createJsonData(answers, projectDir, steps, resources, next, dryRun) {
    return {
        name: answers.name,
        projectFolder: projectDir,
        dryRun,
        commands: steps.map(renderStep),
        resources,
        nextSteps: next,
    };
}
/** The planned resources of a dry run come from the plan; their ports are only known after writing. */
function plannedResources(steps) {
    return steps.flatMap((step) => {
        if (step.args[0] !== "resource")
            return [];
        const name = step.args[1];
        const typeIndex = step.args.indexOf("--type");
        const type = typeIndex === -1 ? undefined : step.args[typeIndex + 1];
        return name && type ? [{ name, type }] : [];
    });
}
/** Every service.json create left behind, in a stable order agents can diff. */
export function createdResources(projectDir) {
    return discoverResourcesWithProblems(projectDir)
        .resources.flatMap((resource) => typeof resource.type === "string"
        ? [
            {
                name: resource.name,
                type: resource.type,
                ...(typeof resource.port === "number" ? { port: resource.port } : {}),
            },
        ]
        : [])
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
/** The project folder must not exist, or must be empty, so a create never overwrites anything. */
export function assertFolderIsFree(dir) {
    // lstat, not stat: a link named like the project would send every write somewhere else.
    let entry;
    try {
        entry = lstatSync(dir);
    }
    catch (error) {
        // Only "nothing there" means the folder is free; a permission error would otherwise surface later as a raw one.
        if (error.code === "ENOENT")
            return;
        throw new FliskError(`Cannot check ${dir}: ${error.message}`, [
            "Check that you can read the parent folder, or pick another place: cd <folder> && flisk create <name>",
        ]);
    }
    if (entry.isSymbolicLink()) {
        throw new FliskError(`${dir} is a link to another place, not a folder.`, [
            "Pick another name: flisk create <name>",
        ]);
    }
    if (!entry.isDirectory()) {
        throw new FliskError(`${dir} already exists and is not a folder.`, [
            "Pick another name: flisk create <name>",
        ]);
    }
    if (readdirSync(dir).length === 0)
        return;
    throw new FliskError(`The folder ${dir} already exists and is not empty.`, [
        "Pick another name: flisk create <name>",
        "Or remove the folder first.",
    ]);
}
/**
 * Claim the project folder right before anything is written. The earlier check ran before the
 * confirmation, so this re-checks it and creates the folder without `recursive` on the last
 * segment: if another process made it in the meantime, mkdir fails (EEXIST) and create aborts
 * instead of writing into a folder it no longer owns.
 */
/** Returns true when create made the folder, false when it took over an empty folder that was already there. */
export function claimFolder(dir) {
    assertFolderIsFree(dir);
    const existed = existsSync(dir);
    // An empty folder the user made is claimed the same way as a new one: rmdir only succeeds while it is still
    // empty, and the mkdir below fails if anything re-creates it, so nothing that appears in between is ever used.
    if (existsSync(dir)) {
        try {
            rmdirSync(dir);
        }
        catch {
            throw new FliskError(`The folder ${dir} is no longer empty.`, [
                "Something wrote into it while create was starting. Nothing was written by create.",
                "Pick another name: flisk create <name>",
            ]);
        }
    }
    mkdirSync(dirname(dir), { recursive: true });
    try {
        mkdirSync(dir);
    }
    catch (error) {
        if (error.code === "EEXIST") {
            throw new FliskError(`The folder ${dir} appeared while create was starting.`, [
                "Nothing was written. Pick another name: flisk create <name>",
            ]);
        }
        throw error;
    }
    return !existed;
}
/** One line per step for the dry run and the failure report. */
export function renderStep(step) {
    return `flisk ${step.args.join(" ")}`;
}
/**
 * Prints the plan a `--dry-run` would execute and its JSON data, without writing anything.
 * `flisk project` and `flisk resource` run exactly these commands in the real run.
 */
export function dryRunResult(answers, projectDir, steps, options = {}) {
    console.log(describeAnswers(answers).join("\n"));
    console.log(`needs: ${describeRequirements(answers, (program) => findOnPath(program) !== null)}\n`);
    for (const step of steps) {
        const where = step.inProject ? chalk.gray(`(in ./${answers.name})`) : "";
        console.log(`${renderStep(step)} ${where}`.trimEnd());
    }
    if (options.start && !answers.starter) {
        console.log("\nAfter scaffolding:");
        if (answers.runtime === "local") {
            const installs = [];
            if (answers.frontend)
                installs.push({ dir: LOCAL_FRONTEND_DIR, command: "npm install" });
            if (answers.backend) {
                const command = localBackendInstall(answers.backend.language);
                if (command)
                    installs.push({ dir: LOCAL_BACKEND_DIR, command });
            }
            for (const { dir, command } of installs) {
                const program = splitCommand(command)[0];
                const missing = program && !findOnPath(program) ? ` (missing: ${program})` : "";
                console.log(`(cd ./${answers.name}/${dir} && ${command})${missing}`);
            }
            console.log(`(cd ./${answers.name} && flisk up)`);
        }
        else {
            // The service folders do not exist in a dry run, so they cannot be listed: the real run runs `bun install` in
            // every folder that gets a package.json, in directory order, before `flisk up <stack>`.
            const missing = findOnPath("bun") ? "" : " (missing: bun)";
            console.log(`(cd ./${answers.name}/<each service folder with a package.json> && bun install)${missing}`);
            console.log(`(cd ./${answers.name} && flisk up ${CREATE_STACK})`);
        }
    }
    else if (options.start && answers.starter) {
        console.log("This starter does not start automatically. Follow its README after creation.");
    }
    console.log(chalk.gray("\nDry run: nothing was written."));
    return {
        data: createJsonData(answers, projectDir, steps, plannedResources(steps), [], true),
    };
}
/** Runs one planned command with this CLI, quietly. Returns its output on failure. */
function runStep(invocation, step, cwd) {
    const [command, ...prefix] = invocation;
    const result = spawnSync(command, [...prefix, ...step.args], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: result.status === 0, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}
/**
 * Runs every planned step in order, marking each done. The first failure aborts with the recovery
 * message for the half-written project.
 */
export function runPlanSteps(invocation, steps, projectDir, createdFolder) {
    for (const [index, step] of steps.entries()) {
        process.stdout.write(`  ${step.label}... `);
        const result = runStep(invocation, step, step.inProject ? projectDir : process.cwd());
        if (!result.ok) {
            console.log(chalk.red("failed"));
            console.log(result.output.trimEnd());
            throw new FliskError(`"${renderStep(step)}" did not finish.`, recoveryMessage(projectDir, steps, index, createdFolder));
        }
        console.log(chalk.green("done"));
    }
}
/** Splits an install command into words, treating "double quotes" as shell syntax: pip gets .[dev], not ".[dev]". */
export function splitCommand(command) {
    const words = [];
    const pattern = /"([^"]*)"|(\S+)/g;
    for (let match = pattern.exec(command); match; match = pattern.exec(command)) {
        words.push(match[1] ?? match[2] ?? "");
    }
    return words;
}
/**
 * Programs that must be installed before --start can run the app. A Bun API needs a package manager and
 * Bun: the generated service starts through `<manager> run dev`, whose script calls `bun run --watch`
 * (#4678). The manager is whichever of npm, bun, pnpm, yarn the machine has, so npm alone missing is not
 * a blocker (#3609).
 */
export function startBlockers(answers, onPath = (program) => findOnPath(program) !== null) {
    return missingPrograms(answers, onPath);
}
/**
 * Writes the project's README with its run commands, next to what the generators left.
 * An existing README is kept: generators may have written one already.
 */
export function writeProjectReadme(projectDir, answers, services) {
    const readme = join(projectDir, "README.md");
    const runtimeHint = answers.runtime === "docker"
        ? "Start Docker before running this project."
        : "This project runs as local processes. It does not need Docker.";
    const commands = nextSteps(projectDir, answers, services)
        .slice(1)
        .filter((line) => !/^Open /i.test(line));
    const contents = [
        `# ${answers.name}`,
        "",
        runtimeHint,
        "",
        "## Run the project",
        "",
        "```sh",
        ...commands,
        "flisk status",
        "```",
        "",
    ].join("\n");
    try {
        writeFileSync(readme, contents, { flag: "wx" });
    }
    catch (error) {
        if (error.code !== "EEXIST")
            throw error;
    }
}
/**
 * Decides whether to install and start the project now: `--start` says yes, and the local app
 * route alone gets the "install and start now?" ask (#3192) — the Docker route is started with
 * `flisk up app` and a starter points at its own README instead.
 */
export async function resolveStartIntent(answers, interactive, requested) {
    if (requested || !interactive || !asksToStart(answers))
        return requested;
    // The project is already written: Escape or Ctrl-C here means "not now", never "nothing was written".
    try {
        return ((await arrowSelect({
            message: "Start it now?",
            choices: [
                {
                    title: "Yes, start it",
                    value: "yes",
                    hint: "Downloads what it needs, then runs it.",
                },
                { title: "No, I'll do it later", value: "no", hint: "Shows the commands instead." },
            ],
        })) === "yes");
    }
    catch (error) {
        if (!(error instanceof PromptCancelled))
            throw error;
        return false;
    }
}
/**
 * Installs what the generators wrote. A local app installs each service with its own command
 * (npm, pip, go, cargo); a Docker project installs all services through the shared installer.
 */
export async function installServices(projectDir, answers, services) {
    const defaultInstall = getBackendLanguage(DEFAULT_BACKEND_LANGUAGE).installHint;
    if (answers.runtime === "local") {
        // npm falls back to the default language's package manager when it is missing; the others
        // run exactly as the generator printed them.
        for (const service of services) {
            if (!service.install)
                continue;
            const words = splitCommand(service.install);
            const wanted = words[0] ?? "npm";
            const program = wanted === "npm" && !findOnPath("npm") ? (defaultInstall.split(" ")[0] ?? "npm") : wanted;
            const label = [program, ...words.slice(1)].join(" ");
            process.stdout.write(`  Installing ${service.dir} (${label})... `);
            // On Windows npm and friends are .cmd files, which Node cannot start directly, so cmd.exe runs them. The
            // program and its arguments come from the generators, never from anything a person typed, and no shell
            // option is involved.
            const [exe, args] = isWindows()
                ? ["cmd.exe", ["/d", "/s", "/c", program, ...words.slice(1)]]
                : [program, words.slice(1)];
            const run = spawnSync(exe, args, {
                cwd: join(projectDir, service.dir),
                encoding: "utf8",
                stdio: ["ignore", "pipe", "pipe"],
            });
            if (run.error || run.status !== 0) {
                console.log(chalk.red("failed"));
                const output = [run.stdout, run.stderr, run.error?.message]
                    .filter(Boolean)
                    .map(String)
                    .join("\n");
                const tail = commandFailureTail(output);
                if (tail)
                    console.log(tail);
                throw new FliskError(`"${label}" did not finish in ${service.dir}.`, installFailureSuggestions(label, tail, answers.name, service.dir));
            }
            console.log(chalk.green("done"));
        }
        return;
    }
    process.stdout.write("  Installing dependencies... ");
    const installs = await installServiceDependencies(projectDir);
    const failed = installs.filter((entry) => !entry.ok);
    if (failed.length > 0) {
        console.log(chalk.red("failed"));
        const tail = commandFailureTail(failed.map((entry) => entry.output ?? "").join("\n"));
        if (tail)
            console.log(tail);
        throw new FliskError(`${failed.length} of ${installs.length} services could not install.`, [
            "The project is created, but the install failed for the reason shown above.",
            `Fix that cause, then run "${defaultInstall}" in ${join(projectDir, failed[0]?.dir ?? "")} and flisk up ${CREATE_STACK} in ${projectDir}.`,
        ]);
    }
    console.log(chalk.green("done"));
}
/**
 * Starts the written project: `flisk up <stack>` for a Docker project, `flisk up` for a local one,
 * after printing where to open it. Under `--json` the child's output goes to stderr so the
 * envelope stays the only stdout line.
 */
export function startProject(invocation, projectDir, answers, services, options = {}) {
    const open = answers.runtime === "local" ? whereToOpen(services) : undefined;
    if (open)
        console.log(`\n${chalk.bold(open)}\n`);
    const upArgs = answers.runtime === "docker" ? ["up", CREATE_STACK] : ["up"];
    const [command, ...prefix] = invocation;
    const stdio = options.json ? ["inherit", 2, 2] : "inherit";
    const up = spawnSync(command, [...prefix, ...upArgs], { cwd: projectDir, stdio });
    if (up.status !== 0) {
        throw new FliskError(`"flisk ${upArgs.join(" ")}" did not finish.`, [
            `The project is created. Run "flisk doctor" in ${projectDir} to see what is missing, then flisk ${upArgs.join(" ")}.`,
        ]);
    }
}
