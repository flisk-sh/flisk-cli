import { type TempProjectSpec } from "../../../../test-support/temp-project.js";
/** A temp flisk project that is also the process cwd, so `findProjectRoot()` resolves it. */
export interface DoctorTestProject {
    /** Real (non-symlinked) project root. */
    root: string;
    /** Writes `content` to `<root>/<relativePath>`, creating parent directories. */
    writeFile(relativePath: string, content: string): void;
    /** Creates `<root>/<relativePath>` as a directory. */
    mkdir(relativePath: string): void;
    /**
     * Writes `services/<dir>/service.json` plus `files` (each relative to the service
     * dir). `appName` defaults to the last path segment, the way `flisk resource` names it.
     */
    writeService(dir: string, config: Record<string, unknown>, files?: Record<string, string>): void;
}
/**
 * Registers the cwd restore hook once per suite; the returned factory builds a fresh
 * temp project (and chdirs into it) inside `beforeEach` or a test body.
 */
export declare function useTempProject(): (spec?: TempProjectSpec) => DoctorTestProject;
