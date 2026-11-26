/** A `service.json` body. A string is written as given, which lets a test plant malformed JSON. */
export type ServiceSpec = Record<string, unknown> | string;
export interface TempProjectSpec {
    /**
     * `.flisk/project.json`. An object is serialized, a string is written as given. Defaults to `{}`.
     * Pass `null` for a directory without a `.flisk` folder.
     */
    projectJson?: Record<string, unknown> | string | null;
    /** `services/<stack>/<app>/service.json`, with `appName` and `stack` filled in. */
    stacks?: Record<string, Record<string, ServiceSpec>>;
    /** `services/<relative dir>/service.json`, with `appName` set to the last path segment. */
    resources?: Record<string, ServiceSpec>;
    /**
     * Files under `.flisk/.flisk-out`. A list creates empty files, a record maps file name to content.
     */
    generated?: readonly string[] | Record<string, string>;
    /** Any other files, keyed by path relative to the project root. */
    files?: Record<string, string>;
}
/** Minimal valid `.flisk/project.json` for tests that only care about generated-file drift. */
export declare function projectJsonFixture(name: string): Record<string, unknown>;
/**
 * Creates a temporary flisk project on disk and returns its real path. It is removed when the current test finishes.
 * Call it from inside a test or a `beforeEach`.
 */
export declare function createTempProject(spec?: TempProjectSpec): string;
/**
 * A `.flisk/project.json` body that passes validation: the four phases and the optional_infra
 * flags with every discovery root covered by `discoveryPaths`.
 */
export declare function validProjectJson(options: {
    name: string;
    version?: string;
    discoveryPaths: string[];
}): Record<string, unknown>;
/** Creates an empty temporary directory that is removed when the current test finishes. */
export declare function createTempDir(prefix?: string): string;
