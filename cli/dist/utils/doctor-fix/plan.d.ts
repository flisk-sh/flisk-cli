import type { DoctorAction } from "../../types/index.js";
import { type DoctorFixDeps } from "./deps.js";
export interface PlanContext {
    /** `tilt up` processes for this project (see `projectTiltPids`). */
    tiltPids?: number[];
    /** `--scope=machine`: also plan unused networks of other Flisk projects. */
    machine?: boolean;
    /** The current project's root, for `project`-scoped repairs such as its own orphaned event watchers. */
    projectRoot?: string;
}
/**
 * What `--fix` would do: stop this project's stale Tilt; remove unused networks that are a leftover doctor probe or
 * this project's own (the exact names the engine creates, skipped while its Tilt runs). Other Flisk projects' unused
 * networks are planned only with `context.machine`, each naming its owner.
 */
export declare function planDoctorFixes(projectName: string | undefined, deps?: DoctorFixDeps, context?: PlanContext): Promise<DoctorAction[]>;
