// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { namedCheck, requiresContainerRuntime, } from "../../../utils/doctor-runner.js";
export function isWiringSlotRef(entry) {
    return "wiring" in entry;
}
/** One runnable check for a doctor run; container-runtime rows are wrapped so the run can gate them. */
export function doctorCheckFn(spec, ctx) {
    if (spec.requires === "container-runtime") {
        return requiresContainerRuntime(spec.checkName ?? spec.name, () => spec.run(ctx));
    }
    // A named check keeps its name on screen while it runs, so a wedged check is identifiable in the progress output.
    return namedCheck(spec.checkName ?? spec.name, () => spec.run(ctx));
}
