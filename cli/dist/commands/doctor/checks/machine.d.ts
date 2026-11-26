import type { DiscoveredResource } from "../../../types/index.js";
import type { DoctorTableEntry } from "./spec.js";
/** The machine table for a Docker stack: the host probes, then the container-runtime gated checks. */
export declare const CONTAINER_MACHINE_CHECKS: DoctorTableEntry[];
/** The machine table for a project of local processes: what its commands need, no Docker or Tilt. */
export declare function nativeMachineChecks(resources: DiscoveredResource[]): DoctorTableEntry[];
