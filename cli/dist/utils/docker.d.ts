export type ContainerRuntimeStatus = "running" | "unresponsive" | "missing";
/** Whether Docker, Colima, or Podman is reachable, hung, or absent. */
export declare function getContainerRuntimeStatus(): ContainerRuntimeStatus;
/**
 * Whether `docker ps` failed for a reason other than "no daemon": a socket permission error, a failed
 * authentication, or a bad Docker context. `getContainerRuntimeStatus()` reports all of those as "missing",
 * but containers may well be running, so callers must not read that as "the runtime is stopped" (#5029).
 */
export declare function dockerProbeFailedWithAccessError(): boolean;
