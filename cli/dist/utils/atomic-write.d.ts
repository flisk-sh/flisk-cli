/**
 * Replaces `filePath` in one step. A plain writeFileSync truncates first, so an interrupt mid-write leaves a
 * half-written file that looks current; here readers see the old content or the new content, never a mix.
 * An identical file is left alone, so a repeat generation does not change its mtime (#3830).
 */
export declare function writeTextFileAtomic(filePath: string, content: string): void;
/**
 * Populates a unique sibling staging directory via `populate(stageDir)` and swaps it into
 * `targetDir`, avoiding in-place cpSync/unlink/chmod races across concurrent callers.
 * An identical tree is discarded instead, so repeat generation leaves mtimes alone (#3830).
 */
export declare function replaceDirectoryAtomicSync(targetDir: string, populate: (stageDir: string) => void): void;
/**
 * Async variant of `replaceDirectoryAtomicSync` for staging steps that perform async work
 * before swapping the completed tree into `targetDir`.
 */
export declare function replaceDirectoryAtomic(targetDir: string, populate: (stageDir: string) => Promise<void> | void): Promise<void>;
