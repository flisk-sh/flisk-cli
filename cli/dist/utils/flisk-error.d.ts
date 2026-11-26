export declare class FliskError extends Error {
    suggestions: string[];
    exitCode: number;
    constructor(message: string, suggestions?: string[], exitCode?: number);
    display(): void;
    /** Display this error and exit the process with its exit code. */
    exit(): never;
}
/** Display a formatted error message. Does NOT exit. */
export declare function showError(message: string, context?: string, suggestions?: string[]): void;
