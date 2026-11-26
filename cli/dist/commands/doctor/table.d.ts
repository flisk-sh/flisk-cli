import { type DoctorCheckFn } from "../../utils/doctor-runner.js";
import { type DoctorTableEntry } from "./checks/spec.js";
import type { DoctorRunContext } from "./context.js";
export type { DoctorCheckSpec, DoctorTableEntry } from "./checks/spec.js";
/**
 * Expands a check table into the run's check list: each spec becomes a runnable check
 * (container-runtime rows get their skip gate), each `{ wiring }` marker becomes the
 * rows of that slot from the wiring check table, so a new wiring check is one module
 * plus one row there and no edits here.
 */
export declare function expandDoctorTable(table: readonly DoctorTableEntry[], ctx: DoctorRunContext): DoctorCheckFn[];
/**
 * The machine section's check list. A project of local processes gets the native table
 * (what its commands need); anything else gets the container host table.
 */
export declare function doctorMachineChecks(ctx: DoctorRunContext): DoctorCheckFn[];
/**
 * The project section's check list, in the same order in each flavor.
 * Ping rows stay appended last: they need routable services (and working Traefik) to mean anything.
 */
export declare function doctorProjectChecks(ctx: DoctorRunContext): DoctorCheckFn[];
