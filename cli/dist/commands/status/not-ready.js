// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { formatCount } from "../../utils/formatting.js";
import { strictNotReady } from "../../utils/service-readiness.js";
export { strictNotReady };
/**
 * `strictNotReady` for the services a run launches. When locally disabled services leave nothing to launch although the
 * project has services, nothing is running, so `--strict` still fails (null) instead of passing on an empty list.
 */
export function strictNotReadyForRun(launched, states, discoveredCount) {
    if (launched.length === 0 && discoveredCount > 0 && states !== null)
        return null;
    return strictNotReady(launched, states);
}
/** `--strict` turns the answer into the exit code (#3826): output is unchanged, one line on stderr says why it is 1. */
export function failStrictStatus(notReady) {
    if (notReady === null) {
        console.error("flisk status --strict: nothing is running. Start it with: flisk up");
        process.exitCode = 1;
    }
    else if (notReady.length > 0) {
        console.error(`flisk status --strict: ${formatCount(notReady.length, "service")} not ready: ${notReady.join(", ")}`);
        process.exitCode = 1;
    }
}
