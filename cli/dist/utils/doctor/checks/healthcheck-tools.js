// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { execAsync } from "../../exec-async.js";
import { formatCount } from "../../formatting.js";
import { shellQuote } from "../../native-container.js";
import { findProjectRoot } from "../../paths.js";
import { readinessProbeOf } from "../../service-manifest.js";
import { discoverResourcesFromRoot } from "../../services.js";
import { EXEC_TIMEOUT_MS } from "./shared.js";
const CHECK_NAME = "Health check tools";
/**
 * Shells the image map is probed with, in order. `busybox` answers through the
 * busybox binary itself (`--entrypoint busybox <image> sh -c ...`).
 */
const PROBE_SHELLS = ["sh", "bash", "busybox"];
const POSIX_SHELLS = new Set(["sh", "bash", "ash", "dash", "zsh", "ksh", "busybox"]);
/** The HTTP tools the check flags, plus the runtimes suggested as replacements. */
const PROBE_TOOLS = ["curl", "wget", "python3", "node"];
const RUNTIME_TOOLS = ["python3", "node"];
const HTTP_TOOLS = new Set(["curl", "wget"]);
/**
 * Prints `name=present|name=missing` for every probed tool, one per line. POSIX only;
 * `$t` stays unquoted so the script carries no quote a Windows tokenizer could split.
 */
const TOOL_MAP_SCRIPT = `for t in ${PROBE_TOOLS.join(" ")}; do if command -v $t >/dev/null 2>&1; then echo $t=present; else echo $t=missing; fi; done`;
const TOOL_NOT_FOUND = /executable file not found|not found in \$PATH|no such file/i;
const TOOL_LINE = /^([a-z0-9]+)=(present|missing)$/;
/** Program name a command word resolves to: strips a directory prefix. */
function basenameOf(word) {
    const slash = word.lastIndexOf("/");
    return slash === -1 ? word : word.slice(slash + 1);
}
/** curl/wget words a shell script calls as commands (not assignments or flags). */
function toolsInScript(script) {
    const found = new Set();
    for (const word of script.split(/[\s;|&()<>`]+/)) {
        if (word.includes("=") || word.includes("://") || word.startsWith("-"))
            continue;
        const program = basenameOf(word);
        if (HTTP_TOOLS.has(program))
            found.add(program);
    }
    return [...found];
}
/**
 * Parses a `healthCheck.command` array. The manifest keeps the exec form
 * (`["curl", "-f", "..."]`); a copied Compose `CMD`/`CMD-SHELL` row or an explicit
 * `sh -c` turns the probe into a shell script.
 */
export function probeCommandTools(command) {
    if (command.length === 0)
        return undefined;
    if (command[0] === "CMD-SHELL") {
        return { shell: "sh", tools: toolsInScript(command.slice(1).join(" ")) };
    }
    const parts = command[0] === "CMD" ? command.slice(1) : command;
    const program = basenameOf(parts[0] ?? "");
    if (!program)
        return undefined;
    if (POSIX_SHELLS.has(program)) {
        const dashC = parts.indexOf("-c");
        const script = dashC === -1 ? parts.slice(1).join(" ") : (parts[dashC + 1] ?? "");
        return { shell: program, tools: toolsInScript(script) };
    }
    return { shell: null, tools: [program] };
}
/** Image-backed services whose health probe calls curl or wget. */
function commandProbeCandidates(projectRoot) {
    const candidates = [];
    for (const resource of discoverResourcesFromRoot(projectRoot)) {
        const image = resource.config?.image;
        if (typeof image !== "string" || image.trim() === "")
            continue;
        const probe = readinessProbeOf(resource.config);
        if (probe?.kind !== "command")
            continue;
        const needs = probeCommandTools(probe.command);
        const tools = (needs?.tools ?? []).filter((tool) => HTTP_TOOLS.has(tool));
        if (!needs || tools.length === 0)
            continue;
        candidates.push({
            service: resource.name,
            image: image.trim(),
            needsShell: needs.shell,
            tools: [...new Set(tools)].sort((a, b) => a.localeCompare(b)),
        });
    }
    return candidates;
}
function isToolNotFound(error) {
    const failure = error;
    return TOOL_NOT_FOUND.test(`${String(failure.stderr ?? "")} ${String(failure.message ?? "")}`);
}
/** `--entrypoint` takes one word; the script arguments come after the image (`busybox` nests `sh -c`). */
function probeParts(shell, script) {
    return shell === "busybox"
        ? { entrypoint: "busybox", args: `sh -c ${shellQuote(script)}` }
        : { entrypoint: shell, args: `-c ${shellQuote(script)}` };
}
function probeRun(image, shell, script) {
    const { entrypoint, args } = probeParts(shell, script);
    return `docker run --rm --entrypoint ${entrypoint} ${shellQuote(image)} ${args}`;
}
/**
 * Runs TOOL_MAP_SCRIPT under each probe shell until one answers. Records every tried
 * shell's verdict in `shells` (false only on the daemon's "not found" reply).
 */
async function toolMapFromShell(image, shells, exec) {
    for (const shell of PROBE_SHELLS) {
        try {
            const out = await exec(probeRun(image, shell, TOOL_MAP_SCRIPT), EXEC_TIMEOUT_MS);
            const tools = new Map();
            for (const line of String(out).split("\n")) {
                const match = TOOL_LINE.exec(line.trim());
                if (match)
                    tools.set(match[1], match[2] === "present");
            }
            shells.set(shell, true);
            return tools;
        }
        catch (error) {
            if (isToolNotFound(error))
                shells.set(shell, false);
        }
    }
    return undefined;
}
/** `docker run --rm --entrypoint <tool> <image> --version`: works even with no shell in the image. */
async function toolPresentDirect(image, tool, exec) {
    try {
        await exec(`docker run --rm --entrypoint ${tool} ${shellQuote(image)} --version`, EXEC_TIMEOUT_MS);
        return true;
    }
    catch (error) {
        return isToolNotFound(error) ? false : undefined;
    }
}
/** Whether `--entrypoint <shell>` runs a no-op in the image (true/false/undecidable). */
async function shellPresent(image, shell, exec) {
    try {
        await exec(probeRun(image, shell, "true"), EXEC_TIMEOUT_MS);
        return true;
    }
    catch (error) {
        return isToolNotFound(error) ? false : undefined;
    }
}
async function probeImage(image, exec) {
    try {
        await exec(`docker image inspect ${shellQuote(image)}`, EXEC_TIMEOUT_MS);
    }
    catch {
        return { pulled: false, tools: new Map(), shells: new Map() };
    }
    const shells = new Map();
    const tools = await toolMapFromShell(image, shells, exec);
    if (tools !== undefined)
        return { pulled: true, tools, shells };
    // No shell answered: a shell-less (for example distroless) image. Ask the tools
    // directly - an exec-form health probe needs no shell either.
    const direct = new Map();
    for (const tool of PROBE_TOOLS) {
        const present = await toolPresentDirect(image, tool, exec);
        if (present !== undefined)
            direct.set(tool, present);
    }
    return { pulled: true, tools: direct, shells };
}
export async function checkHealthCheckTools(projectRoot = findProjectRoot() ?? process.cwd(), exec = execAsync) {
    const candidates = commandProbeCandidates(projectRoot);
    if (candidates.length === 0) {
        return {
            name: CHECK_NAME,
            didPass: true,
            isSkipped: true,
            message: "No image-backed service probes its health check with curl or wget",
        };
    }
    const probes = new Map();
    const imageProbe = (image) => {
        let probe = probes.get(image);
        if (!probe) {
            probe = probeImage(image, exec);
            probes.set(image, probe);
        }
        return probe;
    };
    const verified = [];
    const unverifiable = [];
    const findings = [];
    for (const candidate of candidates) {
        const probe = await imageProbe(candidate.image);
        if (!probe.pulled) {
            unverifiable.push({
                service: candidate.service,
                image: candidate.image,
                reason: "image not pulled locally",
            });
            continue;
        }
        const missing = [];
        let undecidable = false;
        for (const tool of candidate.tools) {
            const present = probe.tools.get(tool);
            if (present === false)
                missing.push(tool);
            else if (present === undefined)
                undecidable = true;
        }
        if (candidate.needsShell !== null) {
            let shellOk = probe.shells.get(candidate.needsShell);
            if (shellOk === undefined) {
                shellOk = await shellPresent(candidate.image, candidate.needsShell, exec);
            }
            if (shellOk === false)
                missing.push(candidate.needsShell);
            else if (shellOk === undefined)
                undecidable = true;
        }
        if (missing.length > 0) {
            findings.push({
                service: candidate.service,
                image: candidate.image,
                missing: [...new Set(missing)].sort((a, b) => a.localeCompare(b)),
                alternatives: RUNTIME_TOOLS.filter((tool) => probe.tools.get(tool) === true),
            });
        }
        else if (undecidable) {
            unverifiable.push({
                service: candidate.service,
                image: candidate.image,
                reason: "the image answered no tool probe",
            });
        }
        else {
            verified.push(candidate);
        }
    }
    const unverifiedNote = unverifiable.length > 0
        ? ` Not checked: ${unverifiable
            .map((entry) => `${entry.service} (${entry.reason})`)
            .join(", ")}.`
        : "";
    if (findings.length > 0) {
        const lines = findings.map((finding) => `${finding.service} (${finding.image}): healthCheck.command calls ${formatList(finding.missing)}, which the image does not have`);
        const withAlternatives = findings.find((finding) => finding.alternatives.length > 0);
        const suggestion = withAlternatives
            ? ` Its image has ${formatList(withAlternatives.alternatives)}, which a probe can use instead.`
            : "";
        return {
            name: CHECK_NAME,
            didPass: false,
            message: `${formatCount(findings.length, "health check")} calls a program its image does not have, so the container would stay unhealthy:\n    ${lines.join("\n    ")}${unverifiedNote}`,
            fix: `Point healthCheck.command at a program the image ships.${suggestion} An HTTP healthCheck.path or a healthCheck.port probe needs no extra tools, and healthCheck can also be disabled.`,
        };
    }
    if (verified.length === 0) {
        return {
            name: CHECK_NAME,
            didPass: true,
            isSkipped: true,
            message: `Could not verify the curl/wget health checks.${unverifiedNote} Pull the images with flisk up, then run flisk doctor again`,
        };
    }
    return {
        name: CHECK_NAME,
        didPass: true,
        isWarning: unverifiable.length > 0,
        message: `Every curl/wget health check probes a program its image has (${formatCount(verified.length, "service")}).${unverifiedNote}`,
    };
}
function formatList(items) {
    return items.length === 1
        ? items[0]
        : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
