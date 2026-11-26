import { type DemoRootOptions } from "../utils/demo-args.js";
/** What the one-command flow needs from the boot tail. The optional fields default to the real process. */
export interface DemoBootstrapInput {
    argv: readonly string[];
    rootOptions: DemoRootOptions;
    /** The CLI package version, shown by the stale-version notice and the final frame. */
    version: string;
    platform?: string;
    env?: NodeJS.ProcessEnv;
    cwd?: () => string;
    home?: () => string;
}
/**
 * `flisk <template>` and `flisk --template <name>`: the one-command flow. It clones a starter,
 * installs the CLI globally, boots the stack and opens the frontend.
 *
 * @returns The exit code once the flow finished or was refused, or `undefined` when argv is not
 *          the one-command flow and boot should continue to `parseAsync`.
 */
export declare function runDemoBootstrap(input: DemoBootstrapInput): Promise<number | undefined>;
/** `1 file`, `240 files`. The frame is read by people, so the count has to agree with itself. */
export declare function countLabel(count: number, noun: string): string;
/** Counts the files under `root`, skipping the directories in `skip`. */
export declare function countFiles(root: string, skip?: string[]): number;
/**
 * The post-demo note about the host install: where it landed, how large it is and that it is
 * disposable. The size is measured after the run, so the number is the one on disk now (#5344).
 */
export declare function demoDiskNotice(folder: string, home?: () => string): string;
/**
 * The first machine check that failed in the stack output.
 *
 * `up` reports "exited with code 1" when a check fails before Tilt starts, which says
 * nothing. The check line above it says what is actually missing.
 */
export declare function firstMachineFailure(raw: string | undefined): string | undefined;
/** Writes the child output and Tiltfile evaluation count somewhere the run can be inspected later. */
export declare function writeLog(lines: string[], home?: () => string): string | undefined;
