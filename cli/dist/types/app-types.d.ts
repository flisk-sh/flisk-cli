export declare const RESOURCE_CONFIG_APP_TYPES: readonly ["backend", "frontend", "library", "sdk", "worker", "migrator", "mcp", "agent", "database", "bring-your-own"];
export type ResourceType = "frontend" | "backend" | "library" | "sdk" | "worker" | "migrator" | "mcp" | "agent" | "database" | "bring-your-own";
export declare const CREATABLE_RESOURCE_TYPES: readonly ["backend", "frontend", "worker", "mcp", "agent", "bring-your-own"];
export type CreatableResourceType = Extract<ResourceType, (typeof CREATABLE_RESOURCE_TYPES)[number]>;
export declare function isCreatableResourceType(value: unknown): value is CreatableResourceType;
