export declare const VALID_PROJECT_CONFIG: {
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
/** A temp project holding `VALID_PROJECT_CONFIG` in `.flisk/project.json`; removed when the test finishes. */
export declare function makeDownTempProject(): string;
