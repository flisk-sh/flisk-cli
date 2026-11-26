export declare const git: (cwd: string, ...args: string[]) => string;
/** A local repository with a single commit; returns its path. */
export declare function singleCommitRepo(files?: Record<string, string>): string;
