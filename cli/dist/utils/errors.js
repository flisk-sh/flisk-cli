// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import chalk from "chalk";
import { DEFAULT_STACK_NAME, QUICKSTART_DOCS_URL } from "./constants.js";
import { getContainerRuntimeStatus } from "./docker.js";
import { FliskError, showError } from "./flisk-error.js";
import { findProjectRoot } from "./paths.js";
import { rankByDistance, suggestClosest } from "./suggestions.js";
import { isTiltAvailable } from "./tilt.js";
// The class and printer live in flisk-error.ts so paths.ts can throw a FliskError without importing this module (a cycle).
export { FliskError, showError };
export const UNKNOWN_RESOURCE_CODE = "UNKNOWN_RESOURCE";
export const UNKNOWN_TOOL_CODE = "UNKNOWN_TOOL";
export function getErrorMessage(err) {
    return err instanceof Error ? err.message : String(err);
}
export function logVerbose(message, err) {
    if (process.env.FLISK_VERBOSE) {
        const errMsg = err !== undefined ? `: ${getErrorMessage(err)}` : "";
        console.warn(chalk.gray(`${message}${errMsg}`));
    }
}
export function unknownResourceSuggestions(name, validNames = []) {
    const ranked = rankByDistance(name, validNames);
    const closest = suggestClosest(name, ranked);
    return [
        ...(closest ? [`Did you mean "${closest}"?`] : []),
        ranked.length > 0 ? `Resources: ${ranked.join(", ")}` : "This project has no resources yet",
        "See the names with: flisk resources",
    ];
}
export class UnknownResourceError extends FliskError {
    code = UNKNOWN_RESOURCE_CODE;
    constructor(name, suggestions) {
        super(`Resource "${name}" not found in project.`, suggestions, 1);
        this.name = "UnknownResourceError";
    }
}
export class NotInProjectError extends FliskError {
    code = "NOT_IN_PROJECT";
    constructor(message = "Could not find project root (no .flisk/project.json found)", suggestions = [
        "Run this from within a Flisk project",
        "Run `flisk project --yes` to initialize a new project",
    ], exitCode = 1) {
        super(message, suggestions, exitCode);
        this.name = "NotInProjectError";
    }
}
export class ResourceNotFoundError extends FliskError {
    code = "RESOURCE_NOT_FOUND";
    constructor(name, resourceNames = [], suggestions = [
        ...closestNameSuggestions([name], resourceNames),
        "Run `flisk resources` to list all resources",
        "Check the resource name spelling",
    ]) {
        super(`Resource "${name}" not found`, suggestions);
        this.name = "ResourceNotFoundError";
    }
}
export class StackNotFoundError extends FliskError {
    code = "STACK_NOT_FOUND";
    constructor(name, stackNames = [], suggestions = [
        ...closestNameSuggestions([name], stackNames),
        ...(stackNames.length > 0 ? [`Stacks: ${stackNames.join(", ")}`] : []),
        "Run `flisk stacks` to see available stacks",
        "Run `flisk stack` to assign resources to a stack",
    ]) {
        super(`Stack "${name}" not found`, suggestions);
        this.name = "StackNotFoundError";
    }
}
export class ConfigInvalidError extends FliskError {
    code = "CONFIG_INVALID";
    constructor(message, suggestions = [], exitCode = 1) {
        super(message, suggestions, exitCode);
        this.name = "ConfigInvalidError";
    }
}
export class DirectoryExistsError extends FliskError {
    code = "DIRECTORY_EXISTS";
    constructor(path, suggestions = [
        "Use `--path` to specify a different location",
        "Remove the existing directory if no longer needed",
    ]) {
        super(`Directory already exists: ${path}`, suggestions);
        this.name = "DirectoryExistsError";
    }
}
export class InvalidPathError extends FliskError {
    code = "INVALID_PATH";
    constructor(path, suggestions = [
        "Path must be within the project directory",
        'Path cannot contain special characters like <>:"|?*',
    ]) {
        super(`Invalid path: ${path}`, suggestions);
        this.name = "InvalidPathError";
    }
}
export class NoResourcesError extends FliskError {
    code = "NO_RESOURCES";
    constructor(message = "This project has no resources yet, so there is nothing to start.", suggestions = [...NO_RESOURCES_SUGGESTIONS], exitCode = 1) {
        super(message, suggestions, exitCode);
        this.name = "NoResourcesError";
    }
}
export class TiltNotInstalledError extends FliskError {
    code = "TILT_NOT_INSTALLED";
    constructor(message = "Tilt CLI is not installed", suggestions = [
        "Install Tilt: `brew install tilt` (macOS)",
        "Or download from: https://docs.tilt.dev/install.html",
        "Verify with: `tilt version`",
        `Setup guide: ${QUICKSTART_DOCS_URL}`,
    ]) {
        super(message, suggestions);
        this.name = "TiltNotInstalledError";
    }
}
export class DockerNotAvailableError extends FliskError {
    code = "DOCKER_NOT_AVAILABLE";
    constructor(message = "Docker (or a compatible container runtime) is not running", suggestions = [
        "Start Docker Desktop, then verify with: `docker ps`",
        "Or start Colima: `colima start`",
        "Or start the Docker service on Linux: `sudo systemctl start docker`",
        `Setup guide: ${QUICKSTART_DOCS_URL}`,
    ]) {
        super(message, suggestions);
        this.name = "DockerNotAvailableError";
    }
}
export class DockerNotRespondingError extends FliskError {
    code = "DOCKER_NOT_RESPONDING";
    constructor(message = "Docker is running but not responding (`docker ps` hung for 10s)", suggestions = [
        "Quit and reopen Docker Desktop, run `colima restart`, or restart Kiri",
        "Then verify with: `docker ps`",
    ]) {
        super(message, suggestions);
        this.name = "DockerNotRespondingError";
    }
}
export class UnknownServicesError extends FliskError {
    code = "UNKNOWN_SERVICES";
    constructor(names, validNames) {
        const orderedValid = names.length === 1 && names[0] !== undefined
            ? rankByDistance(names[0], validNames)
            : [...validNames].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        // A project with many services would put all of them on one unreadable line; point at the list instead.
        const tooManyToPrint = orderedValid.length > 10;
        // An empty valid list would leave "Valid names:" dangling; only print it when there are names.
        const printNames = orderedValid.length > 0 && !tooManyToPrint;
        const suggestions = closestNameSuggestions(names, orderedValid, names.length > 1);
        if (orderedValid.length === 0) {
            // No services are known at all: the empty-project guidance is the way out (#4966).
            suggestions.push(...NO_RESOURCES_SUGGESTIONS);
        }
        else if (tooManyToPrint) {
            suggestions.push("Run `flisk resources` to see available services");
        }
        super(printNames
            ? `Unknown service ${names.join(", ")}. Valid names: ${orderedValid.join(", ")}`
            : `Unknown service ${names.join(", ")}.`, suggestions, 2);
        this.name = "UnknownServicesError";
    }
}
export class InteractiveTerminalRequiredError extends FliskError {
    code = "INTERACTIVE_TERMINAL_REQUIRED";
    constructor(commandName = "flisk ui", suggestions = [
        "For scripts and agents: flisk status --json, flisk logs, flisk resources --json",
    ]) {
        super(`\`${commandName}\` needs an interactive terminal (stdin and stdout must be a TTY).`, suggestions);
        this.name = "InteractiveTerminalRequiredError";
    }
}
export class UnknownToolError extends FliskError {
    code = UNKNOWN_TOOL_CODE;
    constructor(message, suggestions) {
        super(message, suggestions, 1);
        this.name = "UnknownToolError";
    }
}
/**
 * Thrown by the `process.exit` test double so the stack unwinds at an intentional exit.
 * `runCommand` rethrows it instead of formatting it as a command failure.
 */
export class ProcessExitError extends Error {
    code;
    constructor(code = 1) {
        super(`process.exit(${code})`);
        this.name = "ProcessExitError";
        this.code = code;
    }
}
function closestNameSuggestions(names, candidates, includeInput = false) {
    const suggestions = new Set();
    for (const name of names) {
        const closest = suggestClosest(name, candidates);
        if (closest) {
            suggestions.add(includeInput ? `Did you mean "${closest}" for "${name}"?` : `Did you mean "${closest}"?`);
        }
    }
    return [...suggestions];
}
/**
 * The way out of an empty project, shared by the no-resources refusal (`up`) and the
 * unknown-service error when the list of valid names is empty — with no services to
 * name, "Valid names:" would dangle and `flisk resources` shows nothing (#4966).
 */
export const NO_RESOURCES_SUGGESTIONS = [
    `Add one: flisk resource api --type backend --stack ${DEFAULT_STACK_NAME}`,
    "Or start from a template: flisk create",
];
export const errorFactories = {
    tiltNotInstalled: () => new TiltNotInstalledError(),
    dockerNotAvailable: () => new DockerNotAvailableError(),
    dockerNotResponding: () => new DockerNotRespondingError(),
    stackNotFound: (name, stackNames = []) => new StackNotFoundError(name, stackNames),
    resourceNotFound: (name, resourceNames = []) => new ResourceNotFoundError(name, resourceNames),
    // `flisk repos clone [dir...]` names entries by their configured `dir`; an unknown one gets the
    // same "did you mean + valid values" treatment as an unknown service or stack (#4969).
    unknownRepoDirs: (dirs, repoDirs) => {
        const orderedValid = dirs.length === 1 && dirs[0] !== undefined
            ? rankByDistance(dirs[0], repoDirs)
            : [...repoDirs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        if (orderedValid.length === 0) {
            return new FliskError(`Unknown repository ${dirs.join(", ")}.`, [
                "No repositories are configured in .flisk/project.json",
                "Add a repos entry to .flisk/project.json, then run `flisk repos clone`",
            ]);
        }
        return new FliskError(`Unknown repository ${dirs.join(", ")}. Valid dirs: ${orderedValid.join(", ")}`, [
            ...closestNameSuggestions(dirs, orderedValid, dirs.length > 1),
            "Run `flisk repos list` to see the configured repositories",
            "Run `flisk repos clone` without arguments to clone every missing repository",
        ]);
    },
    unknownResource: (name, validNames = []) => new UnknownResourceError(name, unknownResourceSuggestions(name, validNames)),
    unknownServices: (names, validNames) => new UnknownServicesError(names, validNames),
    directoryExists: (path) => new DirectoryExistsError(path),
    invalidPath: (path) => new InvalidPathError(path),
    notInProject: () => new NotInProjectError(),
    noResources: () => new NoResourcesError(),
    interactiveTerminalRequired: (commandName = "flisk ui") => new InteractiveTerminalRequiredError(commandName),
};
export function requireProjectRoot() {
    const projectRoot = findProjectRoot();
    if (!projectRoot) {
        return errorFactories.notInProject().exit();
    }
    return projectRoot;
}
/**
 * Resolves the project root before a command mutates or probes Docker on the machine (#4282).
 * Exits with the not-in-project error when `resolveRoot` returns null.
 */
export function requireProjectBeforeDocker(resolveRoot = findProjectRoot, onNotInProject) {
    const projectRoot = resolveRoot();
    if (!projectRoot) {
        const error = errorFactories.notInProject();
        if (onNotInProject) {
            return onNotInProject(error);
        }
        return error.exit();
    }
    return projectRoot;
}
/** Prints a command failure the way every command does (a FliskError with its suggestions, anything else as one error line) and exits 1. */
export function handleCommandError(err) {
    if (err instanceof FliskError) {
        err.exit();
    }
    showError(getErrorMessage(err));
    process.exit(1);
}
export async function runCommand(action, options) {
    try {
        return await action();
    }
    catch (err) {
        if (err instanceof ProcessExitError) {
            throw err;
        }
        if (options?.verbose && err instanceof Error && err.stack) {
            console.error(chalk.gray(err.stack));
        }
        return handleCommandError(err);
    }
}
export async function withTiltCheck(action, options) {
    const problems = [];
    // `down` can already know Docker answered from its idle probe; asking `docker ps` again is redundant (#4173).
    if (!options?.skipRuntimeCheck) {
        const runtime = options?.containerRuntimeStatus ?? getContainerRuntimeStatus();
        if (runtime === "unresponsive") {
            problems.push(errorFactories.dockerNotResponding());
        }
        else if (runtime === "missing") {
            problems.push(errorFactories.dockerNotAvailable());
        }
    }
    if (!(await isTiltAvailable())) {
        problems.push(errorFactories.tiltNotInstalled());
    }
    if (problems.length > 0) {
        console.error(chalk.red(`\nFlisk can't start - missing prerequisites:\n`));
        problems.forEach((problem, i) => {
            if (i > 0)
                console.error("");
            problem.display();
        });
        console.error(chalk.gray(`\nRun \`flisk doctor\` for a full environment check.`));
        process.exit(1);
    }
    return runCommand(action, options);
}
export function showErrorAndExit(message, exitCode = 1, suggestions) {
    showError(message, undefined, suggestions);
    process.exit(exitCode);
}
export function handleTiltFailure(command, exitCode) {
    console.error(chalk.red(`\ntilt ${command} failed with exit code ${exitCode}`));
    process.exit(exitCode);
}
