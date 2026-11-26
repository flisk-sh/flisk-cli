/**
 * The TypeScript half of the service.json validation rule table (#4858): the bounds and whitelists
 * validators enforce, named once per language. Its Starlark twin is runtime/discovery/validation_rules.star,
 * and tests/fixtures/service-manifest-corpus/decisions.json pins both tables plus the accept/reject
 * decisions of every validator — update all three together when a rule changes.
 *
 * Two kinds of ranges live here: the validation bands (`PORT_RANGES`, mirrored from
 * TILT_DISCOVERY.star and used to judge a manifest's port) and the allocation bands
 * (`ALLOCATION_PORT_BANDS`, the free-port pools `flisk resource` assigns from). They are different
 * tables on purpose: validation accepts a wider window than scaffolding allocates.
 */
/** `appName` length bounds (service-schema.json minLength/maxLength). */
export declare const APP_NAME_MIN_LENGTH = 2;
export declare const APP_NAME_MAX_LENGTH = 64;
/**
 * Every appType the discovery validators accept: the service-schema.json enum plus the engine's
 * internal "infra" resource type (the discovery rule predates the schema's narrower enum). The CLI's
 * own resource-config enum is narrower again (no "infra") and lives in types/index.ts.
 */
export declare const VALID_APP_TYPES: readonly ["frontend", "backend", "library", "migrator", "sdk", "worker", "infra", "database", "mcp", "bring-your-own", "agent"];
/** appTypes that legitimately run without a port (see PORT_OPTIONAL_APP_TYPES in validation_rules.star). */
export declare const PORT_OPTIONAL_APP_TYPES: readonly ["infra", "database"];
/** The absolute bounds any port must satisfy (schema port minimum/maximum). */
export declare const PORT_MIN = 1;
export declare const PORT_MAX = 65535;
/** A scaffolded (container) service's dev port window in discovery. */
export declare const STANDARD_PORT_MIN = 3000;
export declare const STANDARD_PORT_MAX = 9999;
/**
 * A bring-your-own port is the port its own container listens on — Traefik reaches it on the stack
 * network and nothing is published on the host — so an imported Compose app keeps 80, 3000 or 5432.
 */
export declare const BRING_YOUR_OWN_PORT_MIN = 1;
export declare const BRING_YOUR_OWN_PORT_MAX = 65535;
/**
 * Per-appType port bands the discovery validator judges a manifest's port against. Mirrors
 * TILT_DISCOVERY.star's PORT_RANGES (re-exported by validation_rules.star) — update both together.
 */
export declare const PORT_RANGES: {
    readonly frontend: {
        readonly min: 3000;
        readonly max: 5999;
    };
    readonly backend: {
        readonly min: 4000;
        readonly max: 5999;
    };
    readonly worker: {
        readonly min: 4000;
        readonly max: 6999;
    };
    readonly migrator: {
        readonly min: 7000;
        readonly max: 7999;
    };
    readonly sdk: {
        readonly min: 3000;
        readonly max: 9999;
    };
    readonly library: {
        readonly min: 3000;
        readonly max: 9999;
    };
};
/** The discovery whitelist for a resource's `featuresEnabled` entries (TILT_DISCOVERY.star's VALID_RESOURCE_FEATURES). */
export declare const VALID_RESOURCE_FEATURES: readonly ["api-client", "env-config", "api-index", "prisma", "nats", "redis", "infisical", "vitest", "traefik", "websocket", "graphql", "grpc", "vite-node", "maintenance", "ddd"];
/** The free-port pools `flisk resource` allocates from. constants.ts derives its PORT_RANGES shape from this table. */
export declare const ALLOCATION_PORT_BANDS: {
    readonly frontend: {
        readonly min: 3000;
        readonly max: 3999;
    };
    readonly backend: {
        readonly min: 4000;
        readonly max: 4999;
    };
    readonly mcp: {
        readonly min: 4000;
        readonly max: 5999;
    };
    readonly agent: {
        readonly min: 4000;
        readonly max: 5999;
    };
    readonly "bring-your-own": {
        readonly min: 4000;
        readonly max: 5999;
    };
    readonly worker: {
        readonly min: 6000;
        readonly max: 6999;
    };
    readonly health: {
        readonly min: 5000;
        readonly max: 5999;
    };
    readonly migrator: {
        readonly min: 7000;
        readonly max: 7999;
    };
};
export declare const REPLICAS_MIN = 1;
export declare const REPLICAS_MAX = 10;
/** The whole table as one value, mirroring SERVICE_MANIFEST_RULES in validation_rules.star for the corpus test. */
export declare const SERVICE_MANIFEST_RULES: {
    readonly appName: {
        readonly minLength: 2;
        readonly maxLength: 64;
    };
    readonly appTypes: readonly ["frontend", "backend", "library", "migrator", "sdk", "worker", "infra", "database", "mcp", "bring-your-own", "agent"];
    readonly portOptionalAppTypes: readonly ["infra", "database"];
    readonly port: {
        readonly standard: {
            readonly min: 3000;
            readonly max: 9999;
        };
        readonly bringYourOwn: {
            readonly min: 1;
            readonly max: 65535;
        };
        readonly bands: {
            readonly frontend: {
                readonly min: 3000;
                readonly max: 5999;
            };
            readonly backend: {
                readonly min: 4000;
                readonly max: 5999;
            };
            readonly worker: {
                readonly min: 4000;
                readonly max: 6999;
            };
            readonly migrator: {
                readonly min: 7000;
                readonly max: 7999;
            };
            readonly sdk: {
                readonly min: 3000;
                readonly max: 9999;
            };
            readonly library: {
                readonly min: 3000;
                readonly max: 9999;
            };
        };
    };
    readonly featuresEnabled: readonly ["api-client", "env-config", "api-index", "prisma", "nats", "redis", "infisical", "vitest", "traefik", "websocket", "graphql", "grpc", "vite-node", "maintenance", "ddd"];
    readonly replicas: {
        readonly min: 1;
        readonly max: 10;
    };
};
