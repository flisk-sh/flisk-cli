export declare const MISSING_COMPOSE_MESSAGE = "`docker compose` was not found on PATH. Install the Compose plugin to run the exporter parity tests.";
export interface ParityFinding {
    /** The documented category, for assertions on the documented set (e.g. "networks", "service-name"). */
    kind: string;
    message: string;
}
export interface ComposeParityReport {
    /** Differences the importer and exporter document: reported for the record, not failures. */
    documented: ParityFinding[];
    /** Differences that are not documented: a test fails on any of these. */
    differences: ParityFinding[];
}
interface ComposeModel {
    name?: string;
    services?: Record<string, Record<string, unknown>>;
    networks?: Record<string, unknown>;
    volumes?: Record<string, Record<string, unknown> | null>;
    [key: string]: unknown;
}
/** Whether `docker compose` runs. Probed once, like `tiltAvailable` in ./starlark.js. */
export declare function composeConfigAvailable(): boolean;
/**
 * The normalized Compose model of one file: `docker compose config --format json --no-interpolate` parses it the
 * way `docker compose up` would, without resolving `${...}` (so no .env values are needed). Throws with the
 * command's own output when the file does not parse.
 */
export declare function composeConfigModel(composeFile: string, timeout?: number): ComposeModel;
/**
 * The parity report for two Compose files: `original` is the adopter's own file, `generated` the one
 * `flisk export compose` wrote. `differences` must be empty for parity; `documented` is the list the spec allows.
 */
export declare function composeConfigParity(originalFile: string, generatedFile: string): ComposeParityReport;
/**
 * The pure half of `composeConfigParity`: two normalized models in, the report out. Exported so the documented
 * differences can be unit-tested without Docker.
 */
export declare function compareConfigModels(original: ComposeModel, generated: ComposeModel): ComposeParityReport;
export {};
