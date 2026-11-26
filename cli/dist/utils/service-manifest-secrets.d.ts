/** `secrets` must be { required?: string[], optional?: string[], generate?: object, files?: array }: the generator fails on anything else. */
export declare function secretsErrors(manifest: Record<string, unknown>, displayPath: string): string[];
export declare function secretConflictWarnings(manifest: Record<string, unknown>, displayPath: string): string[];
