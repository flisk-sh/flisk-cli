// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { type DoctorCheckContext, wiringChecksFor } from "../../utils/doctor/checks/table.js";
import { checkNativeServiceHealth } from "../../utils/doctor-native.js";
import {
  type DoctorCheckFn,
  namedCheck,
  requiresContainerRuntime,
} from "../../utils/doctor-runner.js";
import {
  checkAdvertisedEndpoints,
  checkServiceHealth,
  checkServiceSmoke,
} from "../../utils/doctor-services.js";
import { CONTAINER_MACHINE_CHECKS, nativeMachineChecks } from "./checks/machine.js";
import { CONTAINER_PROJECT_CHECKS, nativeProjectChecks } from "./checks/project.js";
import { type DoctorTableEntry, doctorCheckFn, isWiringSlotRef } from "./checks/spec.js";
import type { DoctorRunContext } from "./context.js";

export type { DoctorCheckSpec, DoctorTableEntry } from "./checks/spec.js";

/**
 * Expands a check table into the run's check list: each spec becomes a runnable check
 * (container-runtime rows get their skip gate), each `{ wiring }` marker becomes the
 * rows of that slot from the wiring check table, so a new wiring check is one module
 * plus one row there and no edits here.
 */
export function expandDoctorTable(
  table: readonly DoctorTableEntry[],
  ctx: DoctorRunContext,
): DoctorCheckFn[] {
  const wiringContext: DoctorCheckContext = {
    options: ctx.options,
    probeEnv: ctx.probeEnv,
    resources: ctx.nativeResources ?? undefined,
  };
  const checks: DoctorCheckFn[] = [];
  for (const entry of table) {
    if (isWiringSlotRef(entry)) {
      checks.push(...wiringChecksFor(entry.wiring, wiringContext));
    } else if (!entry.when || entry.when(ctx)) {
      checks.push(doctorCheckFn(entry, ctx));
    }
  }
  return checks;
}

/**
 * The machine section's check list. A project of local processes gets the native table
 * (what its commands need); anything else gets the container host table.
 */
export function doctorMachineChecks(ctx: DoctorRunContext): DoctorCheckFn[] {
  return expandDoctorTable(
    ctx.nativeResources ? nativeMachineChecks(ctx.nativeResources) : CONTAINER_MACHINE_CHECKS,
    ctx,
  );
}

/**
 * The project section's check list, in the same order in each flavor.
 * Ping rows stay appended last: they need routable services (and working Traefik) to mean anything.
 */
export function doctorProjectChecks(ctx: DoctorRunContext): DoctorCheckFn[] {
  const checks = expandDoctorTable(
    ctx.nativeResources ? nativeProjectChecks(ctx.nativeResources) : CONTAINER_PROJECT_CHECKS,
    ctx,
  );
  if (ctx.options.ping && ctx.nativeResources && ctx.projectRoot) {
    const { projectRoot, nativeResources, pingTimeout } = ctx;
    checks.push(
      namedCheck("Service Health", () =>
        checkNativeServiceHealth(projectRoot, nativeResources, pingTimeout),
      ),
    );
  }
  if (ctx.options.ping && !ctx.nativeResources) {
    const { pingTimeout, pingPort, gatewayEnabled } = ctx;
    checks.push(
      requiresContainerRuntime("Service Health", () => checkServiceHealth(pingTimeout, pingPort)),
      requiresContainerRuntime("Service Smoke", () =>
        checkServiceSmoke(pingTimeout, pingPort, { gateway: gatewayEnabled }),
      ),
      requiresContainerRuntime("Advertised Endpoints", () =>
        checkAdvertisedEndpoints(pingTimeout, pingPort),
      ),
    );
  }
  return checks;
}
