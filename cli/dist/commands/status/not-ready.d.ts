import type { DiscoveredResource, ServiceRuntimeState } from "../../types/index.js";
import { strictNotReady } from "../../utils/service-readiness.js";
export { strictNotReady };
/**
 * `strictNotReady` for the services a run launches. When locally disabled services leave nothing to launch although the
 * project has services, nothing is running, so `--strict` still fails (null) instead of passing on an empty list.
 */
export declare function strictNotReadyForRun(launched: readonly Pick<DiscoveredResource, "name" | "type" | "config">[], states: Record<string, ServiceRuntimeState> | null, discoveredCount: number): string[] | null;
/** `--strict` turns the answer into the exit code (#3826): output is unchanged, one line on stderr says why it is 1. */
export declare function failStrictStatus(notReady: string[] | null): void;
