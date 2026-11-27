import type { RepoConfig } from "../../types/index.js";
export type GitRunner = (args: string[], options?: {
    cwd?: string;
}) => Promise<string>;
export declare const defaultGitRunner: GitRunner;
export interface CloneRepoResult {
    url: string;
    dir: string;
    cloned: boolean;
    skipped: boolean;
    failed: boolean;
    reason?: string;
}
/** Replaces user-info (tokens, passwords) in any URL inside a string, so it can be printed safely. */
export declare function redactRepoUrl(text: string): string;
/** How the destination of a configured repository stands on disk. */
export type RepoDestinationState = "cloned" | "missing" | "not a git repo";
/**
 * Classifies a configured repository destination the same way `repos clone` decides: clone leaves
 * any existing destination untouched, and a destination counts as cloned only when it holds a
 * `.git` entry. A folder without `.git` is "not a git repo" and `repos clone` will skip it.
 */
export declare function classifyRepoDestination(targetPath: string): RepoDestinationState;
/**
 * Clones a single repository if its destination directory does not already exist.
 * Leaves existing directories untouched.
 * A failed attempt passes the parent folders it created to `cleanupParents`; a caller that runs
 * several clones at once uses it to postpone the removal until they have all finished.
 */
export declare function cloneRepo(repo: RepoConfig, projectRoot: string, runner?: GitRunner, cleanupParents?: (paths: string[]) => void): Promise<CloneRepoResult>;
/** One decision of a clone plan: the repository would be cloned, or its existing folder kept. */
export interface RepoClonePlanEntry {
    url: string;
    dir: string;
    branch?: string;
    action: "clone" | "keep";
    reason?: string;
}
/**
 * Reports what `flisk repos clone` would do, without creating a folder or starting git (#4256).
 * It runs the same validation as a real clone and reads only the filesystem to decide which
 * destinations are missing, so `--dry-run` fails on the same bad configuration a real run fails on.
 */
export declare function planRepoClones(projectRoot: string, repos?: RepoConfig[]): RepoClonePlanEntry[];
/**
 * Clones all missing repositories configured in the project.
 * A repository that fails is recorded in its result (`failed: true`) instead of
 * aborting the loop, so every configured repository is attempted and reported.
 */
export declare function cloneMissingRepos(projectRoot: string, repos?: RepoConfig[], runner?: GitRunner): Promise<CloneRepoResult[]>;
/**
 * Resolves the `[dir...]` arguments of `flisk repos clone` to configured entries: no argument
 * selects every repository, and an unknown `dir` fails before anything is cloned, with the
 * valid dirs listed like the other "unknown name, here are the valid ones" errors (#4969).
 */
export declare function selectConfiguredRepos(repos: readonly RepoConfig[], dirs: readonly string[]): RepoConfig[];
