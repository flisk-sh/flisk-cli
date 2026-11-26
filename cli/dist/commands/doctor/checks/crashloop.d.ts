import type { DoctorCheckSpec } from "./spec.js";
/** A container restarted thousands of times is invisible in `docker ps` until someone looks. */
export declare const crashLoopingContainersCheck: DoctorCheckSpec;
