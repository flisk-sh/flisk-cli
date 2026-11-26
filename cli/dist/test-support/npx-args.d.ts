/**
 * The npx arguments of a spawned npx call, from `--yes` on, whatever runs npx on the host: `npx` itself, or
 * `node npx-cli.js` on Windows (#4004). Lets a test assert what reaches npx without depending on the platform.
 */
export declare function npxArgs(spawnArgs: readonly string[] | undefined): string[];
