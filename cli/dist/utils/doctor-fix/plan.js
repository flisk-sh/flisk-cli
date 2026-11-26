import { nativeLimaPath, planColimaRepair } from "../colima.js";
import { formatBytes } from "../colima-disk.js";
import { resolveWatcherPath, watcherDirInside, watcherIdentity, } from "../compose-events-watchers.js";
import { DISK_WARN_GIB } from "../doctor-host.js";
import { fliskNetworkOwner, fliskNetworkPrefixes, projectNetworkNames } from "../down-cleanup.js";
import { dockerFixDeps } from "./deps.js";
/** The networks `flisk doctor` creates to test capacity; an interrupted run leaves one behind. */
const PROBE_NETWORK = /^flisk_doctor_probe_(\d+)$/;
/**
 * What `--fix` would do: stop this project's stale Tilt; remove unused networks that are a leftover doctor probe or
 * this project's own (the exact names the engine creates, skipped while its Tilt runs). Other Flisk projects' unused
 * networks are planned only with `context.machine`, each naming its owner.
 */
export async function planDoctorFixes(projectName, deps = dockerFixDeps, context = {}) {
    const actions = [];
    // A Tilt that has run a while without serving its UI is stale and may be stopped; any other Tilt of this project is
    // running or starting, and its networks are not to be touched.
    const liveTilt = [];
    for (const pid of context.tiltPids ?? []) {
        if ((await deps.tiltStatus(pid)) === "stale") {
            actions.push({
                id: `stop-tilt:${pid}`,
                check: "Tilt processes",
                scope: "project",
                command: `kill -TERM ${pid}`,
                status: "planned",
                reason: "this project's Tilt is running but its UI does not answer",
            });
        }
        else {
            liveTilt.push(pid);
        }
    }
    const projectBusy = liveTilt.length > 0
        ? `Tilt is running for this project (pid ${liveTilt.join(", ")}); run flisk down first`
        : undefined;
    // The Docker runtime itself: a Colima VM that is not running, one whose daemon does not
    // answer, or a colima CLI that cannot see the VM. All three look like "Docker is broken".
    const colima = await deps.colimaStatus();
    const repair = planColimaRepair(colima, deps.dockerAnswers());
    if (repair === "start") {
        actions.push({
            id: "colima:start",
            check: "Colima",
            scope: "host",
            command: "colima start",
            status: "planned",
            reason: colima.problem ?? "the Colima VM is not running",
        });
    }
    else if (repair === "restart") {
        actions.push({
            id: "colima:restart",
            check: "Colima",
            scope: "host",
            command: "colima restart",
            status: "planned",
            reason: "the Colima VM is running but its Docker daemon does not answer",
        });
    }
    else if (repair === "native-lima") {
        const nativeDir = nativeLimaPath();
        actions.push({
            id: "colima:native-lima",
            check: "Colima",
            scope: "host",
            command: nativeDir ? `PATH="${nativeDir}:$PATH" colima start` : "brew reinstall lima",
            status: "planned",
            reason: nativeDir
                ? `the colima CLI on this PATH cannot see the VM; a native limactl is installed in ${nativeDir}`
                : "the colima CLI on this PATH cannot see the VM; lima is installed as an x86_64 build (brew reinstall lima)",
        });
    }
    const networks = await deps.listNetworks();
    const freeGib = deps.freeDiskGib();
    if (freeGib !== null && freeGib < DISK_WARN_GIB) {
        const { buildCache, danglingImages } = await deps.reclaimable();
        const low = `${freeGib.toFixed(1)} GB free`;
        if (buildCache && !/^0(\.0+)?\s*B$/i.test(buildCache)) {
            actions.push({
                id: "prune:builder",
                check: "Disk Space",
                scope: "host",
                command: "docker builder prune -f",
                status: "planned",
                reason: `${low}; ${buildCache} of build cache reclaimable`,
            });
        }
        if (danglingImages > 0) {
            actions.push({
                id: "prune:images",
                check: "Disk Space",
                scope: "host",
                command: "docker image prune -f",
                status: "planned",
                reason: `${low}; ${danglingImages} untagged image${danglingImages === 1 ? "" : "s"}`,
            });
        }
        // Docker's data lives in the Colima VM; its disk image does not shrink by itself, so the freed space stays
        // unavailable to macOS until the VM trims it. This runs after the prunes above.
        const colima = await deps.colimaStatus();
        if (colima.isColima && colima.running) {
            actions.push({
                id: "trim:colima",
                check: "Disk Space",
                scope: "host",
                command: "colima ssh -- sudo fstrim -av",
                status: "planned",
                reason: `${low}; Docker data lives in the Colima VM, whose disk image keeps its size on the Mac until it is trimmed`,
            });
        }
    }
    // The disk can be fine and the Colima disk file still hold several times what Docker uses (a prune done by hand).
    if (!actions.some((action) => action.id === "trim:colima")) {
        const bloat = await deps.colimaDiskBloat?.();
        if (bloat) {
            actions.push({
                id: "trim:colima",
                check: "Colima Disk",
                scope: "host",
                command: "colima ssh -- sudo fstrim -av",
                status: "planned",
                reason: `the Colima disk file takes ${formatBytes(bloat.diskFileBytes)} on the Mac while Docker uses ${formatBytes(bloat.dockerBytes)}`,
            });
        }
    }
    const own = new Set(projectName ? projectNetworkNames(projectName) : []);
    const prefixes = fliskNetworkPrefixes(networks.map((network) => network.name));
    for (const network of networks) {
        const probe = PROBE_NETWORK.exec(network.name);
        let scope;
        let check;
        let reason = "unused network";
        if (probe) {
            scope = "probe";
            check = "Orphaned probe networks";
        }
        else if (own.has(network.name)) {
            scope = "project";
            check = "Docker networks";
        }
        else if (context.machine && fliskNetworkOwner(network.name, prefixes)) {
            scope = "machine";
            check = "Docker networks";
            reason = `unused network of project "${fliskNetworkOwner(network.name, prefixes)}"`;
        }
        else {
            continue;
        }
        const action = {
            id: `remove-network:${network.name}`,
            check,
            scope,
            command: `docker network rm ${network.name}`,
            status: "planned",
            reason,
        };
        if (network.containers > 0) {
            action.status = "skipped";
            action.reason = `${network.containers} container(s) still attached`;
        }
        else if (scope === "project" && projectBusy) {
            // A starting stack creates its networks before any container joins them, so "unused" is not safe to remove.
            action.status = "skipped";
            action.reason = projectBusy;
        }
        else if (probe && deps.isProcessAlive(Number(probe[1]))) {
            // The doctor run that created it may still be using it.
            action.status = "skipped";
            action.reason = `probe of a running process (pid ${probe[1]})`;
        }
        actions.push(action);
    }
    // `docker compose ... events --json` streams survive `flisk down`, exited containers and deleted project folders.
    // This project's orphans repair at the default scope; every other project's (a deleted folder's owner is unknown)
    // waits for `--scope=machine`, like the unused-networks repair.
    const watchers = deps.composeEventOrphans ? await deps.composeEventOrphans() : null;
    const thisProject = context.projectRoot ? resolveWatcherPath(context.projectRoot) : undefined;
    for (const watcher of watchers ?? []) {
        // A known owner decides; directory containment only stands in when the owner is unknown (a deleted folder), so a
        // separate Flisk project below this one stays another project's.
        const ownProject = thisProject !== undefined &&
            (watcher.owningRoot !== undefined
                ? resolveWatcherPath(watcher.owningRoot) === thisProject
                : watcher.projectDir !== undefined && watcherDirInside(watcher.projectDir, thisProject));
        if (!ownProject && !context.machine)
            continue;
        actions.push({
            id: `stop-compose-events:${watcher.pid}:${watcherIdentity(watcher)}`,
            check: "Compose event watchers",
            scope: ownProject ? "project" : "machine",
            command: `kill -TERM ${watcher.pid}`,
            status: "planned",
            reason: `event stream of compose project "${watcher.projectName ?? "unknown"}" (${watcher.gone})`,
        });
    }
    return actions;
}
