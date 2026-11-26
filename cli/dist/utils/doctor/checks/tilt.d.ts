import { type execSync } from "node:child_process";
import type { CheckResult } from "../../../types/index.js";
interface TiltProcess {
    pid: number;
    root: string;
}
export declare function parseTiltProcesses(psOutput: string): TiltProcess[];
/** All `tilt up -f <project>/.flisk/.flisk-out/Tiltfile` processes, or [] when processes cannot be listed. */
export declare function listTiltInstances(exec?: typeof execSync): TiltProcess[];
export declare function checkTiltInstances(projectRoot?: string, exec?: typeof execSync): CheckResult;
export {};
