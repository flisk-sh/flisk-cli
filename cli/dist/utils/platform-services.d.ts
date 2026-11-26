import type { DiscoveredResource } from "../types/index.js";
/**
 * Whether the project needs Flisk's own platform services, and why (#2963). The router (Traefik) serves every routed service;
 * the shared PostgreSQL serves every `database` resource, every `dependsOn: postgres`, and every managed backend-side
 * resource. A frontend is routed but is not a database user unless it opts in. A project of only bring-your-own containers
 * that publish their own ports and bring their own database needs neither.
 */
export interface PlatformServiceNeed {
    /** True when some resource of the project uses this platform service. */
    isNeeded: boolean;
    /** The resources that use it, sorted. Empty when `isNeeded` is false. */
    users: string[];
    /** One line for `flisk status`: who needs it, or why nothing does. */
    reason: string;
}
export interface PlatformServiceNeeds {
    gateway: PlatformServiceNeed;
    database: PlatformServiceNeed;
}
/**
 * What the resources need. Backends, workers, agents, migrators and MCP servers use the shared PostgreSQL. A frontend is
 * a gateway user but not a database user unless it opts in through `database-management` in `featuresEnabled` or a
 * `dependsOn` of `postgres`/`database-management`/a `database` resource. Bring-your-own resources are only gateway users
 * when routed.
 */
export declare function evaluatePlatformServiceNeeds(resources: readonly DiscoveredResource[]): PlatformServiceNeeds;
/**
 * Whether the project's `.env` needs the database keys Flisk generates for the shared PostgreSQL: `DB_PASSWORD`, and
 * `DATABASE_URL` built from it (#3200, #3711). Two projects do not need them: one of only bring-your-own containers that do
 * not use the shared PostgreSQL, and a local-processes project (every service runs with `command`, possibly next to a
 * ready-made `image`). In a local-processes project the keys are only kept when a service really uses the shared PostgreSQL:
 * it is a `database` resource, has the `database-management` feature, or `dependsOn` Postgres.
 *
 * `JWT_SECRET` is not decided here: every Compose entry requires it (local-jwt is the default auth mode), so it is always
 * kept. Conservative like {@link evaluatePlatformServiceNeeds}: any other resource mix, or no resource at all, keeps the keys.
 */
export declare function needsDatabaseKeys(resources: readonly DiscoveredResource[]): boolean;
