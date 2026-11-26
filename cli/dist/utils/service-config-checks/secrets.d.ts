import type { CheckResult, DiscoveredResource } from "../../types/index.js";
/**
 * `secrets.required` names that neither the env file of the run nor the environment holds a value for. Compose refuses to
 * interpolate such a name, and that fails the whole Tiltfile, so every service stops, not only the one that needs the secret.
 * With `FLISK_SECRET_PROVIDER=infisical` the names are left to a bridge; the free build has none, so it warns per name.
 */
export declare function checkRequiredSecrets(projectRoot?: string, resources?: DiscoveredResource[], env?: NodeJS.ProcessEnv): CheckResult;
/** Prints each secret that a literal in `params` or `env` overrides. A warning: such a project still starts. */
export declare function warnSecretConflicts(projectRoot: string, resources?: DiscoveredResource[]): void;
