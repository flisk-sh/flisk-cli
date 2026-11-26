import type { MachineError } from "../types/index.js";
export type JsonError = MachineError;
export type JsonEmitter = (data: Record<string, unknown>, errors?: JsonError[]) => void;
/**
 * Tells every live emitter that a `{schemaVersion, data, errors}` document already reached stdout without going
 * through `emit` (for example `flisk up --wait --json` relaying the result line of the `flisk up --json` child it
 * spawned), so no exit hook writes a second document after it (#3848).
 */
export declare function markJsonEnvelopeWritten(): void;
/**
 * Returns an emitter that writes at most one `{schemaVersion, data, errors}` object to stdout. Every error entry
 * carries a `suggestions` array, so a consumer reads it without checking for the key first (#4522). If the process
 * exits before anything was emitted (a preflight `process.exit`, Tilt ending early), a failure object is written
 * so a JSON consumer never sees an empty stdout. Uses writeSync because `process.exit` does not flush async writes.
 */
export declare function createJsonEmitter(failureCode: string, command: string): JsonEmitter;
