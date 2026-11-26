// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
// `  api  (service, api/)`: two leading spaces, the name, then the kind and an optional directory.
const SERVICE_HEADER = /^ {2}(\S+)\s{2,}\(([^),]+)(?:,\s*(\S[^)]*)\/)?\)$/;
// `  .flisk/project.json  [create Flisk project]`: a planned file line, indented like a service header.
const PLANNED_FILE = /^ {2}(\S+)\s{2,}\[[^\]]+\]$/;
// `    image:     postgres:16`: a four-space `label:` field inside a service block.
const SERVICE_FIELD = /^ {4}([a-z]+):\s+(\S.*)$/;
// `  not written: bad: reason`: a rejected service, printed after the service blocks.
const NOT_WRITTEN = /^ {2}not written:\s+([^:\s][^:]*):\s+(\S.*)$/;
const SKIPPED_HEADER = /^Skipped \/ not fully imported:/;
// `  docker-compose.yml [compose]: restart not set ...`: file[:line], [detector], reason.
const SKIP_LINE = /^ {2}(\S+)\s+\[([^\]]+)\]:\s+(\S.*)$/;
function parseBuild(value) {
    const match = /^(.*?)\/ with (.+)$/.exec(value);
    if (!match)
        return { context: value };
    return { context: match[1] || ".", dockerfile: match[2] };
}
function parsePort(value) {
    const match = /^(\d+)/.exec(value);
    return match ? Number(match[1]) : undefined;
}
function parseProxy(value) {
    if (value === "routed through Traefik")
        return "traefik";
    if (value.startsWith("none"))
        return "none";
    return undefined;
}
// `[create]`, `[overwrite (--force)]` and `[exists, kept (use --force to overwrite)]`, by first word.
const WRITE_ACTIONS = {
    create: "create",
    overwrite: "overwrite",
    exists: "exists-kept",
};
function parseWrite(value) {
    const text = value.trimEnd();
    if (!text.endsWith("]"))
        return undefined;
    // The tag opens at the first `[` after the previous `]`, so a path that itself contains brackets still parses.
    const open = text.indexOf("[", text.lastIndexOf("]", text.length - 2) + 1);
    if (open < 0 || open === text.length - 2)
        return undefined;
    const tag = text.slice(open + 1, -1);
    const before = text.slice(0, open);
    const path = before.trimEnd();
    // The path and the `[action]` tag are separated by at least two spaces.
    if (path === "" || before.length - path.length < 2)
        return undefined;
    const action = WRITE_ACTIONS[tag.split(/[ ,]/)[0]];
    return action === undefined ? undefined : { path, action };
}
function setHealth(service, value) {
    if (value.endsWith(" (assumed)")) {
        service.healthCheckPath = value.slice(0, -" (assumed)".length);
        service.healthCheckAssumed = true;
    }
    else {
        service.healthCheckPath = value;
    }
}
// The four-space `label:` lines a service block can carry, mapped onto the fields they fill.
// `from`, `runtime` and `env` stay in `output` only: they name inputs, not decisions.
const SERVICE_FIELDS = {
    image: (service, value) => {
        service.image = value;
    },
    build: (service, value) => {
        service.build = parseBuild(value);
    },
    port: (service, value) => {
        const port = parsePort(value);
        if (port !== undefined)
            service.port = port;
    },
    proxy: (service, value) => {
        const proxy = parseProxy(value);
        if (proxy !== undefined)
            service.proxy = proxy;
    },
    health: (service, value) => setHealth(service, value),
    depends: (service, value) => {
        service.dependsOn = value.split(", ");
    },
    write: (service, value) => {
        const write = parseWrite(value);
        if (write !== undefined)
            service.write = write;
    },
    note: (service, value) => {
        service.notes.push(value);
    },
};
/** The `services`, `skipped` and `planned` fields of `flisk import --json`, parsed from `output`. */
export function parseImportPlan(stdout) {
    const services = [];
    const skipped = [];
    const planned = [];
    const rejected = [];
    let current;
    let inSkips = false;
    for (const rawLine of stdout.split("\n")) {
        const line = rawLine.trimEnd();
        const service = SERVICE_HEADER.exec(line);
        const notWritten = NOT_WRITTEN.exec(line);
        const plannedFile = PLANNED_FILE.exec(line);
        if (SKIPPED_HEADER.test(line)) {
            inSkips = true;
            current = undefined;
        }
        else if (line.trim() === "") {
            inSkips = false;
            current = undefined;
        }
        else if (inSkips) {
            const skip = SKIP_LINE.exec(line);
            if (skip)
                skipped.push({ source: skip[1], detector: skip[2], reason: skip[3] });
        }
        else if (notWritten) {
            rejected.push({ name: notWritten[1], reason: notWritten[2] });
            current = undefined;
        }
        else if (service) {
            current = {
                name: service[1],
                kind: service[2],
                ...(service[3] ? { dir: service[3] } : {}),
                dependsOn: [],
                notes: [],
            };
            services.push(current);
        }
        else if (plannedFile) {
            planned.push(plannedFile[1]);
            current = undefined;
        }
        else if (current) {
            const field = SERVICE_FIELD.exec(line);
            if (field)
                SERVICE_FIELDS[field[1]]?.(current, field[2]);
        }
    }
    for (const { name, reason } of rejected) {
        const service = services.find((candidate) => candidate.name === name);
        if (service)
            service.notWrittenReason = reason;
    }
    for (const service of services) {
        if (service.write && service.write.action !== "exists-kept") {
            planned.push(service.write.path);
        }
    }
    return { services, skipped, planned };
}
