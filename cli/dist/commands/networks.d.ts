import { Command } from "commander";
import { withTrailingSlash } from "../utils/service-urls.js";
export { withTrailingSlash };
/** One warning a status check produced. `kind` tells the summaries below which check failed. */
export interface ServiceStatusWarning {
    kind: "http" | "port" | "docker";
    /** The warning text without the leading ⚠️, so it can also ride in the `--json` warnings array. */
    message: string;
}
export declare function determineDefaultDomain(dockerUp?: boolean, report?: (message: string) => void, projectRoot?: string | null): string;
export declare function checkServiceStatus(serviceName: string, port?: number, url?: string, report?: (warning: ServiceStatusWarning) => void): Promise<"running" | "stopped" | "unknown">;
/**
 * Whether the Docker daemon answers `docker ps`, probed once per `networks` run. When it cannot, every per-service Docker
 * lookup below would fail the same way, so the run skips them behind a single warning.
 */
export declare function isDockerReachable(): Promise<boolean>;
export declare const networksCommand: Command;
