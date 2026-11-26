/**
 * Resolves a path given on the command line (or by a calling agent) and refuses a NUL byte or a
 * target outside the working directory, home directory and temp directory. Symlinks are resolved
 * through the nearest existing parent, so a linked directory cannot hide a target outside those roots.
 * Containment is a prefix check on the resolved path.
 */
export declare function safeCliPath(input: string, label: string): string;
