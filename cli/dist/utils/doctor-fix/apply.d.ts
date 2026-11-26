import type { DoctorAction } from "../../types/index.js";
import { type DoctorFixDeps } from "./deps.js";
export interface ApplyOptions {
    dryRun: boolean;
    /** Ask before each destructive action; resolves false to decline. Absent means confirmation is unavailable. */
    confirm?: (action: DoctorAction) => Promise<boolean>;
}
/** Run the planned actions in order. A declined or failed action never stops the rest, so a re-run converges. */
export declare function applyDoctorFixes(actions: DoctorAction[], options: ApplyOptions, deps?: DoctorFixDeps): Promise<DoctorAction[]>;
/** Whether any action leaves a problem behind that a re-run could still repair. */
export declare function hasFailedActions(actions: DoctorAction[]): boolean;
