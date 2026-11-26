export declare function findOnPath(command: string, pathEnv?: string | undefined, platform?: NodeJS.Platform): string | null;
/**
 * The JavaScript package managers a generated package.json can install and run through, most common
 * first. `bun run` covers the `node` calls and `#!/usr/bin/env node` bins inside scripts itself, so a
 * machine with only Bun needs nothing else; npm, pnpm and yarn are Node programs.
 */
export declare const JS_PACKAGE_MANAGERS: readonly ["npm", "bun", "pnpm", "yarn"];
/**
 * The package manager a scaffolded package.json installs and runs with: the first one on this
 * machine, npm when none is found (the missing-program check then reports it, as before).
 */
export declare function localPackageManager(onPath?: (program: string) => boolean): string;
export declare function findAllOnPath(command: string): string[];
