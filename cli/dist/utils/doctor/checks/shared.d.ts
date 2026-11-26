/** Filesystem and source-scan helpers shared by the doctor check modules. */
export declare const EXEC_TIMEOUT_MS = 10000;
export declare const SOURCE_EXTENSIONS: RegExp;
export declare const TEST_FILE: RegExp;
export declare const SKIPPED_DIRS: Set<string>;
export declare const COMMENT_LINE: RegExp;
export declare function projectName(projectRoot: string): string | undefined;
export declare function readText(path: string): string | undefined;
export declare function listSourceFiles(dir: string): string[];
