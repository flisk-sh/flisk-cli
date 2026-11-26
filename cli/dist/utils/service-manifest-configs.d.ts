/** `configs` must be an array of { name, source, target, uid?, gid?, mode? } (#3059). */
export declare function configsErrors(manifest: Record<string, unknown>, displayPath: string): string[];
