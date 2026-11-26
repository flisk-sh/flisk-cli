/** Doctor checks for host tool versions: Docker Engine and Compose, Tilt and Bun. */
import type { CheckResult } from "../types/index.js";
import { type ExecAsync } from "./exec-async.js";
export declare const EXEC_TIMEOUT_MS = 10000;
export declare const COMPOSE_TIMEOUT_MS = 30000;
export declare const DOCKER_COMPOSE_VERSION_COMMAND = "docker compose version --short";
export declare const DOCKER_SERVER_JSON_COMMAND = "docker version --format '{{json .Server}}'";
export interface DockerServerInfo {
    /** `.Server.Version` from `docker version`, for example "29.8.0". */
    version?: string;
    /** `.Server.Os` from `docker version`, for example "linux" or "windows". */
    os?: string;
}
/**
 * Parses `docker version --format '{{json .Server}}'` output into the server fields doctor reads.
 * Returns null when the output is not the server JSON (an engine that renders the template as plain text).
 */
export declare function parseDockerServerJson(raw: string): DockerServerInfo | null;
export declare function checkDockerVersions(exec?: ExecAsync): Promise<CheckResult>;
export declare namespace checkDockerVersions {
    var requiresContainerRuntime: boolean;
    var checkName: string;
}
export declare function checkTilt(exec?: ExecAsync): Promise<CheckResult>;
export declare function checkBun(exec?: ExecAsync): Promise<CheckResult>;
/**
 * `flisk import` and `flisk export` spawn their pinned packages through npx, or bunx when npx is absent (#4855).
 * Reports which runner a call would pick, and warns when neither is on PATH, where both commands exit 127. The
 * warning does not block readiness (the rest of the CLI works); `--strict` escalates it to a failure.
 */
export declare function checkPackageRunner(options?: {
    pathEnv?: string;
    platform?: NodeJS.Platform;
    strict?: boolean;
}): CheckResult;
