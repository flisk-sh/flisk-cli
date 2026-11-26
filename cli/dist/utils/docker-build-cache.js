// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { diskThresholds, readHostFreeGib } from "./disk-guard.js";
import { FliskError } from "./errors.js";
import { findOnPath } from "./which.js";
const execFilePromise = promisify(execFile);
const DOCKER_TIMEOUT_MS = 15_000;
export const DOCKER_BUILD_CACHE_CHECK = "Docker Build Cache";
/** Keep this threshold in GiB (1 GiB = 1024 ** 3 bytes), matching DISK_WARN_GIB from #2362. */
export const DOCKER_BUILD_CACHE_WARN_GIB = 10;
/** `docker system df` takes 0.7-1.4 s and sizes images/volumes too; doctor reuses its answer this long (#3844). */
export const DOCTOR_BUILD_CACHE_TTL_MS = 10 * 60 * 1000;
const DOCTOR_BUILD_CACHE_STAMP = "docker-build-cache.json";
export const defaultDockerRunner = async (args) => {
    const { stdout } = await execFilePromise("docker", args, {
        encoding: "utf-8",
        timeout: DOCKER_TIMEOUT_MS,
        windowsHide: true,
    });
    return stdout;
};
/** Parses human size strings, using SI for kB/MB/GB/TB and IEC for KiB/MiB/GiB/TiB. */
export function parseSizeToBytes(raw) {
    const match = raw.trim().match(/^([\d.]+)\s*([a-zA-Z]+)?$/);
    if (!match)
        return 0;
    const num = Number.parseFloat(match[1] ?? "0");
    if (!Number.isFinite(num))
        return 0;
    const unit = (match[2] ?? "B").toUpperCase();
    switch (unit) {
        case "B":
            return num;
        case "KB":
            return num * 1000;
        case "MB":
            return num * 1000 ** 2;
        case "GB":
            return num * 1000 ** 3;
        case "TB":
            return num * 1000 ** 4;
        case "K":
        case "KIB":
            return num * 1024;
        case "M":
        case "MIB":
            return num * 1024 ** 2;
        case "G":
        case "GIB":
            return num * 1024 ** 3;
        case "T":
        case "TIB":
            return num * 1024 ** 4;
        default:
            return num;
    }
}
/**
 * Parses `docker system df --format "{{.Type}}\t{{.TotalCount}}\t{{.Size}}\t{{.Reclaimable}}"` output.
 */
export function parseDockerBuildCache(dfOutput) {
    for (const line of dfOutput.split(/\r?\n/)) {
        const parts = line.split("\t");
        const type = (parts[0] ?? "").trim();
        if (type.toLowerCase() === "build cache") {
            const entries = Number.parseInt((parts[1] ?? "").trim(), 10) || 0;
            const rawSize = (parts[2] ?? "").trim() || "0B";
            const rawReclaimable = (parts[3] ?? "").replace(/\([^()]*\)/, "").trim() || "0B";
            const sizeBytes = parseSizeToBytes(rawSize);
            const reclaimableBytes = parseSizeToBytes(rawReclaimable);
            return {
                size: rawSize,
                sizeBytes,
                sizeGib: sizeBytes / 1024 ** 3,
                entries,
                reclaimable: rawReclaimable,
                reclaimableBytes,
            };
        }
    }
    return null;
}
function doctorBuildCachePath(home) {
    return join(home, ".flisk", "cache", DOCTOR_BUILD_CACHE_STAMP);
}
function readDoctorBuildCache(home, now, daemon) {
    try {
        const raw = JSON.parse(readFileSync(doctorBuildCachePath(home), "utf-8"));
        const report = raw.report;
        const usage = raw.usage;
        if (typeof raw.checkedAt !== "number" ||
            typeof raw.daemon !== "string" ||
            !report ||
            typeof report.size !== "string" ||
            typeof report.entries !== "number" ||
            typeof report.reclaimable !== "string" ||
            !usage ||
            typeof usage.imageBytes !== "number" ||
            typeof usage.reclaimableBytes !== "number" ||
            typeof usage.totalBytes !== "number") {
            return undefined;
        }
        const ageMs = now - raw.checkedAt;
        if (ageMs < 0 || ageMs >= DOCTOR_BUILD_CACHE_TTL_MS || raw.daemon !== daemon)
            return undefined;
        return {
            report: { size: report.size, entries: report.entries, reclaimable: report.reclaimable },
            usage: {
                imageBytes: usage.imageBytes,
                reclaimableBytes: usage.reclaimableBytes,
                totalBytes: usage.totalBytes,
            },
            ageMs,
        };
    }
    catch {
        // No stamp, or an unreadable one: ask Docker as before.
        return undefined;
    }
}
function writeDoctorBuildCache(home, stamp) {
    try {
        mkdirSync(join(home, ".flisk", "cache"), { recursive: true });
        writeFileSync(doctorBuildCachePath(home), JSON.stringify(stamp));
    }
    catch {
        // Best effort: without a stamp the next doctor run checks Docker again.
    }
}
/** An explicit prune changes the value, so the next doctor run must not report the old one. */
function clearDoctorBuildCache(home) {
    try {
        rmSync(doctorBuildCachePath(home), { force: true });
    }
    catch {
        // Best effort: an unreadable stamp simply makes the next check ask Docker again.
    }
}
function formatCheckedAge(ageMs) {
    const minutes = Math.floor(ageMs / 60_000);
    return minutes < 1 ? "checked just now" : `checked ${minutes} min ago`;
}
function buildCacheResult(report, dockerUsage, ageMs) {
    const sizeBytes = parseSizeToBytes(report.size);
    const entryLabel = report.entries === 1 ? "entry" : "entries";
    const checked = ageMs === undefined ? "" : ` (${formatCheckedAge(ageMs)})`;
    if (sizeBytes / 1024 ** 3 >= DOCKER_BUILD_CACHE_WARN_GIB) {
        return {
            name: DOCKER_BUILD_CACHE_CHECK,
            didPass: false,
            isWarning: true,
            message: `${report.size} across ${report.entries} ${entryLabel}: Docker build cache exceeds ${DOCKER_BUILD_CACHE_WARN_GIB} GiB threshold. Cache is shared across all projects on this machine${checked}`,
            fix: "Prune old build cache: flisk down --prune-cache (or docker builder prune --filter until=24h). Note: this affects other projects on this machine.",
            buildCache: report,
            dockerUsage,
        };
    }
    const shown = report.entries === 0 || sizeBytes === 0
        ? "0 B in 0 entries (Docker build cache is empty)"
        : `${report.size} across ${report.entries} ${entryLabel} (shared across all projects on this machine)`;
    return {
        name: DOCKER_BUILD_CACHE_CHECK,
        didPass: true,
        message: `${shown}${checked}`,
        buildCache: report,
        dockerUsage,
    };
}
/**
 * Parses every row of `docker system df --format "{{.Type}}\t{{.TotalCount}}\t{{.Size}}\t{{.Reclaimable}}"`
 * into byte counts. The Reclaimable column may carry a "(n%)" suffix, which is ignored.
 */
export function parseDockerUsage(dfOutput) {
    const report = { imageBytes: 0, reclaimableBytes: 0, totalBytes: 0 };
    for (const line of dfOutput.split(/\r?\n/)) {
        const parts = line.split("\t");
        if (parts.length < 3)
            continue;
        const sizeBytes = parseSizeToBytes((parts[2] ?? "").trim());
        report.totalBytes += sizeBytes;
        const reclaimable = parts[3] ?? "";
        const paren = reclaimable.indexOf("(");
        report.reclaimableBytes += parseSizeToBytes((paren === -1 ? reclaimable : reclaimable.slice(0, paren)).trim());
        if ((parts[0] ?? "").trim().toLowerCase() === "images") {
            report.imageBytes += sizeBytes;
        }
    }
    return report;
}
/**
 * Checks the size of Docker's build cache and warns if it exceeds DOCKER_BUILD_CACHE_WARN_GIB.
 * Doctor reuses a successful answer for DOCTOR_BUILD_CACHE_TTL_MS; checks that act on the value
 * pass `live` so they always read the current size.
 */
export async function checkDockerBuildCache(runner = defaultDockerRunner, hasDocker = Boolean(findOnPath("docker")), options = {}) {
    if (!hasDocker) {
        return {
            name: DOCKER_BUILD_CACHE_CHECK,
            didPass: false,
            message: "Docker CLI not found",
            fix: "Install Docker: https://docs.docker.com/get-docker/",
        };
    }
    const home = options.home ?? homedir();
    const now = options.now ?? Date.now;
    const daemon = options.daemon ?? dockerDaemonIdentity(undefined, home);
    if (!options.live) {
        const cached = readDoctorBuildCache(home, now(), daemon);
        if (cached)
            return buildCacheResult(cached.report, cached.usage, cached.ageMs);
    }
    let stdout;
    try {
        stdout = await runner([
            "system",
            "df",
            "--format",
            "{{.Type}}\t{{.TotalCount}}\t{{.Size}}\t{{.Reclaimable}}",
        ]);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
            name: DOCKER_BUILD_CACHE_CHECK,
            didPass: true,
            isSkipped: true,
            message: `Could not read Docker build cache: ${msg.split(/\r?\n/)[0]}`,
        };
    }
    const info = parseDockerBuildCache(stdout);
    if (!info) {
        return {
            name: DOCKER_BUILD_CACHE_CHECK,
            didPass: true,
            isSkipped: true,
            message: "Could not parse Docker build cache information",
        };
    }
    const buildCache = {
        size: info.size,
        entries: info.entries,
        reclaimable: info.reclaimable,
    };
    const dockerUsage = parseDockerUsage(stdout);
    if (!options.live) {
        writeDoctorBuildCache(home, {
            checkedAt: now(),
            daemon,
            report: buildCache,
            usage: dockerUsage,
        });
    }
    return buildCacheResult(buildCache, dockerUsage);
}
/** Validates that the age filter is safe (e.g. "24h", "7d", "168h", "30m", or ISO date). */
export function validateCacheUntil(until) {
    if (!until || typeof until !== "string")
        return false;
    const trimmed = until.trim();
    // Duration format like 24h, 7d, 2h30m, 168h
    if (/^(\d+[hmsd])+$/i.test(trimmed))
        return true;
    // ISO date format like 2026-10-01 or 2026-10-01T00:00:00
    if (/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)?$/.test(trimmed))
        return true;
    return false;
}
/**
 * Converts a validated age filter into a value Docker accepts for `until=`. Docker parses
 * durations with Go's time.ParseDuration, which has no "d" unit and is case-sensitive, so
 * days become hours (7d -> 168h, 1d12h -> 36h) and units are lowercased (24H -> 24h).
 * ISO dates and anything else pass through unchanged (T and Z keep their case).
 */
export function normalizeCacheUntil(until) {
    const trimmed = until.trim();
    if (!/^(\d+[hmsd])+$/i.test(trimmed))
        return trimmed;
    let hours = 0n;
    let rest = "";
    for (const match of trimmed.matchAll(/(\d+)([hmsd])/gi)) {
        const value = BigInt(match[1] ?? "0");
        const unit = (match[2] ?? "").toLowerCase();
        if (unit === "d" || unit === "h") {
            hours += unit === "d" ? value * 24n : value;
        }
        else {
            rest += `${value}${unit}`;
        }
    }
    return `${hours > 0n || !rest ? `${hours}h` : ""}${rest}`;
}
/** Parses reclaimed size from `docker builder prune` output. */
export function parseReclaimedFromPrune(stdout) {
    const match = stdout.match(/(?:Total reclaimed space|Total):\s*([0-9.]+\s*[a-zA-Z]+)/i);
    return match?.[1]?.trim() ?? "0 B";
}
/**
 * Prunes Docker build cache using `docker builder prune -f --filter until=<age>`.
 */
export async function pruneDockerBuildCache(options = {}) {
    const until = options.until ?? "24h";
    if (!validateCacheUntil(until)) {
        throw new FliskError(`Invalid --cache-until format: "${until}"`, [
            "Use a duration such as 24h, 168h, 7d, or 2h30m",
        ]);
    }
    const runner = options.runner ?? defaultDockerRunner;
    const normalized = normalizeCacheUntil(until);
    const stdout = await runner(["builder", "prune", "-f", "--filter", `until=${normalized}`]);
    clearDoctorBuildCache(options.home ?? homedir());
    const reclaimed = parseReclaimedFromPrune(stdout);
    return { reclaimed, until: normalized };
}
/** The build cache is trimmed on `flisk up` when it grows past this many GiB. `0` turns the ceiling off. */
export const DEFAULT_BUILD_CACHE_CEILING_GIB = 20;
export const BUILD_CACHE_CEILING_ENV = "FLISK_BUILD_CACHE_MAX_GIB";
export function resolveBuildCacheCeilingGib(env = process.env) {
    const raw = env[BUILD_CACHE_CEILING_ENV];
    if (raw === undefined || raw.trim() === "")
        return DEFAULT_BUILD_CACHE_CEILING_GIB;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : DEFAULT_BUILD_CACHE_CEILING_GIB;
}
/** `docker system df` takes 0.8-1.3 s; the ceiling is checked at most this often while the cache is well below it. */
export const BUILD_CACHE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** A last-seen size above this share of the ceiling is re-checked on every `flisk up`; the rest is room to grow in one window. */
export const BUILD_CACHE_NEAR_CEILING_RATIO = 0.5;
const BUILD_CACHE_STAMP = "build-cache-check.json";
/** Which Docker daemon `docker` talks to, so a size measured on one is never trusted for another. */
export function dockerDaemonIdentity(env = process.env, home = homedir()) {
    let context = env.DOCKER_CONTEXT ?? "";
    if (!context) {
        try {
            const configDir = env.DOCKER_CONFIG ?? join(home, ".docker");
            const config = JSON.parse(readFileSync(join(configDir, "config.json"), "utf-8"));
            context = config.currentContext ?? "";
        }
        catch {
            // No docker config: the default context.
        }
    }
    return `${env.DOCKER_HOST ?? ""}|${context || "default"}`;
}
function stampPath(home) {
    return join(home, ".flisk", BUILD_CACHE_STAMP);
}
function readStamp(home) {
    try {
        const raw = JSON.parse(readFileSync(stampPath(home), "utf-8"));
        if (typeof raw.checkedAt === "number" &&
            typeof raw.sizeGib === "number" &&
            typeof raw.daemon === "string") {
            return { checkedAt: raw.checkedAt, sizeGib: raw.sizeGib, daemon: raw.daemon };
        }
    }
    catch {
        // No stamp, or an unreadable one: check the cache.
    }
    return undefined;
}
function writeStamp(home, stamp) {
    try {
        mkdirSync(join(home, ".flisk"), { recursive: true });
        writeFileSync(stampPath(home), JSON.stringify(stamp));
    }
    catch {
        // Best effort: without a stamp the next `flisk up` simply checks again.
    }
}
/**
 * Keeps the shared BuildKit cache from growing without a limit: when it is above the ceiling, the least recently used
 * entries are removed until it fits. Best effort; a Docker that cannot be asked leaves the cache as it is.
 */
export async function enforceBuildCacheCeiling(run = defaultDockerRunner, env = process.env, options = {}) {
    const ceilingGib = resolveBuildCacheCeilingGib(env);
    if (ceilingGib === 0)
        return { pruned: false, ceilingGib };
    const home = options.home ?? homedir();
    const now = options.now ?? Date.now;
    // The check costs about a second and almost always finds nothing to do: skip it while the last check was recent and
    // the cache was far below the ceiling. Near or above the ceiling it runs every time, so the disk guard still sees a trim.
    // It is also run whenever free host disk is below the disk guard's warning level (or unreadable), so a trim that the
    // guard depends on is never skipped, and a stamp from another Docker daemon is never trusted.
    const daemon = options.daemon ?? dockerDaemonIdentity(env, home);
    const last = readStamp(home);
    const age = last ? now() - last.checkedAt : -1;
    const hostFreeGib = options.hostFreeGib === undefined ? readHostFreeGib(undefined, home) : options.hostFreeGib;
    const isDiskComfortable = hostFreeGib !== null && hostFreeGib >= diskThresholds(env).warnBelowGib;
    if (last &&
        isDiskComfortable &&
        last.daemon === daemon &&
        age >= 0 &&
        age < BUILD_CACHE_CHECK_INTERVAL_MS &&
        last.sizeGib < ceilingGib * BUILD_CACHE_NEAR_CEILING_RATIO) {
        return { pruned: false, ceilingGib, sizeGib: last.sizeGib, skipped: true };
    }
    try {
        const df = await run([
            "system",
            "df",
            "--format",
            "{{.Type}}\t{{.TotalCount}}\t{{.Size}}\t{{.Reclaimable}}",
        ]);
        const sizeGib = parseDockerBuildCache(df)?.sizeGib;
        if (sizeGib !== undefined)
            writeStamp(home, { checkedAt: now(), sizeGib, daemon });
        if (sizeGib === undefined || sizeGib <= ceilingGib)
            return { pruned: false, ceilingGib, sizeGib };
        await run([
            "builder",
            "prune",
            "-f",
            "--keep-storage",
            String(Math.round(ceilingGib * 1024 ** 3)),
        ]);
        writeStamp(home, { checkedAt: now(), sizeGib: ceilingGib, daemon });
        return { pruned: true, ceilingGib, sizeGib };
    }
    catch {
        return { pruned: false, ceilingGib };
    }
}
