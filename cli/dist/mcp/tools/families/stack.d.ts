/**
 * The stack family: stack topology (`stack_list`), the ingress URLs across stacks (`network_list`) and assigning
 * resources between stacks (`stack_assign`). Each tool's arguments are declared once in an argSpec table bound to the
 * command's generated spec.
 */
/** The `stack_list` tool's arguments, bound to the `flisk stacks` spec. */
export declare const stackListArgs: import("../../spec-args.js").ArgSpec;
/** `flisk stacks [--services] [--verbose] --json`. */
export declare function buildStackListArgs(args: Record<string, unknown>): string[];
/** The `network_list` tool's arguments, bound to the `flisk networks` spec. */
export declare const networkListArgs: import("../../spec-args.js").ArgSpec;
/** `flisk networks [--stack=<stack>] --json`. */
export declare function buildNetworkListArgs(args: Record<string, unknown>): string[];
/** The `stack_assign` tool's arguments, bound to the `flisk stack` spec. */
export declare const stackAssignArgs: import("../../spec-args.js").ArgSpec;
/** `flisk stack <stack> --resources=<name>... --json`: one `--resources=` per name so a value is never a flag. */
export declare function buildStackAssignArgs(args: Record<string, unknown>): string[];
