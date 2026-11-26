// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { projectEnvLookup } from "../extra-port-publish.js";
import { formatCount } from "../formatting.js";
import { findProjectRoot } from "../paths.js";
import { discoverResourcesFromRoot } from "../services.js";
import { extraPortsOf, isLoopbackAddress } from "../status-ports.js";
import { findOnPath } from "../which.js";
import { filePath } from "./shared.js";
/** `docker ps` lines `name|ports`, or "" when Docker cannot be asked. */
function dockerPublishedPorts() {
    try {
        return execFileSync(findOnPath("docker") ?? "docker", ["ps", "--format", "{{.Names}}|{{.Ports}}"], {
            encoding: "utf-8",
            timeout: 5000,
            stdio: ["ignore", "pipe", "ignore"],
        });
    }
    catch {
        return "";
    }
}
/** The non-loopback host address (`0.0.0.0:80/tcp`) a running container publishes this host port on, or null. */
export function liveNetworkAddress(dockerPs, hostPort, containerPort, protocol) {
    const suffix = `:${hostPort}->${containerPort}/${protocol}`;
    for (const line of dockerPs.split("\n")) {
        const ports = line.slice(line.indexOf("|") + 1);
        for (const mapping of ports.split(",")) {
            const text = mapping.trim();
            if (!text.endsWith(suffix))
                continue;
            const address = text.slice(0, text.length - suffix.length).replace(/^\[(.*)\]$/, "$1");
            if (address && !isLoopbackAddress(address) && address !== "::1")
                return `${address}${suffix.replace("->", " -> ")}`;
        }
    }
    return null;
}
/**
 * An `extraPorts` entry with `"bind": "0.0.0.0"` (#2935), or a `publish` that resolves to one (a bare port, 0.0.0.0 or any
 * non-loopback address), is reachable from every device on the network, unlike everything else Flisk publishes. Say so in
 * `flisk doctor`, as a warning, so it stays a visible choice. A `publish` variable is read from the shell and the project `.env`
 * the way Compose reads it; a value that is not a port or address:port is named, because Compose would refuse it.
 */
export function checkNetworkPorts(projectRoot = findProjectRoot() ?? process.cwd(), resources = discoverResourcesFromRoot(projectRoot), dockerPorts = dockerPublishedPorts) {
    const lookup = projectEnvLookup(projectRoot);
    const ports = resources.flatMap((resource) => extraPortsOf(resource, lookup).map((port) => ({ resource, port })));
    const open = ports
        .filter(({ port }) => !port.problem && !isLoopbackAddress(port.bind))
        .map(({ resource, port }) => {
        const via = port.publish
            ? ` (${port.publish.variables.join(", ")}, ${port.publish.source === "environment" ? "set in the environment or .env" : "default in service.json"})`
            : "";
        return `${resource.name} ${port.address}${via}`;
    });
    const bad = ports
        .filter(({ port }) => port.problem)
        .map(({ resource, port }) => `${resource.name} ${port.problem}`);
    // service.json and .env say 127.0.0.1, but a container created before they changed (or by hand) may still be on every interface.
    const declaredLoopback = ports.filter(({ port }) => !port.problem && isLoopbackAddress(port.bind));
    const live = declaredLoopback.length > 0 ? dockerPorts() : "";
    const stale = declaredLoopback
        .map(({ resource, port }) => ({
        resource,
        port,
        address: liveNetworkAddress(live, port.hostPort, port.containerPort, port.protocol),
    }))
        .filter((entry) => entry.address !== null)
        .map(({ resource, port, address }) => `${resource.name} ${port.address} is declared on this machine only, but a running container publishes ${address}`);
    if (open.length === 0 && bad.length === 0 && stale.length === 0) {
        return {
            name: "Network ports",
            didPass: true,
            message: "No port is published beyond this machine",
        };
    }
    const sections = [
        open.length > 0
            ? `${formatCount(open.length, "port")} reachable from the network:\n    ${open.join("\n    ")}`
            : "",
        stale.length > 0
            ? `${formatCount(stale.length, "port")} wider than declared:\n    ${stale.join("\n    ")}`
            : "",
        bad.length > 0 ? `Invalid published address:\n    ${bad.join("\n    ")}` : "",
    ].filter(Boolean);
    return {
        name: "Network ports",
        didPass: false,
        isWarning: true,
        message: sections.join("\n  "),
        fix: [
            open.length > 0
                ? 'Remove "bind": "0.0.0.0" from extraPorts, or start a "publish" default or .env value with 127.0.0.1:, to publish on this machine only'
                : "",
            stale.length > 0
                ? "Recreate the container (flisk restart <resource>) so it picks up the declared bind"
                : "",
            bad.length > 0
                ? 'Set the .env value to a port or an IPv4 address:port such as "127.0.0.1:8080"'
                : "",
        ]
            .filter(Boolean)
            .join(". "),
    };
}
/** A port outside 1-65535 can never be bound, and `flisk up` would otherwise find out only when Docker fails. */
export function checkServicePorts(projectRoot = findProjectRoot() ?? process.cwd(), resources = discoverResourcesFromRoot(projectRoot)) {
    const problems = resources.flatMap((resource) => {
        const port = resource.config?.port;
        if (port === undefined)
            return [];
        if (typeof port === "number" && Number.isInteger(port) && port >= 1 && port <= 65535)
            return [];
        return [
            `${filePath(projectRoot, resource)} port ${JSON.stringify(port)}: not an integer from 1 to 65535`,
        ];
    });
    if (problems.length === 0) {
        return { name: "Service ports", didPass: true, message: "Every declared port is valid" };
    }
    return {
        name: "Service ports",
        didPass: false,
        message: `${formatCount(problems.length, "invalid port")}:\n    ${problems.join("\n    ")}`,
        fix: 'Set "port" to the port the service listens on, an integer from 1 to 65535',
    };
}
/**
 * Logical Dockerfile instructions: backslash continuations are joined and comment lines are dropped, so an
 * instruction split across lines (a common way to hide a port in a HEALTHCHECK) is inspected as one unit.
 */
function dockerfileInstructions(contents) {
    const instructions = [];
    let current = "";
    for (const rawLine of contents.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!current && (line === "" || line.startsWith("#")))
            continue;
        if (line.endsWith("\\")) {
            current += `${line.slice(0, -1).trim()} `;
            continue;
        }
        instructions.push(`${current}${line}`.trim());
        current = "";
    }
    if (current.trim() !== "")
        instructions.push(current.trim());
    return instructions;
}
/** Strip a trailing `# comment` from an instruction; a `#` inside a quoted value is kept. */
function withoutTrailingComment(value) {
    let quote;
    for (let i = 0; i < value.length; i++) {
        const char = value[i];
        if (quote) {
            if (char === quote)
                quote = undefined;
        }
        else if (char === '"' || char === "'") {
            quote = char;
        }
        else if (char === "#") {
            return value.slice(0, i).trim();
        }
    }
    return value.trim();
}
/** Each `FROM` starts a stage; a named stage uses `FROM <base> AS <name>` (case-insensitive `AS`). */
function dockerfileStages(instructions) {
    const stages = [];
    for (const instruction of instructions) {
        const from = /^FROM\s+/.test(instruction);
        if (from) {
            const name = instruction.match(/^FROM\s+\S+\s+AS\s+(\S+)/i)?.[1]?.toLowerCase();
            stages.push({ ...(name ? { name } : {}), lines: [] });
        }
        else if (stages.length === 0) {
            stages.push({ lines: [] });
        }
        if (stages.length > 0 && !from)
            stages[stages.length - 1]?.lines.push(instruction);
    }
    return stages;
}
/**
 * A resource's own Dockerfile can drift from its service.json after a re-registration (#3738) or a hand edit:
 * `ENV PORT`, `EXPOSE` and the healthcheck keep the old number while `port` moves on. `flisk up` then publishes the
 * new port to a container that still listens on the old one, and only the healthcheck reveals the mismatch. Local
 * process resources have no Dockerfile, so they are skipped.
 */
export function checkDockerfilePorts(projectRoot = findProjectRoot() ?? process.cwd(), resources = discoverResourcesFromRoot(projectRoot)) {
    const problems = resources.flatMap((resource) => {
        const config = resource.config;
        const declared = config?.port;
        // checkServicePorts already reports an invalid number; repeating it here would double the error.
        if (typeof declared !== "number" ||
            !Number.isInteger(declared) ||
            declared < 1 ||
            declared > 65535) {
            return [];
        }
        // A native image resource pulls `image` and has no Dockerfile to compare against.
        if (typeof config?.image === "string" && config.image.trim() !== "")
            return [];
        const dockerfile = (typeof config?.dockerfile === "string" && config.dockerfile !== ""
            ? config.dockerfile
            : undefined) ??
            (typeof config?.build?.dockerfile === "string" && config.build.dockerfile !== ""
                ? config.build.dockerfile
                : undefined) ??
            "Dockerfile";
        const context = (typeof config?.buildContext === "string"
            ? config.buildContext
            : typeof config?.build?.context === "string"
                ? config.build.context
                : "") || "";
        const dockerfilePath = join(dirname(resource.configPath), context === "." ? "" : context, dockerfile);
        let isFile = false;
        try {
            isFile = statSync(dockerfilePath).isFile();
        }
        catch {
            isFile = false;
        }
        if (!isFile)
            return [];
        let contents;
        try {
            contents = readFileSync(dockerfilePath, "utf8");
        }
        catch {
            return [];
        }
        const stages = dockerfileStages(dockerfileInstructions(contents));
        const target = (typeof config?.target === "string" ? config.target : undefined) ??
            (typeof config?.build?.target === "string" ? config.build.target : undefined);
        const stage = (target ? stages.find((candidate) => candidate.name === target.toLowerCase()) : undefined) ??
            stages[stages.length - 1];
        const lines = stage?.lines ?? [];
        const found = new Map();
        const add = (label, value) => {
            const values = found.get(label) ?? [];
            if (!values.includes(value))
                values.push(value);
            found.set(label, values);
        };
        // The last ENV PORT in the effective stage is the one the container uses. Each line is read as `NAME=value`
        // assignments, so `ENV FOO=1 PORT=4010` is understood without mistaking `OTHER_PORT` for `PORT`.
        for (const line of lines) {
            if (!/^ENV\s/i.test(line))
                continue;
            const rest = withoutTrailingComment(line.replace(/^ENV\s+/i, ""));
            // `ENV PORT 4010` (legacy space form) or a `PORT=...` assignment among other variables.
            const spaceForm = rest.match(/^PORT\s+("[^"]*"|'[^']*'|\S+)$/i);
            const assignment = rest.match(/(?:^|\s)PORT\s*=\s*("[^"]*"|'[^']*'|\S+)/i);
            const value = (spaceForm ?? assignment)?.[1]?.replace(/^["']|["']$/g, "");
            if (value !== undefined && /^\d+$/.test(value))
                found.set("PORT", [Number(value)]);
        }
        // EXPOSE can name several ports and optional /tcp or /udp suffixes.
        for (const line of lines) {
            const match = line.match(/^EXPOSE\s+(\S.*)$/i);
            if (!match)
                continue;
            for (const token of withoutTrailingComment(match[1] ?? "").split(/\s+/)) {
                const port = token.match(/^(\d+)(?:\/(?:tcp|udp))?$/i)?.[1];
                if (port !== undefined)
                    add("EXPOSE", Number(port));
            }
        }
        // Only HEALTHCHECK instructions can report a healthcheck port. Host and port forms cover curl, wget and
        // `nc -z localhost 4010`; flags such as --interval/--timeout are ignored because no host follows them.
        for (const line of lines) {
            if (!/^HEALTHCHECK\s/i.test(line))
                continue;
            const instruction = withoutTrailingComment(line);
            for (const match of instruction.matchAll(/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):(\d+)/gi)) {
                add("healthcheck", Number(match[1]));
            }
            for (const match of instruction.matchAll(/\bnc\s+(?:-z\s+)?(?:localhost|127\.0\.0\.1)\s+(\d+)\b/gi)) {
                add("healthcheck", Number(match[1]));
            }
        }
        const mismatches = [];
        for (const [label, values] of found) {
            // A service may expose several ports, or a healthcheck may probe a different internal port. What matters is
            // that service.json's port appears among them; `ENV PORT` has exactly one effective value and must match it.
            if (label !== "PORT" && values.includes(declared))
                continue;
            for (const value of values) {
                if (value !== declared) {
                    mismatches.push(`${label} ${value} (expected ${declared})`);
                }
            }
        }
        if (mismatches.length === 0)
            return [];
        const configFile = filePath(projectRoot, resource);
        const dockerFile = relative(projectRoot, dockerfilePath) || dockerfilePath;
        return [
            `${configFile} port ${declared} disagrees with ${dockerFile}: ${mismatches.join(", ")}`,
        ];
    });
    if (problems.length === 0) {
        return {
            name: "Dockerfile ports",
            didPass: true,
            message: "Every Dockerfile port matches its service.json",
        };
    }
    return {
        name: "Dockerfile ports",
        didPass: false,
        message: `${formatCount(problems.length, "port mismatch")}:\n    ${problems.join("\n    ")}`,
        fix: 'Set "port" in service.json to the port the Dockerfile listens on, or update the Dockerfile PORT, EXPOSE and healthcheck ports to match service.json',
    };
}
