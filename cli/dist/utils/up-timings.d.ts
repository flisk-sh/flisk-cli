/**
 * One started service's span from its update's start to the moment the stack counted it ready, as `flisk up --json`
 * reports it in `data.timings` (#4129). A benchmark can see a service that took a minute to count as running without
 * reading the Tilt UI by hand.
 */
export interface ServiceTiming {
    service: string;
    /** RFC3339 time the service's own update started (`docker compose up` for a container service). */
    startedAt?: string;
    /**
     * RFC3339 time the stack counted the service ready. A service behind a `-healthy` gate is ready when that gate
     * finished (the container passed its health check), a one-shot job when its `-done` gate saw it exit 0, and anything
     * else when its own update finished.
     */
    readyAt?: string;
    /** `readyAt` minus `startedAt` in milliseconds. */
    startToReadyMs?: number;
}
/**
 * Per-service start-to-ready times read from one `tilt get uiresources -o json` answer. A service's own update ends
 * when its container runs, so `readyAt` extends to its `-healthy` or `-done` gate when Tilt registers one
 * (apply_compose_resource_registration.star): that finish is the moment a dependent may actually use the service.
 * Every named service gets an entry; a service Tilt never deployed keeps only its name.
 */
export declare function serviceTimings(jsonText: string, serviceNames: readonly string[]): ServiceTiming[];
