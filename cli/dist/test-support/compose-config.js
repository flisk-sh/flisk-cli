// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
// Test helper: compares the `docker compose config --format json --no-interpolate` model of an original Compose
// file with the model of a file `flisk export compose` generated from it. The Lychee adoption spec
// (LycheeOrg/Lychee#4936, FR-104-04) calls for exactly this check, field by field and per service, listing only the
// differences the importer and exporter document. Everything not on the documented list comes back as a difference
// the test fails on.
//
// The documented list, taken from docs/project/ADOPTER-COVERAGE.md and the spec:
//   - the project `name` written into the generated file, and renamed services (Compose names are kebab-cased; the
//     original name survives as a network alias);
//   - custom or named `networks`: services move onto the default network and keep only their aliases;
//   - `container_name`, `expose` and `deploy.resources.reservations`, dropped fields the importer documents;
//   - `init: true` and `restart: unless-stopped`, Flisk defaults added where the original did not set them;
//   - `env_file`, re-emitted relative to the generated file and no longer required;
//   - `image`, not written when the service also has `build` (the importer keeps the build);
//   - top-level volume `name` and `driver`, made explicit (`name` defaults to <project>_<key>, `driver` to local).
// Normalized as equal rather than reported: kebab service matching, `depends_on` targets rewritten to the renamed
// names, long-form ports, the `CMD-SHELL` / `CMD sh -c` / string healthcheck forms, `build.dockerfile` defaulting
// to "Dockerfile", `environment` values read as the strings Compose hands the container, and set-like lists
// (`cap_add`, `tmpfs`, `profiles`, ...) in any order.
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { trimChar } from "../utils/trim-chars.js";
import { findOnPath } from "../utils/which.js";
export const MISSING_COMPOSE_MESSAGE = "`docker compose` was not found on PATH. Install the Compose plugin to run the exporter parity tests.";
let composeState;
/** Whether `docker compose` runs. Probed once, like `tiltAvailable` in ./starlark.js. */
export function composeConfigAvailable() {
    composeState ??=
        spawnSync(findOnPath("docker") ?? "docker", ["compose", "version"], {
            encoding: "utf-8",
            timeout: 30_000,
        }).status === 0;
    return composeState;
}
/**
 * The normalized Compose model of one file: `docker compose config --format json --no-interpolate` parses it the
 * way `docker compose up` would, without resolving `${...}` (so no .env values are needed). Throws with the
 * command's own output when the file does not parse.
 */
export function composeConfigModel(composeFile, timeout = 30_000) {
    const run = spawnSync(findOnPath("docker") ?? "docker", ["compose", "-f", composeFile, "config", "--format", "json", "--no-interpolate"], { cwd: dirname(composeFile), encoding: "utf-8", timeout });
    if (run.error) {
        throw new Error(`docker compose config could not run on ${composeFile}: ${run.error.message}`);
    }
    if (run.status !== 0) {
        throw new Error(`docker compose config failed on ${composeFile} (exit ${run.status}):\n${run.stderr ?? run.stdout}`);
    }
    return JSON.parse(run.stdout);
}
/**
 * The parity report for two Compose files: `original` is the adopter's own file, `generated` the one
 * `flisk export compose` wrote. `differences` must be empty for parity; `documented` is the list the spec allows.
 */
export function composeConfigParity(originalFile, generatedFile) {
    return compareConfigModels(composeConfigModel(originalFile), composeConfigModel(generatedFile));
}
const NON_KEBAB = /[^a-z0-9-]+/g;
/** Compose allows `a-zA-Z0-9._-` in service names; the importer rewrites anything else to lowercase kebab. */
function kebab(name) {
    return trimChar(name.toLowerCase().replace(NON_KEBAB, "-"), "-");
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Deep structural equality that does not care about object key order. */
function same(a, b) {
    if (isRecord(a) && isRecord(b)) {
        const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
        return [...keys].every((key) => same(a[key], b[key]));
    }
    if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && a.every((v, i) => same(v, b[i]));
    }
    return a === b;
}
function describe(value) {
    const text = JSON.stringify(value) ?? String(value);
    return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}
function diffValues(path, original, generated, out) {
    if (isRecord(original) && isRecord(generated)) {
        for (const key of new Set([...Object.keys(original), ...Object.keys(generated)])) {
            diffValues(`${path}.${key}`, original[key], generated[key], out);
        }
        return;
    }
    if (!same(original, generated)) {
        out.push(`${path}: ${describe(original)} -> ${describe(generated)}`);
    }
}
/** One healthcheck `test` in canonical form: the string form, CMD-SHELL and `CMD sh -c` all mean the same. */
function canonicalHealthcheckTest(test) {
    if (typeof test === "string")
        return ["CMD-SHELL", test];
    if (!Array.isArray(test))
        return test;
    if (test[0] === "CMD-SHELL")
        return ["CMD-SHELL", ...test.slice(1)];
    if (test[0] === "CMD" && test[1] === "sh" && test[2] === "-c")
        return ["CMD-SHELL", ...test.slice(3)];
    return test;
}
/** Split a short-form port mapping on `:` but not on the `:` inside `${VAR:-default}` or a `[...]` host. */
function splitPortMapping(text) {
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
        if (text[i] === "$" && text[i + 1] === "{") {
            depth++;
            i++;
        }
        else if (text[i] === "}" && depth > 0) {
            depth--;
        }
        else if (text[i] === ":" && depth === 0) {
            parts.push(text.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(text.slice(start));
    return parts;
}
/**
 * One port mapping in canonical `host:published:target/protocol(mode,app)` form, whether the model holds the
 * short string ("8080:80", "${PORT:-80}:80/tcp") or the long-form object, and defaulting tcp/ingress.
 */
function canonicalPort(port) {
    if (isRecord(port)) {
        const parts = [
            port.host_ip ?? "",
            port.published ?? "",
            port.target ?? "",
            port.protocol ?? "tcp",
        ];
        return `${parts.join(":")}(${port.mode ?? "ingress"},${port.app_protocol ?? ""})`;
    }
    if (typeof port === "number")
        return `::${port}:tcp(ingress,)`;
    if (typeof port !== "string")
        return JSON.stringify(port);
    let text = port;
    let protocol = "tcp";
    const slash = text.lastIndexOf("/");
    if (slash !== -1) {
        protocol = text.slice(slash + 1);
        text = text.slice(0, slash);
    }
    let host = "";
    if (text.startsWith("[")) {
        const end = text.indexOf("]");
        host = text.slice(0, end + 1);
        text = text.slice(end + 1).replace(/^:/, "");
    }
    const parts = splitPortMapping(text);
    const target = parts.pop() ?? "";
    const published = parts.pop() ?? "";
    if (parts.length > 0)
        host = parts.join(":");
    return `${host}:${published}:${target}:${protocol}(ingress,)`;
}
/** The identity of one service volume entry: type, source, target, read-only and SELinux, not key order. */
function canonicalVolume(volume) {
    if (typeof volume === "string")
        return volume;
    if (!isRecord(volume))
        return volume;
    const { type, source, target, read_only, selinux, ...rest } = volume;
    return { type, source, target, read_only, selinux, ...rest };
}
/**
 * Shell-form commands and entrypoints come back from the importer as an exec list: `bundle exec rails x` becomes
 * `["bundle", "exec", "rails", "x"]`. Whitespace-splitting the string form compares like with like.
 */
function canonicalCommand(command) {
    if (typeof command === "string")
        return command.split(/\s+/).filter(Boolean);
    return command;
}
/** All network aliases a service carries, from every attachment on either file's network layout. */
function networkAliases(networks) {
    if (!isRecord(networks))
        return [];
    const aliases = new Set();
    for (const attachment of Object.values(networks)) {
        if (isRecord(attachment) && Array.isArray(attachment.aliases)) {
            for (const alias of attachment.aliases)
                aliases.add(String(alias));
        }
    }
    return [...aliases].sort((a, b) => a.localeCompare(b));
}
function sortedCopy(value) {
    return Array.isArray(value)
        ? [...value].sort((a, b) => String(a).localeCompare(String(b)))
        : value;
}
const SET_LIKE_FIELDS = [
    "cap_add",
    "cap_drop",
    "security_opt",
    "profiles",
    "tmpfs",
    "extra_hosts",
    "models",
];
/**
 * One service model reduced to what parity compares: fields on the documented list removed (only in the
 * documented direction, so a value the generated file invents still shows up), names and spellings canonicalized.
 * `networks` and `env_file` are handled by dedicated checks.
 */
function canonicalService(service, renames, drops) {
    const canonical = { ...service };
    delete canonical.env_file;
    delete canonical.networks;
    for (const field of drops.dropped)
        delete canonical[field];
    if (drops.init)
        delete canonical.init;
    if (drops.restart)
        delete canonical.restart;
    if (drops.image)
        delete canonical.image;
    if (isRecord(canonical.deploy)) {
        const deploy = { ...canonical.deploy };
        if (drops.reservations && isRecord(deploy.resources)) {
            const resources = { ...deploy.resources };
            delete resources.reservations;
            deploy.resources = resources;
        }
        canonical.deploy = deploy;
    }
    if (isRecord(canonical.build)) {
        canonical.build = { dockerfile: "Dockerfile", ...canonical.build };
    }
    if (isRecord(canonical.healthcheck) && "test" in canonical.healthcheck) {
        canonical.healthcheck = {
            ...canonical.healthcheck,
            test: canonicalHealthcheckTest(canonical.healthcheck.test),
        };
    }
    // Compose hands every environment value to the container as a string; a YAML `16.8` and a quoted "16.8"
    // configure the same variable.
    if (isRecord(canonical.environment)) {
        canonical.environment = Object.fromEntries(Object.entries(canonical.environment).map(([key, value]) => [
            key,
            value === null || value === undefined ? value : String(value),
        ]));
    }
    if (isRecord(canonical.depends_on)) {
        canonical.depends_on = Object.fromEntries(Object.entries(canonical.depends_on).map(([target, condition]) => [
            renames.get(target) ?? target,
            condition,
        ]));
    }
    for (const field of SET_LIKE_FIELDS) {
        if (field in canonical)
            canonical[field] = sortedCopy(canonical[field]);
    }
    if (Array.isArray(canonical.ports)) {
        canonical.ports = canonical.ports.map(canonicalPort).sort((a, b) => a.localeCompare(b));
    }
    if (Array.isArray(canonical.volumes)) {
        canonical.volumes = canonical.volumes
            .map(canonicalVolume)
            .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    }
    if ("command" in canonical)
        canonical.command = canonicalCommand(canonical.command);
    if ("entrypoint" in canonical)
        canonical.entrypoint = canonicalCommand(canonical.entrypoint);
    return canonical;
}
/** env_file entries compare on their resolved path and format; `required` is a documented relaxation. */
function canonicalEnvFile(envFile) {
    if (!Array.isArray(envFile))
        return envFile;
    return envFile
        .map((entry) => {
        if (!isRecord(entry))
            return entry;
        const { required: _required, ...rest } = entry;
        return JSON.stringify(rest);
    })
        .sort((a, b) => String(a).localeCompare(String(b)));
}
/**
 * The pure half of `composeConfigParity`: two normalized models in, the report out. Exported so the documented
 * differences can be unit-tested without Docker.
 */
export function compareConfigModels(original, generated) {
    const documented = [];
    const differences = [];
    if (!same(original.name, generated.name)) {
        documented.push({
            kind: "project-name",
            message: `project name: ${describe(original.name)} -> ${describe(generated.name)}`,
        });
    }
    const originalServices = original.services ?? {};
    const generatedServices = generated.services ?? {};
    const renames = new Map();
    for (const name of Object.keys(originalServices)) {
        const renamed = kebab(name);
        if (renamed !== name) {
            renames.set(name, renamed);
            documented.push({
                kind: "service-name",
                message: `service "${name}" is renamed to "${renamed}" (kebab-case)`,
            });
        }
    }
    const expectedNames = new Set(Object.keys(originalServices).map((name) => renames.get(name) ?? name));
    for (const [name, originalService] of Object.entries(originalServices)) {
        const generatedService = generatedServices[renames.get(name) ?? name];
        if (!generatedService) {
            differences.push({
                kind: "service-missing",
                message: `service "${name}" has no counterpart in the generated file`,
            });
            continue;
        }
        // Networks: attachments and topology are documented; the alias set must keep the original's aliases plus the
        // original name when the service was renamed.
        if (!same(originalService.networks, generatedService.networks)) {
            documented.push({
                kind: "networks",
                message: `service "${name}" network attachments: ${describe(originalService.networks)} -> ${describe(generatedService.networks)}`,
            });
        }
        const expectedAliases = new Set(networkAliases(originalService.networks));
        if (renames.has(name))
            expectedAliases.add(name);
        const generatedAliases = networkAliases(generatedService.networks);
        const sortedExpected = [...expectedAliases].sort((a, b) => a.localeCompare(b));
        if (!same(sortedExpected, generatedAliases)) {
            differences.push({
                kind: "networks",
                message: `service "${name}" network aliases: expected ${describe(sortedExpected)}, got ${describe(generatedAliases)}`,
            });
        }
        // Documented drops and additions, checked in the right direction so a regression cannot hide in the list:
        // each drop applies only while the generated file actually shows the documented shape.
        const originalHasField = (field) => field in originalService;
        const generatedResources = isRecord(generatedService.deploy)
            ? generatedService.deploy.resources
            : undefined;
        const drops = {
            init: !originalHasField("init") && "init" in generatedService,
            restart: !originalHasField("restart") && "restart" in generatedService,
            image: originalHasField("build") && originalHasField("image") && !("image" in generatedService),
            reservations: isRecord(originalService.deploy) &&
                isRecord(originalService.deploy.resources) &&
                originalService.deploy.resources.reservations !== undefined &&
                (!isRecord(generatedResources) || generatedResources.reservations === undefined),
            dropped: ["container_name", "expose"].filter((field) => field in originalService && !(field in generatedService)),
        };
        if (drops.init) {
            const finding = {
                kind: "init",
                message: `service "${name}" init: ${describe(originalService.init)} -> ${describe(generatedService.init)}`,
            };
            if (generatedService.init === true)
                documented.push(finding);
            else
                differences.push(finding);
        }
        if (drops.restart) {
            const finding = {
                kind: "restart-default",
                message: `service "${name}" restart: ${describe(originalService.restart)} -> ${describe(generatedService.restart)}`,
            };
            if (generatedService.restart === "unless-stopped")
                documented.push(finding);
            else
                differences.push(finding);
        }
        for (const field of drops.dropped) {
            documented.push({
                kind: field,
                message: `service "${name}" ${field}: ${describe(originalService[field])} -> dropped`,
            });
        }
        if (drops.image) {
            documented.push({
                kind: "image-with-build",
                message: `service "${name}" keeps its build: the image tag ${describe(originalService.image)} is not written`,
            });
        }
        if (drops.reservations &&
            isRecord(originalService.deploy) &&
            isRecord(originalService.deploy.resources)) {
            documented.push({
                kind: "deploy-reservations",
                message: `service "${name}" deploy reservations: ${describe(originalService.deploy.resources.reservations)} -> dropped`,
            });
        }
        if (!same(originalService.env_file, generatedService.env_file)) {
            const finding = {
                kind: "env_file",
                message: `service "${name}" env_file: ${describe(originalService.env_file)} -> ${describe(generatedService.env_file)}`,
            };
            if (same(canonicalEnvFile(originalService.env_file), canonicalEnvFile(generatedService.env_file))) {
                documented.push(finding);
            }
            else {
                differences.push(finding);
            }
        }
        const serviceDiffs = [];
        diffValues(`service "${name}"`, canonicalService(originalService, renames, drops), canonicalService(generatedService, renames, drops), serviceDiffs);
        for (const message of serviceDiffs)
            differences.push({ kind: "field", message });
    }
    for (const name of Object.keys(generatedServices)) {
        if (!expectedNames.has(name)) {
            differences.push({
                kind: "service-extra",
                message: `generated file adds service "${name}"`,
            });
        }
    }
    if (!same(original.networks, generated.networks)) {
        documented.push({
            kind: "networks",
            message: `top-level networks: ${describe(original.networks)} -> ${describe(generated.networks)}`,
        });
    }
    const originalProject = original.name ?? "";
    const generatedProject = generated.name ?? originalProject;
    for (const key of new Set([
        ...Object.keys(original.volumes ?? {}),
        ...Object.keys(generated.volumes ?? {}),
    ])) {
        const originalVolume = original.volumes?.[key];
        const generatedVolume = generated.volumes?.[key];
        const named = (volume, project) => isRecord(volume)
            ? { driver: "local", name: `${project}_${key}`, ...volume }
            : { driver: "local", name: `${project}_${key}` };
        const volumeDiffs = [];
        diffValues(`volume "${key}"`, named(originalVolume, originalProject), named(generatedVolume, generatedProject), volumeDiffs);
        for (const message of volumeDiffs)
            differences.push({ kind: "volumes", message });
    }
    for (const field of new Set([...Object.keys(original), ...Object.keys(generated)].filter((key) => !["name", "services", "networks", "volumes"].includes(key)))) {
        const extra = [];
        diffValues(field, original[field], generated[field], extra);
        for (const message of extra)
            differences.push({ kind: "top-level", message });
    }
    return { documented, differences };
}
