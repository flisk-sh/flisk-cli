export interface Envelope {
    schemaVersion: number;
    data: any;
    errors: Array<{
        code: string;
        message: string;
        suggestions?: string[];
    }>;
}
/**
 * Asserts that `stdout` is exactly one line of JSON carrying `schemaVersion`, `data` and `errors`, and returns it.
 */
export declare function parseEnvelope(stdout: string): Envelope;
