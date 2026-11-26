import type { DiscoveredResource } from "../../types/index.js";
/** The `flisk stack` option values the validation rules read. */
export interface StackOptionValues {
    list?: boolean;
    resources?: string[];
    move?: boolean;
    remove?: boolean;
    yes?: boolean;
    json?: boolean;
}
export declare function normalizeResourceNames(names: string[]): string[];
/**
 * `flisk stack list` reads as the listing verb, but the positional is a
 * stack name, so the bare word is treated as a stack called "list" and
 * opens the assignment wizard. Treat it as --list instead; the MCP tool is
 * already called `stack_list`.
 */
export declare function isBareStackListRequest(stackName: string | undefined): boolean;
/**
 * Reject positional arguments beyond the stack name, with hints for the two
 * command shapes people most often mean (`stack assign` and `stack create`).
 */
export declare function assertNoExtraStackArguments(stackName: string | undefined, extra: string[]): void;
/**
 * Reject flag combinations the command cannot honor, in the order the run
 * would hit them. A bare `list` positional may name a stack only when it
 * arrives without --resources; with --resources it is refused outright so a
 * stack that `flisk stack --list` could never address is never stored.
 */
export declare function assertCompatibleStackOptions(stackName: string | undefined, options: StackOptionValues): void;
/**
 * --json never prompts: it takes the same arguments as a run without a
 * terminal. Without a TTY (or under --json) the invocation must carry every
 * answer the interactive flow would have asked for.
 */
export declare function assertNonInteractiveInputs(stackName: string | undefined, options: StackOptionValues, isTTY: boolean): void;
/** What the --resources validation settled on before anything is written. */
export interface StackUpdatePlan {
    /** Canonical service.json paths to update, in request order. */
    selectedPaths: string[];
    /** Old service.json path -> new service.json path for resources that relocate folders. */
    relocations: Map<string, string>;
}
/**
 * Resolve --resources names to the service.json files they mean: normalize the
 * names, refuse duplicates, unknown names and already-assigned resources, and
 * plan the folder moves a --move between `services/<stack>/<name>` folders
 * takes. Pure planning: nothing is written here.
 */
export declare function planNamedResourceUpdates(names: string[], discovered: DiscoveredResource[], projectRoot: string, targetStack: string | null, options?: {
    move?: boolean;
    remove?: boolean;
    exists?: (candidate: string) => boolean;
}): StackUpdatePlan;
