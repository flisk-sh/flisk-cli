import type { DoctorCheckSpec } from "./spec.js";
/**
 * The gateway/Postgres host ports the plan chose, or which process took one when
 * the plan failed. `observed` carries the port owner into the JSON report.
 */
export declare const hostPortsCheck: DoctorCheckSpec;
/** The ingress ports the plan chose are free; only runs when the project enables the gateway. */
export declare const ingressPortsCheck: DoctorCheckSpec;
