/** A minimal valid `.flisk/project.json` body for the config command's extracted modules. */
export declare const configProjectJson: (name?: string, optionalInfra?: Record<string, boolean>) => {
    version: string;
    project: {
        name: string;
        version: string;
    };
    phases: {
        [k: string]: {
            name: string;
            description: string;
            enabledStacks: never[];
        };
    };
    optional_infra: {
        monitoring: boolean;
        elk: boolean;
        debezium: boolean;
        golden_image: boolean;
        verdaccio: boolean;
    };
    discovery: {
        paths: string[];
    };
};
/** Reads `.flisk/project.json` back from a temp project root. */
export declare const readProjectJson: (root: string) => {
    optional_infra: Record<string, boolean>;
};
/** Runs `fn` with `process.cwd()` inside `root` so `findProjectRoot` resolves the temp project. */
export declare function inProject<T>(root: string, fn: () => Promise<T>): Promise<T>;
