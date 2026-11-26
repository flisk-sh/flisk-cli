import type { DiscoveredResource, ServiceRuntimeState, StackMetadata } from "../types/index.js";
export type ServiceStates = Record<string, ServiceRuntimeState>;
export interface TiltSnapshot {
    /** Per-service states. Empty when no Tilt answers or its answer cannot be read. */
    states: ServiceStates;
    /** Whether Tilt answered on the polled port, even when its answer was unreadable. */
    running: boolean;
}
/**
 * One look at the running Tilt, used by both the service list and the UI header. Empty states mean no Tilt answered,
 * so every service stays unknown; `running` stays true when Tilt answered with something we cannot parse.
 */
export declare function fetchTiltSnapshot(services: DiscoveredResource[], tiltPort: number): Promise<TiltSnapshot>;
/** The service-state half of {@link fetchTiltSnapshot}, kept for callers that only draw resources. */
export declare function fetchServiceStates(services: DiscoveredResource[], tiltPort: number): Promise<ServiceStates>;
/** The same states `flisk status` shows, put onto the stack the UI is about to draw. */
export declare function applyServiceStates(metadata: StackMetadata, states: ServiceStates): StackMetadata;
