import type { JsonValue } from "./json.js";
export interface ProjectPhaseDefinition {
    name: string;
    description: string;
    enabledStacks: string[];
}
export interface LegacyProjectStackDefinition {
    name: string;
    description: string;
    services: string[];
}
export interface ProjectOptionalInfra {
    monitoring: boolean;
    elk: boolean;
    debezium: boolean;
    golden_image: boolean;
    verdaccio: boolean;
}
export interface ProjectDiscovery {
    paths: string[];
}
export interface ProjectOrchestration {
    source: "tiltfile" | string;
    path?: string;
    [key: string]: unknown;
}
/** `capabilities` in `.flisk/project.json`: a capability set to false is not provisioned. Every capability is on unless set to false. */
export interface ProjectCapabilities {
    /** The Traefik reverse proxy and gateway routing (`proxy`). */
    gateway?: boolean;
    /** The bundled shared Postgres (`database-management`). */
    database?: boolean;
    /** Hot reload: Tilt live-update syncs and in-container reload steps for container resources. */
    watch?: boolean;
    [key: string]: boolean | undefined;
}
export interface RepoConfig {
    url: string;
    dir: string;
    branch?: string;
}
/** Project-level edits to the generated `.tiltignore`. Each entry is one exact pattern line (#5387). */
export interface TiltIgnoreConfig {
    /** Pattern lines appended to the generated file. */
    extra?: string[];
    /** Generated pattern lines removed from the file, for example the old unanchored logs pattern. */
    exclude?: string[];
}
export interface ProjectConfig {
    repos?: RepoConfig[];
    version: string;
    project: {
        name: string;
        version: string;
    };
    capabilities?: ProjectCapabilities;
    phases: {
        pre_alpha: ProjectPhaseDefinition;
        alpha: ProjectPhaseDefinition;
        beta: ProjectPhaseDefinition;
        out_of_scope: ProjectPhaseDefinition;
    };
    stacks?: {
        pre_alpha: LegacyProjectStackDefinition;
        alpha: LegacyProjectStackDefinition;
        beta: LegacyProjectStackDefinition;
        out_of_scope: LegacyProjectStackDefinition;
    };
    always_enabled_infra?: string[];
    /** stack -> the Compose project name an imported Compose file ran under (written by flisk import); accepted, not yet read. */
    composeProjectNames?: Record<string, string>;
    optional_infra: ProjectOptionalInfra;
    discovery: ProjectDiscovery;
    overrides?: Record<string, JsonValue>;
    orchestration?: ProjectOrchestration;
    /** Adjustments to the generated `.tiltignore`: `exclude` removes generated lines, `extra` appends lines. */
    tiltignore?: TiltIgnoreConfig;
}
