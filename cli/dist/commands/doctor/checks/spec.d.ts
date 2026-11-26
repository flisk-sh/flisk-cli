import type { CheckResult } from "../../../types/index.js";
import type { DoctorWiringSlot } from "../../../utils/doctor/checks/table.js";
import { type DoctorCheckFn } from "../../../utils/doctor-runner.js";
import type { DoctorRunContext } from "../context.js";
/**
 * One row of the `flisk doctor` check table: the name the CheckResult reports, the
 * runtime gate the runner applies, and the body that produces the result. The shape
 * matches `DoctorCheckSpec` in `utils/doctor/checks/table.ts`; rows here run against
 * the run context instead of the wiring context.
 */
export interface DoctorCheckSpec {
    /** The CheckResult.name the check reports; kept stable for the JSON doctor report. */
    name: string;
    /** The label doctor uses when the check is gated out; defaults to `name`. */
    checkName?: string;
    /** `"container-runtime"` when the check needs a live container daemon, null when files on disk suffice. */
    requires: "container-runtime" | null;
    /** Optional inclusion gate: the row joins the run only when this returns true for the run context. */
    when?: (ctx: DoctorRunContext) => boolean;
    run: (ctx: DoctorRunContext) => CheckResult | Promise<CheckResult>;
}
/** Marks where a slot of the wiring check table (`utils/doctor/checks/table.ts`) lands in the run. */
export interface DoctorWiringSlotRef {
    wiring: DoctorWiringSlot;
}
/** A check spec, or a wiring slot the run expands from the wiring check table. */
export type DoctorTableEntry = DoctorCheckSpec | DoctorWiringSlotRef;
export declare function isWiringSlotRef(entry: DoctorTableEntry): entry is DoctorWiringSlotRef;
/** One runnable check for a doctor run; container-runtime rows are wrapped so the run can gate them. */
export declare function doctorCheckFn(spec: DoctorCheckSpec, ctx: DoctorRunContext): DoctorCheckFn;
