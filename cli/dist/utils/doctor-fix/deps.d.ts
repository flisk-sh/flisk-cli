import type { CheckResult } from "../../types/index.js";
import { type ColimaStatus } from "../colima.js";
import { type OrphanedEventsWatcher } from "../compose-events-watchers.js";
export interface DockerNetwork {
    name: string;
    /** Containers attached; a network with any is in use and is never planned for removal. */
    containers: number;
}
/** The Docker calls the fixes need, injectable so tests need no daemon. */
export interface DoctorFixDeps {
    listNetworks(): Promise<DockerNetwork[]>;
    removeNetwork(name: string): Promise<void>;
    isProcessAlive(pid: number): boolean;
    /** Whether a Tilt process serves its UI: `stale` only when it has run a while and nothing it listens on answers. */
    tiltStatus(pid: number): Promise<"healthy" | "stale" | "unknown">;
    stopProcess(pid: number): void;
    /** Free GiB on the disk Docker data lives on (the home directory's), or null when unreadable. */
    freeDiskGib(): number | null;
    /** What `docker builder prune` and `docker image prune` (dangling only) would reclaim. */
    reclaimable(): Promise<{
        buildCache: string | null;
        danglingImages: number;
    }>;
    prune(kind: "builder" | "images"): Promise<void>;
    /**
     * Gives the space Docker freed inside the Colima VM back to the host. Pruning only frees space inside the VM; its disk
     * image keeps its size on the Mac until the free blocks are trimmed (`fstrim`).
     */
    trimColima(): Promise<void>;
    /** Starts, restarts, or repairs (native lima) the Colima VM, with a native limactl first on PATH when there is one. */
    colima(action: "start" | "restart" | "native-lima"): Promise<void>;
    /** The state of the Colima VM behind Docker. */
    colimaStatus(): ColimaStatus | Promise<ColimaStatus>;
    /** Whether the Docker daemon answers right now. */
    dockerAnswers(): boolean;
    /** Colima's disk file on the Mac against Docker's own usage, when the disk file is over 3x what Docker holds. */
    colimaDiskBloat?(): Promise<{
        diskFileBytes: number;
        dockerBytes: number;
    } | null>;
    /**
     * Orphaned Flisk `docker compose ... events --json` watchers: a deleted project directory, or no running
     * container of the Compose project and no `tilt up` owning it. Null when neither the process table nor Docker
     * can be read, because then nothing proves an orphan.
     */
    composeEventOrphans?(): Promise<OrphanedEventsWatcher[] | null>;
    /**
     * Kills a Compose event watcher (SIGTERM) after proving it is still the planned one and still orphaned. Pids are
     * reused and a project can start between the scan and the repair (the confirmation prompt waits); `identity` is the
     * planned watcher's {@link watcherIdentity}. Defaults to `stopProcess` when absent (tests and embedders that
     * already revalidate).
     */
    stopComposeWatcher?(pid: number, identity?: string): Promise<void> | void;
}
type DockerRunner = (args: string[]) => Promise<string>;
/** `ps -o etime=` ("[[dd-]hh:]mm:ss") in seconds. */
export declare function parseElapsed(etime: string): number | null;
/**
 * Whether any of `ports` answers as a Tilt UI. A busy Tilt can miss one request, and a wrong "stale" ends in a kill,
 * so a port gets a second try before it counts as silent.
 */
export declare function anyTiltAnswers(ports: number[], probe?: (port: number) => Promise<string | null>, attempts?: number, wait?: (ms: number) => Promise<void>): Promise<boolean>;
export declare function createDockerFixDeps(run?: DockerRunner): DoctorFixDeps;
export declare const dockerFixDeps: DoctorFixDeps;
export type ColimaRunner = (file: string, args: string[], options: {
    encoding: "utf-8";
    timeout: number;
    env?: NodeJS.ProcessEnv;
}) => Promise<unknown>;
/** Starts or restarts Colima, with a native limactl first on PATH when one is installed. */
export declare function runColima(action: "start" | "restart" | "native-lima", run?: ColimaRunner, findNativeLima?: () => string | undefined | null, hasFile?: (path: string) => boolean): Promise<void>;
export interface FliskInstall {
    path: string;
    version: string | null;
}
/** Every distinct `flisk` on PATH (symlinks to one binary count once), in PATH order. */
export declare function findFliskInstalls(paths?: string[], readVersion?: (path: string) => Promise<string | null>): Promise<FliskInstall[]>;
/** Two `flisk` binaries can disagree (a dashboard or MCP client may launch the older one), so say which is which. */
export declare function checkDuplicateFliskInstalls(installs?: FliskInstall[]): Promise<CheckResult>;
/**
 * PIDs of `tilt up` processes for this project. The process list shows the Tiltfile path as it was typed at launch,
 * which may or may not be the symlink-resolved path, so both spellings are looked up.
 */
export declare function projectTiltPids(projectRoot: string, find?: (tiltfilePath: string) => number[]): number[];
export {};
