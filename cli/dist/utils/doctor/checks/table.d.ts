import type { execSync } from "node:child_process";
import type { CheckResult, DiscoveredResource } from "../../../types/index.js";
import type { DoctorProbeEnvironment } from "../../doctor-probe-cache.js";
import { type DoctorCheckFn } from "../../doctor-runner.js";
import type { ExecAsync } from "../../exec-async.js";
/**
 * Where a wiring check runs inside `flisk doctor`. The table is the run order:
 * doctor.ts expands each slot into the matching group of its check list, so a
 * new check is one module plus one row here and no other file changes.
 */
export type DoctorWiringSlot = 
/** Right after resource discovery: what the files on disk already prove wrong. */
"discovery"
/** With the service.json declaration checks. */
 | "declaration"
/** With the schema-version and port-shape checks. */
 | "schema"
/** The wiring block: cross-resource mistakes that surface minutes into `flisk up`. */
 | "wiring"
/** The machine checks: probes of the container host itself. */
 | "machine";
/** The slots a doctor run expands, in the order the groups appear in its check lists. */
export declare const DOCTOR_WIRING_SLOTS: readonly ["machine", "discovery", "declaration", "schema", "wiring"];
/** Inputs the checks share; every field falls back to the check's own default. */
export interface DoctorCheckContext {
    /** The project the checks inspect; defaults to `findProjectRoot() ?? process.cwd()`. */
    projectRoot?: string;
    /** Resources already discovered by the caller; defaults to each check's own discovery. */
    resources?: DiscoveredResource[];
    /** The doctor command's options object (`--no-database`, `--strict`, ...), forwarded to the checks that read it. */
    options?: Record<string, unknown>;
    /** Command runner for checks that probe Docker; defaults to `execAsync`. */
    exec?: ExecAsync;
    /** Process lister for the Tilt process scan; defaults to `execSync`. */
    listProcesses?: typeof execSync;
    /**
     * Lazy access to the probe cache identity; resolved only when a probe check actually runs, so a run that
     * stops before the Docker probes never pays for it.
     */
    probeEnv?: () => Promise<DoctorProbeEnvironment>;
}
export interface DoctorCheckSpec {
    /** The CheckResult.name the check reports; kept stable for the JSON doctor report. */
    name: string;
    /** The label doctor uses when the check is gated out; defaults to `name`. */
    checkName?: string;
    /** `"container-runtime"` when the check needs a live container daemon, null when files on disk suffice. */
    requires: "container-runtime" | null;
    /** Which group in the doctor run the check joins. */
    slot: DoctorWiringSlot;
    run: (context: DoctorCheckContext) => CheckResult | Promise<CheckResult>;
}
export declare const DOCTOR_WIRING_CHECKS: readonly DoctorCheckSpec[];
/** One runnable check for a doctor run; container-runtime rows are wrapped so the run can gate them. */
export declare function doctorWiringCheckFn(spec: DoctorCheckSpec, context: DoctorCheckContext): DoctorCheckFn;
/** The wiring checks for one slot, in table order, ready for the doctor check list. */
export declare function wiringChecksFor(slot: DoctorWiringSlot, context: DoctorCheckContext): DoctorCheckFn[];
