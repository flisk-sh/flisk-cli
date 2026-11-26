import type { CheckResult } from "../../../types/index.js";
export declare const START_SCRIPTS: Set<string>;
export declare function fileMigrations(path: string, onlyStartLines: boolean): boolean;
/**
 * A backend or worker that applies migrations from its own start-up (a `start` script, a Dockerfile CMD,
 * an entrypoint script or its source) races its siblings and runs again on every restart. Flisk has a
 * `migrator` app type for this: it runs once, before the services that depend on it. This is a warning,
 * not a failure: such services work, and the opt-in Infisical entrypoint is one of them.
 */
export declare function checkMigrationsInApi(projectRoot?: string): CheckResult;
