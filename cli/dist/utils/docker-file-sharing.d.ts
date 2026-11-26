import type { CheckResult } from "../types/index.js";
import type { DockerRunner } from "./docker-build-cache.js";
import { type DoctorProbeEnvironment } from "./doctor-probe-cache.js";
export declare const DOCKER_FILE_SHARING_CHECK = "Docker File Sharing";
/** Default hard deadline for the bind-mount probe; a wedged file share must not stall doctor. */
export declare const DEFAULT_DOCKER_PROBE_TIMEOUT_MS = 15000;
/** True when `runDockerProbe` stopped `docker run` at its deadline rather than letting it hang. */
export declare function isDockerProbeTimeout(error: unknown): boolean;
interface ProbeChild {
    kill(signal?: NodeJS.Signals | number): boolean;
}
interface ProbeExecError extends Error {
    code?: number | string | null;
    killed?: boolean;
    signal?: string | null;
    stdout?: string;
    stderr?: string;
    fliskDockerProbeTimeout?: boolean;
}
type ProbeExecFile = (file: string, args: string[], options: {
    encoding: "utf-8";
    windowsHide: boolean;
}, callback: (error: ProbeExecError | null, stdout: string, stderr: string) => void) => ProbeChild;
export interface DockerProbeRunOptions {
    /** Hard deadline for `docker run`; default DEFAULT_DOCKER_PROBE_TIMEOUT_MS. */
    timeoutMs?: number;
    /** Injectable process runner for tests. */
    execFileImpl?: ProbeExecFile;
    /**
     * Called after the probe child is killed when doctor itself receives SIGINT/SIGTERM.
     * Defaults to `process.exit` so a bare Ctrl-C keeps its usual exit code.
     */
    onSignal?: (signal: "SIGINT" | "SIGTERM", exitCode: number) => void;
}
/**
 * Runs `docker <args>` under a hard deadline: at `timeoutMs` the child is sent SIGTERM, and after a
 * short grace SIGKILL, because a wedged Docker Desktop can leave `docker run` ignoring SIGTERM.
 * The promise rejects with a `isDockerProbeTimeout` error at the deadline even if the child never
 * exits. While the probe runs, SIGINT/SIGTERM on doctor kill the child first so Ctrl-C does not
 * orphan `docker run`; the signal listeners are removed as soon as the probe settles.
 */
export declare function runDockerProbe(args: string[], options?: DockerProbeRunOptions): Promise<string>;
export interface DockerFileSharingOptions {
    projectRoot?: string;
    runner?: DockerRunner;
    hasDocker?: boolean;
    image?: string;
    /** Inside WSL2 the Docker Desktop "File sharing" setting does not apply; defaults to detecting WSL. */
    isWsl?: boolean;
    /** Hard deadline for the bind-mount probe in milliseconds; default DEFAULT_DOCKER_PROBE_TIMEOUT_MS. */
    timeoutMs?: number;
    /** Recent probe verdicts remembered per project folder, daemon and server version; absent means always probe. */
    probeEnvironment?: DoctorProbeEnvironment | Promise<DoctorProbeEnvironment>;
}
export declare function formatDockerFileSharingFix(projectFolder: string): string;
/**
 * Verifies that Docker can see files in the project folder through a bind mount.
 * When the folder is not shared (Docker Desktop file sharing disabled, Colima without --mount,
 * or remote Docker engine), a container writing into a bind mount silently writes inside
 * the VM while the host folder remains empty.
 */
export declare function checkDockerFileSharing(options?: DockerFileSharingOptions): Promise<CheckResult>;
export {};
