// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { execFile, execFileSync } from "node:child_process";
import { existsSync, realpathSync, statfsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { checkColimaAsync, nativeLimaPath } from "../colima.js";
import { isColimaDiskBloated, readColimaDisk, runColimaTrim } from "../colima-disk.js";
import { eventsTiltPids, findOrphanedComposeEventsWatchers, listComposeEventsWatchers, stillComposeEventsWatcher, watcherIdentity, } from "../compose-events-watchers.js";
import { findProjectTiltUpPids } from "../down-cleanup.js";
import { FliskError } from "../errors.js";
import { tiltGetUiResources } from "../up-readiness.js";
import { findAllOnPath, findOnPath } from "../which.js";
const execFilePromise = promisify(execFile);
const DOCKER_TIMEOUT_MS = 15_000;
const runDocker = async (args) => {
    const { stdout } = await execFilePromise("docker", args, {
        encoding: "utf-8",
        timeout: DOCKER_TIMEOUT_MS,
        windowsHide: true,
    });
    return stdout;
};
/** Whether the Docker daemon answers right now. */
function dockerAnswers() {
    try {
        execFileSync(findOnPath("docker") ?? "docker", ["info", "--format", "{{.ServerVersion}}"], {
            encoding: "utf-8",
            timeout: 15_000,
            stdio: ["ignore", "pipe", "ignore"],
        });
        return true;
    }
    catch {
        return false;
    }
}
function firstLine(error) {
    const stderr = String(error.stderr ?? error).trim();
    return stderr.split(/\r?\n/)[0] ?? "";
}
const STALE_TILT_MIN_AGE_S = 120;
/** `ps -o etime=` ("[[dd-]hh:]mm:ss") in seconds. */
export function parseElapsed(etime) {
    const match = /^\s*(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)\s*$/.exec(etime);
    if (!match)
        return null;
    const [, days = "0", hours = "0", minutes = "0", seconds = "0"] = match;
    return ((Number(days) * 24 + Number(hours)) * 60 + Number(minutes)) * 60 + Number(seconds);
}
/**
 * Whether any of `ports` answers as a Tilt UI. A busy Tilt can miss one request, and a wrong "stale" ends in a kill,
 * so a port gets a second try before it counts as silent.
 */
export async function anyTiltAnswers(ports, probe = tiltGetUiResources, attempts = 2, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {
    for (let attempt = 0; attempt < attempts; attempt++) {
        if (attempt > 0)
            await wait(1000);
        for (const port of ports) {
            if ((await probe(port)) !== null)
                return true;
        }
    }
    return false;
}
async function tiltProcessStatus(pid) {
    if (process.platform === "win32")
        return "unknown";
    try {
        const { stdout: etime } = await execFilePromise("ps", ["-p", String(pid), "-o", "etime="], {
            encoding: "utf-8",
            timeout: 5000,
        });
        const age = parseElapsed(etime);
        // A Tilt that is still starting has not bound its port yet.
        if (age === null || age < STALE_TILT_MIN_AGE_S)
            return "unknown";
        const { stdout } = await execFilePromise("lsof", ["-nP", "-a", "-p", String(pid), "-iTCP", "-sTCP:LISTEN", "-Fn"], { encoding: "utf-8", timeout: 5000 });
        const ports = [...stdout.matchAll(/^n.*:(\d+)$/gm)].map((m) => Number(m[1]));
        return (await anyTiltAnswers(ports)) ? "healthy" : "stale";
    }
    catch {
        // No lsof, or the process is gone: do not guess.
        return "unknown";
    }
}
export function createDockerFixDeps(run = runDocker) {
    return {
        colima: runColima,
        colimaStatus: () => checkColimaAsync(),
        async colimaDiskBloat() {
            const report = await readColimaDisk();
            return report && isColimaDiskBloated(report) ? report : null;
        },
        dockerAnswers,
        async listNetworks() {
            const names = (await run(["network", "ls", "--format", "{{.Name}}"]))
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean);
            // One inspect per network: another process (a doctor probe, `flisk down`) can remove one mid-listing, and a
            // batched inspect would then fail for all of them.
            const inspected = await Promise.all(names.map(async (name) => {
                try {
                    const count = await run([
                        "network",
                        "inspect",
                        "--format",
                        "{{len .Containers}}",
                        name,
                    ]);
                    return { name, containers: Number(count.trim()) || 0 };
                }
                catch (error) {
                    if (/no such network|not found/i.test(String(error)))
                        return null;
                    throw error;
                }
            }));
            return inspected.filter((network) => network !== null);
        },
        async removeNetwork(name) {
            try {
                await run(["network", "rm", name]);
            }
            catch (error) {
                throw new FliskError(firstLine(error), [
                    `See what still uses it with: docker network inspect ${name}`,
                    `Remove it by hand with: docker network rm ${name}`,
                ]);
            }
        },
        freeDiskGib() {
            try {
                const stats = statfsSync(homedir());
                return (Number(stats.bavail) * Number(stats.bsize)) / 1024 ** 3;
            }
            catch {
                return null;
            }
        },
        async reclaimable() {
            let buildCache = null;
            try {
                const df = await run(["system", "df", "--format", "{{.Type}}\t{{.Reclaimable}}"]);
                for (const line of df.split(/\r?\n/)) {
                    const [type, size] = line.split("\t");
                    // "1.531GB" or "1.5GB (39%)"; the percentage is of the whole, not useful here.
                    if (type === "Build Cache" && size)
                        buildCache = size
                            .trim()
                            .replace(/\([^()]*\)$/, "")
                            .trim();
                }
            }
            catch {
                // Leave unknown.
            }
            let danglingImages = 0;
            try {
                const ids = await run(["images", "-q", "-f", "dangling=true"]);
                danglingImages = ids.split(/\r?\n/).filter(Boolean).length;
            }
            catch {
                // Leave zero.
            }
            return { buildCache, danglingImages };
        },
        async prune(kind) {
            try {
                // Never `volume prune`, never `-a`: only the build cache and untagged images.
                await run(kind === "builder" ? ["builder", "prune", "-f"] : ["image", "prune", "-f"]);
            }
            catch (error) {
                throw new FliskError(firstLine(error), [
                    `Run it by hand: docker ${kind === "builder" ? "builder" : "image"} prune -f`,
                    "Check the container engine with: flisk doctor",
                ]);
            }
        },
        trimColima: runColimaTrim,
        async composeEventOrphans() {
            const watchers = listComposeEventsWatchers();
            if (watchers === null)
                return null;
            let runningProjects = null;
            try {
                runningProjects = new Set((await run(["ps", "--format", '{{.Label "com.docker.compose.project"}}']))
                    .split(/\r?\n/)
                    .map((line) => line.trim())
                    .filter(Boolean));
            }
            catch {
                // Docker cannot be asked: nothing proves an orphan then, so the scan reports null.
            }
            return findOrphanedComposeEventsWatchers({
                watchers,
                runningProjects,
                tiltPids: eventsTiltPids,
            });
        },
        async tiltStatus(pid) {
            return tiltProcessStatus(pid);
        },
        stopProcess(pid) {
            process.kill(pid, "SIGTERM");
        },
        async stopComposeWatcher(pid, identity) {
            // The pid came from a scan that may be minutes old; it can belong to an unrelated process now.
            if (!stillComposeEventsWatcher(pid)) {
                throw new FliskError(`pid ${pid} is no longer a "docker compose events" watcher`, [
                    "Run flisk doctor again so it scans the live watchers",
                ]);
            }
            // A project may have started while the repair waited for confirmation, and the pid may now be another stream:
            // scan again and require the same watcher to be orphaned by the same rules as at plan time.
            const orphans = (await this.composeEventOrphans?.()) ?? null;
            const stillOrphaned = orphans?.some((orphan) => orphan.pid === pid && (identity === undefined || watcherIdentity(orphan) === identity));
            if (!stillOrphaned) {
                throw new FliskError(`pid ${pid} is no longer an orphaned "docker compose events" watcher`, ["Run flisk doctor again so it scans the live watchers"]);
            }
            process.kill(pid, "SIGTERM");
        },
        isProcessAlive(pid) {
            try {
                process.kill(pid, 0);
                return true;
            }
            catch (error) {
                // EPERM means the process exists but belongs to someone else.
                return error.code === "EPERM";
            }
        },
    };
}
export const dockerFixDeps = createDockerFixDeps();
/** Starts or restarts Colima, with a native limactl first on PATH when one is installed. */
export async function runColima(action, run = execFilePromise, findNativeLima = nativeLimaPath, hasFile = existsSync) {
    if (action === "native-lima") {
        let nativeDir = findNativeLima();
        if (!nativeDir) {
            // No native limactl on PATH: reinstall Lima through the native Homebrew, which pulls a native build on Apple Silicon.
            const brewBin = hasFile("/opt/homebrew/bin/brew") ? "/opt/homebrew/bin/brew" : "brew";
            await run(brewBin, ["reinstall", "lima"], {
                encoding: "utf-8",
                timeout: 300_000,
            });
            nativeDir = findNativeLima();
            if (!nativeDir) {
                throw new FliskError("brew reinstall lima did not provide a native limactl", [
                    "Reinstall Lima with the arm64 Homebrew in /opt/homebrew: brew reinstall lima",
                    "Check the container engine with: flisk doctor",
                ]);
            }
        }
        const env = nativeDir
            ? { ...process.env, PATH: `${nativeDir}:${process.env.PATH ?? ""}` }
            : process.env;
        await run("colima", ["start"], { encoding: "utf-8", timeout: 300_000, env });
        return;
    }
    const nativeDir = findNativeLima();
    const env = nativeDir
        ? { ...process.env, PATH: `${nativeDir}:${process.env.PATH ?? ""}` }
        : process.env;
    await run("colima", [action], { encoding: "utf-8", timeout: 300_000, env });
}
async function readFliskVersion(path) {
    try {
        const { stdout } = await execFilePromise(path, ["--version"], {
            encoding: "utf-8",
            timeout: 5000,
            windowsHide: true,
        });
        return stdout.trim().split(/\r?\n/)[0] || null;
    }
    catch {
        return null;
    }
}
/** Every distinct `flisk` on PATH (symlinks to one binary count once), in PATH order. */
export async function findFliskInstalls(paths = findAllOnPath("flisk"), readVersion = readFliskVersion) {
    const seen = new Set();
    const installs = [];
    for (const path of paths) {
        let real = path;
        try {
            real = realpathSync(path);
        }
        catch {
            // Keep the PATH entry as is.
        }
        if (seen.has(real))
            continue;
        seen.add(real);
        installs.push({ path, version: await readVersion(path) });
    }
    return installs;
}
/** Two `flisk` binaries can disagree (a dashboard or MCP client may launch the older one), so say which is which. */
export async function checkDuplicateFliskInstalls(installs) {
    const found = installs ?? (await findFliskInstalls());
    if (found.length <= 1) {
        return { name: "Flisk installs", didPass: true, message: "One flisk install on PATH" };
    }
    const list = found.map((i) => `${i.path} (${i.version ?? "version unknown"})`).join(", ");
    const versions = new Set(found.map((i) => i.version));
    return {
        name: "Flisk installs",
        didPass: false,
        isWarning: true,
        message: `${found.length} flisk installs on PATH${versions.size > 1 ? " with different versions" : ""}: ${list}`,
        fix: "Keep one: remove the others, or run flisk upgrade. The first on PATH is the one your shell runs; tools that launch /usr/local/bin/flisk directly may use another",
    };
}
/**
 * PIDs of `tilt up` processes for this project. The process list shows the Tiltfile path as it was typed at launch,
 * which may or may not be the symlink-resolved path, so both spellings are looked up.
 */
export function projectTiltPids(projectRoot, find = findProjectTiltUpPids) {
    const roots = new Set([projectRoot]);
    try {
        roots.add(realpathSync(projectRoot));
    }
    catch {
        // Keep the path as given.
    }
    const pids = new Set();
    for (const root of roots) {
        for (const pid of find(join(root, ".flisk", ".flisk-out", "Tiltfile")))
            pids.add(pid);
    }
    return [...pids];
}
