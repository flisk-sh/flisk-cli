import type { DiscoveredResource } from "../../../types/index.js";
import type { DoctorTableEntry } from "./spec.js";
/** The project table for a Docker stack. */
export declare const CONTAINER_PROJECT_CHECKS: DoctorTableEntry[];
/** The project table for a project of local processes (no Docker, no Tilt). */
export declare function nativeProjectChecks(resources: DiscoveredResource[]): DoctorTableEntry[];
