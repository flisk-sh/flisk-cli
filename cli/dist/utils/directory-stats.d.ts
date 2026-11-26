export interface DirectoryStats {
    /** Number of regular files below the root. */
    files: number;
    /** Sum of the sizes of those files, in bytes. */
    bytes: number;
}
/**
 * Count the files and bytes under `root`, skipping directories named in `skip`.
 *
 * A demo reports both numbers to the user, so an unreadable path (or a file that vanishes
 * mid-walk) must not fail the command: the result is an estimate, not input to the stack.
 */
export declare function directoryStats(root: string, skip?: string[]): DirectoryStats;
