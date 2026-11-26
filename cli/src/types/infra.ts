// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { CREATABLE_RESOURCE_TYPES } from "./app-types.js";

/**
 * `--type database`: the project's database, declared in a service.json (`framework: postgres`). It has
 * no code, port or image of its own: services list its name in `dependsOn` and get `DATABASE_URL`.
 */
export const DATABASE_RESOURCE_TYPE = "database";

/** The database `--type database` runs when no `--framework` is given: the shared Flisk Postgres. */
export const DATABASE_FRAMEWORK = "postgres";

/** `--type queue`: a message queue or broker, run as its own container (utils/infra-presets.ts). */
export const QUEUE_RESOURCE_TYPE = "queue";

/** `--type storage`: object storage, run as its own container (utils/infra-presets.ts). */
export const STORAGE_RESOURCE_TYPE = "storage";

/** `--type mail`: a local SMTP server and inbox standing in for a mail API, run as its own container. */
export const MAIL_RESOURCE_TYPE = "mail";

/** `--type payment`: a local payment API emulator, run as its own container. */
export const PAYMENT_RESOURCE_TYPE = "payment";

/** `--type database --framework <id>`: infrastructure other than the shared Postgres, run as its own container. */
export const DATABASE_INFRA_FRAMEWORKS = [
  "redis",
  "qdrant",
  "mlflow",
  "mysql",
  "mongodb",
  "clickhouse",
] as const;

/** `--type queue --framework <id>`. */
export const QUEUE_FRAMEWORKS = ["nats", "rabbitmq"] as const;

/** The queue `--type queue` runs when no `--framework` is given. */
export const DEFAULT_QUEUE_FRAMEWORK = "nats";

/** `--type storage --framework <id>`. */
export const STORAGE_FRAMEWORKS = ["minio"] as const;

/** `--type mail --framework <id>`. */
export const MAIL_FRAMEWORKS = ["mailpit"] as const;

/** `--type payment --framework <id>`. */
export const PAYMENT_FRAMEWORKS = ["stripe-mock"] as const;

/**
 * The infrastructure types other than `database`: every framework of one is a preset container, and `--framework` may be
 * left out for the default. A new kind of infrastructure (mail, payment) is one more entry here plus its presets.
 */
export const PRESET_RESOURCE_TYPES = {
  [QUEUE_RESOURCE_TYPE]: {
    label: "Queue",
    frameworks: QUEUE_FRAMEWORKS,
    default: DEFAULT_QUEUE_FRAMEWORK,
  },
  [STORAGE_RESOURCE_TYPE]: { label: "Storage", frameworks: STORAGE_FRAMEWORKS, default: "minio" },
  [MAIL_RESOURCE_TYPE]: { label: "Mail", frameworks: MAIL_FRAMEWORKS, default: "mailpit" },
  [PAYMENT_RESOURCE_TYPE]: {
    label: "Payment",
    frameworks: PAYMENT_FRAMEWORKS,
    default: "stripe-mock",
  },
} as const;

/** A `--type` whose every framework is an infrastructure preset (`queue`, `storage`). */
export type PresetResourceType = keyof typeof PRESET_RESOURCE_TYPES;

/** A `--type` that offers infrastructure frameworks: `database` and the preset types. */
export type InfraResourceType = typeof DATABASE_RESOURCE_TYPE | PresetResourceType;

/** Every framework id of the infrastructure presets. */
export type InfraFramework =
  | (typeof DATABASE_INFRA_FRAMEWORKS)[number]
  | (typeof PRESET_RESOURCE_TYPES)[PresetResourceType]["frameworks"][number];

/** The frameworks `--type database` accepts: the shared Postgres first, then the infrastructure presets. */
export const DATABASE_FRAMEWORKS = [DATABASE_FRAMEWORK, ...DATABASE_INFRA_FRAMEWORKS] as const;

/**
 * Every value `flisk resource --type` accepts: the creatable types, `database`, and `sdk`, which
 * registers a package that already exists instead of scaffolding one.
 */
export const RESOURCE_TYPE_VALUES = [
  ...CREATABLE_RESOURCE_TYPES,
  DATABASE_RESOURCE_TYPE,
  QUEUE_RESOURCE_TYPE,
  STORAGE_RESOURCE_TYPE,
  MAIL_RESOURCE_TYPE,
  PAYMENT_RESOURCE_TYPE,
  "sdk",
] as const;

/** `--type inference`: a bring-your-own resource preset for an OpenAI-compatible model server. */
export const INFERENCE_RESOURCE_TYPE = "inference";

/**
 * Every value `flisk resource --type` accepts to scaffold a new resource: the creatable types plus
 * the `inference` preset, `database` and the preset types (`queue`, `storage`, `mail`, `payment`). `sdk` is left out because it only registers a package that
 * already has a service.json, and the `byo` alias because `bring-your-own` is listed. The MCP
 * `resource_create` tool builds its type enum from this list.
 */
export const RESOURCE_CREATE_TYPE_VALUES = [
  ...CREATABLE_RESOURCE_TYPES,
  INFERENCE_RESOURCE_TYPE,
  DATABASE_RESOURCE_TYPE,
  QUEUE_RESOURCE_TYPE,
  STORAGE_RESOURCE_TYPE,
  MAIL_RESOURCE_TYPE,
  PAYMENT_RESOURCE_TYPE,
] as const;

/** True when `flisk resource --type <type>` accepts the value, including the `sdk` and `byo` aliases. */
export function isResourceCreateType(type: string): boolean {
  return (
    (RESOURCE_CREATE_TYPE_VALUES as readonly string[]).includes(type) ||
    type === "sdk" ||
    type === "byo"
  );
}
