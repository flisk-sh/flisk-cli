import type { CheckResult } from "../../../types/index.js";
import { type ExecAsync } from "../../exec-async.js";
/** Which binaries a `healthCheck.command` needs from the image. */
export interface ProbeCommand {
    shell: string | null;
    tools: string[];
}
/**
 * Parses a `healthCheck.command` array. The manifest keeps the exec form
 * (`["curl", "-f", "..."]`); a copied Compose `CMD`/`CMD-SHELL` row or an explicit
 * `sh -c` turns the probe into a shell script.
 */
export declare function probeCommandTools(command: string[]): ProbeCommand | undefined;
export declare function checkHealthCheckTools(projectRoot?: string, exec?: ExecAsync): Promise<CheckResult>;
