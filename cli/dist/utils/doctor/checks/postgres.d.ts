import type { CheckResult } from "../../../types/index.js";
import { type ExecAsync } from "../../exec-async.js";
/**
 * Shared platform Postgres will-start reporting.
 *
 * Uses the same evaluateSharedPlatformPostgres predicate as `flisk config verify`,
 * which reads project.json **and** the generated Tiltfile/spec.master when present.
 * Resource set is the project discovery set those commands already inspect —
 * not a `flisk up` filter. A resource that depends on Postgres while you bring up
 * a different one still makes this report will-start; the engine start path is
 * selection-bounded and may not start Postgres for that run. Unknown dependsOn
 * names (typos like `postgress`) stay errors. Does NOT report
 * postgres/database-management as missing services and does NOT claim Prisma
 * will start.
 *
 * Preflight loop: edit service.json → `flisk config regenerate` → `flisk doctor`.
 * Doctor is the gate; one real `flisk up` after doctor is green confirms the run.
 */
export declare function checkSharedPlatformPostgres(projectRoot?: string, options?: Record<string, unknown>): CheckResult;
/**
 * Whether the shared Postgres still accepts the DB_PASSWORD in the project .env.
 *
 * Postgres applies POSTGRES_PASSWORD only when it first initialises a data volume, and the volume lives in Docker, outside the
 * project folder. A recreated folder (or a changed .env) gets a new random DB_PASSWORD while the old volume keeps its own, and
 * every service that connects, such as a migrator, then fails with "password authentication failed" minutes into `flisk up`.
 *
 * The login is tried from the container's own network address: the official image trusts 127.0.0.1 without a password, so a
 * loopback test would pass whatever the password. PGPASSWORD is handed to docker through this process's environment, so the
 * password never appears in a command line.
 */
export declare function checkPostgresCredentials(projectRoot?: string, exec?: ExecAsync, options?: Record<string, unknown>): Promise<CheckResult>;
