import type { DiscoveredResource, ServiceRuntimeState } from "../../types/index.js";
import { type UnhealthyService } from "../status-groups.js";
import type { NativeRunState } from "./state.js";
/**
 * The unhealthy services, blockers before waiting dependents, each with its reason. `didStart` is false only
 * when the run on record never gave the service a process (no pid was ever written for it), which is how a
 * dependent waiting on an unready dependency is told apart from a service that is itself failing to become
 * ready.
 */
export declare function nativeUnhealthyServices(resources: readonly DiscoveredResource[], states: Record<string, ServiceRuntimeState>, run: NativeRunState | null): UnhealthyService[];
