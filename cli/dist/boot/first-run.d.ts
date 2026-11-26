/**
 * The bare `flisk` run is a new user's first contact: report the machine checks and the next
 * commands, then end the boot with the preflight result. Any other argv shape continues booting.
 *
 * @returns The exit code for a bare invocation, or `undefined` when boot should continue.
 */
export declare function runFirstRunMigration(argv: readonly string[]): Promise<number | undefined>;
