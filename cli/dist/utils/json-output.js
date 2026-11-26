// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { writeSync } from "node:fs";
import { lastShownError } from "./last-error.js";
import { createMachineEnvelope, machineError } from "./machine-output.js";
/** The live emitters, so a document written outside `emit` can silence every one of their exit hooks. */
const liveEmitters = new Set();
/**
 * Tells every live emitter that a `{schemaVersion, data, errors}` document already reached stdout without going
 * through `emit` (for example `flisk up --wait --json` relaying the result line of the `flisk up --json` child it
 * spawned), so no exit hook writes a second document after it (#3848).
 */
export function markJsonEnvelopeWritten() {
    for (const markWritten of liveEmitters)
        markWritten();
}
/**
 * Returns an emitter that writes at most one `{schemaVersion, data, errors}` object to stdout. Every error entry
 * carries a `suggestions` array, so a consumer reads it without checking for the key first (#4522). If the process
 * exits before anything was emitted (a preflight `process.exit`, Tilt ending early), a failure object is written
 * so a JSON consumer never sees an empty stdout. Uses writeSync because `process.exit` does not flush async writes.
 */
export function createJsonEmitter(failureCode, command) {
    let emitted = false;
    liveEmitters.add(() => {
        emitted = true;
    });
    const emit = (data, errors = []) => {
        if (emitted)
            return;
        emitted = true;
        const normalized = errors.map((error) => machineError(error.code, error.message, error.suggestions ?? []));
        writeSync(1, `${JSON.stringify(createMachineEnvelope(data, normalized))}\n`);
    };
    process.once("exit", (code) => {
        // The command usually printed why it stopped just before exiting: carry that, not only the exit code.
        const shown = lastShownError();
        emit({ ok: false }, [
            machineError(failureCode, shown?.message ??
                (code === 0
                    ? `${command} exited before reporting a result`
                    : `${command} exited with code ${code}`), shown?.suggestions),
        ]);
    });
    return emit;
}
