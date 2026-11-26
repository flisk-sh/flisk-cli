/**
 * `--type database`: the project's database, declared in a service.json (`framework: postgres`). It has
 * no code, port or image of its own: services list its name in `dependsOn` and get `DATABASE_URL`.
 */
export declare const DATABASE_RESOURCE_TYPE = "database";
/** The database `--type database` runs when no `--framework` is given: the shared Flisk Postgres. */
export declare const DATABASE_FRAMEWORK = "postgres";
/** `--type queue`: a message queue or broker, run as its own container (utils/infra-presets.ts). */
export declare const QUEUE_RESOURCE_TYPE = "queue";
/** `--type storage`: object storage, run as its own container (utils/infra-presets.ts). */
export declare const STORAGE_RESOURCE_TYPE = "storage";
/** `--type mail`: a local SMTP server and inbox standing in for a mail API, run as its own container. */
export declare const MAIL_RESOURCE_TYPE = "mail";
/** `--type payment`: a local payment API emulator, run as its own container. */
export declare const PAYMENT_RESOURCE_TYPE = "payment";
/** `--type database --framework <id>`: infrastructure other than the shared Postgres, run as its own container. */
export declare const DATABASE_INFRA_FRAMEWORKS: readonly ["redis", "qdrant", "mlflow", "mysql", "mongodb", "clickhouse"];
/** `--type queue --framework <id>`. */
export declare const QUEUE_FRAMEWORKS: readonly ["nats", "rabbitmq"];
/** The queue `--type queue` runs when no `--framework` is given. */
export declare const DEFAULT_QUEUE_FRAMEWORK = "nats";
/** `--type storage --framework <id>`. */
export declare const STORAGE_FRAMEWORKS: readonly ["minio"];
/** `--type mail --framework <id>`. */
export declare const MAIL_FRAMEWORKS: readonly ["mailpit"];
/** `--type payment --framework <id>`. */
export declare const PAYMENT_FRAMEWORKS: readonly ["stripe-mock"];
/**
 * The infrastructure types other than `database`: every framework of one is a preset container, and `--framework` may be
 * left out for the default. A new kind of infrastructure (mail, payment) is one more entry here plus its presets.
 */
export declare const PRESET_RESOURCE_TYPES: {
    readonly queue: {
        readonly label: "Queue";
        readonly frameworks: readonly ["nats", "rabbitmq"];
        readonly default: "nats";
    };
    readonly storage: {
        readonly label: "Storage";
        readonly frameworks: readonly ["minio"];
        readonly default: "minio";
    };
    readonly mail: {
        readonly label: "Mail";
        readonly frameworks: readonly ["mailpit"];
        readonly default: "mailpit";
    };
    readonly payment: {
        readonly label: "Payment";
        readonly frameworks: readonly ["stripe-mock"];
        readonly default: "stripe-mock";
    };
};
/** A `--type` whose every framework is an infrastructure preset (`queue`, `storage`). */
export type PresetResourceType = keyof typeof PRESET_RESOURCE_TYPES;
/** A `--type` that offers infrastructure frameworks: `database` and the preset types. */
export type InfraResourceType = typeof DATABASE_RESOURCE_TYPE | PresetResourceType;
/** Every framework id of the infrastructure presets. */
export type InfraFramework = (typeof DATABASE_INFRA_FRAMEWORKS)[number] | (typeof PRESET_RESOURCE_TYPES)[PresetResourceType]["frameworks"][number];
/** The frameworks `--type database` accepts: the shared Postgres first, then the infrastructure presets. */
export declare const DATABASE_FRAMEWORKS: readonly ["postgres", "redis", "qdrant", "mlflow", "mysql", "mongodb", "clickhouse"];
/**
 * Every value `flisk resource --type` accepts: the creatable types, `database`, and `sdk`, which
 * registers a package that already exists instead of scaffolding one.
 */
export declare const RESOURCE_TYPE_VALUES: readonly ["backend", "frontend", "worker", "mcp", "agent", "bring-your-own", "database", "queue", "storage", "mail", "payment", "sdk"];
/** `--type inference`: a bring-your-own resource preset for an OpenAI-compatible model server. */
export declare const INFERENCE_RESOURCE_TYPE = "inference";
/**
 * Every value `flisk resource --type` accepts to scaffold a new resource: the creatable types plus
 * the `inference` preset, `database` and the preset types (`queue`, `storage`, `mail`, `payment`). `sdk` is left out because it only registers a package that
 * already has a service.json, and the `byo` alias because `bring-your-own` is listed. The MCP
 * `resource_create` tool builds its type enum from this list.
 */
export declare const RESOURCE_CREATE_TYPE_VALUES: readonly ["backend", "frontend", "worker", "mcp", "agent", "bring-your-own", "inference", "database", "queue", "storage", "mail", "payment"];
/** True when `flisk resource --type <type>` accepts the value, including the `sdk` and `byo` aliases. */
export declare function isResourceCreateType(type: string): boolean;
