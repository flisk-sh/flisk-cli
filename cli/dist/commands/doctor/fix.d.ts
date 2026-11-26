import type { DiscoveredResource, DoctorAction } from "../../types/index.js";
import type { DoctorOptions } from "./context.js";
/**
 * The `--fix` stage: plan the repairs (unused Docker networks, leftover doctor probes),
 * apply them, and print them in text mode. Runs before the checks so the checks report
 * the state after the fix. Returns the actions, or undefined when `--fix` was not requested.
 */
export declare function planAndRunDoctorFixes(options: DoctorOptions, projectRoot: string | null, nativeResources: DiscoveredResource[] | null): Promise<DoctorAction[] | undefined>;
