import type { ProjectConfig } from "../types/index.js";
export declare function projectConfig(preAlpha: string[], assigned?: Partial<Record<"alpha" | "beta" | "out_of_scope", string[]>>): ProjectConfig;
export declare const projectJsonPath: (root: string) => string;
export declare const readProjectConfig: (root: string) => ProjectConfig;
export declare function writeProjectConfig(root: string, config: ProjectConfig): string;
/** The optional-infra defaults shared by command test fixtures. */
export declare const ALL_OPTIONAL_INFRA_DISABLED: {
    readonly monitoring: false;
    readonly elk: false;
    readonly debezium: false;
    readonly golden_image: false;
    readonly verdaccio: false;
};
/** The phase map shared by command test fixtures. */
export declare const BASE_PHASES: {
    [k: string]: {
        name: string;
        description: string;
        enabledStacks: never[];
    };
};
/** The discovery glob shared by command test fixtures. */
export declare const SERVICES_DISCOVERY_PATHS: readonly ["services/**"];
