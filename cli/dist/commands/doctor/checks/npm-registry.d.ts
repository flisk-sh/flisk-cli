import type { DoctorCheckSpec } from "./spec.js";
/**
 * Preflight: with Verdaccio configured but down, ImageBuild `bun install` hits
 * ConnectionRefused. The license check only runs when the project config opted into Verdaccio.
 */
export declare const privateNpmRegistryCheck: DoctorCheckSpec;
