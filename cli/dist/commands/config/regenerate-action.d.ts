/**
 * The `flisk config regenerate` action: a `--json` envelope, a grouped diff on `--dry-run`,
 * or a rewrite of the master files.
 */
export declare function regenerateAction(options: {
    dryRun?: boolean;
    ignoreVersion?: boolean;
    json?: boolean;
}): Promise<void>;
