/** The `logs` tool's arguments, bound to the `flisk logs` spec. */
export declare const logsArgs: import("../../spec-args.js").ArgSpec;
/** `flisk logs --json` with the table's filters, emitted in spec row order. */
export declare function buildLogsArgs(args: Record<string, unknown>): string[];
