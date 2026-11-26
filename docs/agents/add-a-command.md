# Playbook: add a CLI command

A short checklist for adding a top-level `flisk <name>` command. The paths and snippets below are the ones the current `version` command uses; open that file alongside this page. Work from the repository root, sign off the commit, and run the checks in [the contributor guide](../../.github/CONTRIBUTING.md) before opening a PR.

## Checklist

1. **Create the command module** at `cli/src/commands/<name>.ts`. Export a Commander `Command` named `<name>Command`, with a description, aliases and options. Use `cli/src/commands/version.ts` as the smallest example:

   ```ts
   import { Command } from "commander";

   export const versionCommand = new Command("version")
     .description("Display version number")
     .alias("v")
     .option("--json", "Output a versioned JSON envelope", false)
     .action((options: { json?: boolean }) => {
       console.log(versionCommand.opts().json ? "{...}" : "1.2.3");
     });
   ```

   Keep the `.description()` and option help strings accurate: they become both `--help` output and shell completions.

2. **Register the command** in `cli/src/commands/registry.ts`. Import the export and add it to `getRegisteredCommands()` in the order it should appear in `flisk --help`. This one list is read by `cli/src/program.ts` (which builds the real Commander program) and by `cli/src/commands/completion-candidates.ts` (which builds completion candidates), so there is no separate completion list to edit.

3. **Regenerate the generated file and register lazy dispatch.** `npm --prefix cli run build` runs `cli/scripts/generate-command-specs.mjs`, which rewrites only `cli/src/commands/command-specs.generated.ts`, the lightweight spec table that `cli/src/boot/program.ts` uses for `--help` and cheap argument validation. Never edit it by hand.

   The generator does not touch `cli/src/commands/lazy-command.ts`. Add an entry for the new command to its `LAZY_COMMANDS` map yourself (`<name>: { module: "./<name>.js", exportName: "<name>Command" }`); without it the command appears in `--help` but running it throws `No lazy command module is registered`. Commit the generated file and the new `cli/dist/` output (force-add new files with `git add -f cli/dist` if gitignore hides them). `cli/src/commands/__tests__/command-specs.test.ts` fails if the spec table and real program disagree.

4. **Add the help-table row** in `cli/src/commands/help.ts` under the matching `COMMAND_GROUPS` entry if the command should appear in the custom `flisk --help` table:

   ```ts
   { name: "version, -v", desc: "Display version number", alias: "" },
   ```

   The `name` field may list aliases separated by commas, and `alias` holds example arguments or flags.

5. **Update the user-facing command tables** when the command is one users should discover:
   - `README.md`, in the `## Commands` table ("You want to / Flisk does / Command").
   - `cli/README.md`, in the `## Cheat sheet` table, and `docs/cheat-sheet.md` for every flag.

   Small internal or plumbing commands can skip these tables; say so in the PR description.

6. **Add tests** in `cli/src/commands/__tests__/<name>.test.ts`. `version.test.ts` shows the pattern: build a fresh `new Command().exitOverride()`, `addCommand(<name>Command)`, spy on `console.log`, then `await program.parseAsync(args, { from: "user" })`. Cover the default output, each flag and any error path. Use `createMachineEnvelope` from `cli/src/utils/machine-output.ts` when the command supports `--json`, so its output matches every other machine-readable command.

7. **Verify** with `npm --prefix cli run check:dist`, `npm --prefix cli run typecheck`, `npm --prefix cli run lint` and `bun run test -- <name>`. Then try the command from a scratch project, calling the CLI by its absolute path (`node /path/to/flisk/cli/bin/flisk.js <name> --help`), since a relative `cli/bin/flisk.js` does not resolve there. See step 6 of the [contributor quick start](../contributing/quick-start.md#6-try-your-build).

## Common traps

- Adding the file but forgetting `registry.ts`: the command does not exist in `flisk --help` and completions never offer it.
- Hand-editing `command-specs.generated.ts`: the next build overwrites it. Forgetting the `LAZY_COMMANDS` entry in `lazy-command.ts`: the command is listed in help but fails when run.
- Forgetting the `cli/dist/` commit: CI's "cli/dist is current" check fails, and forks do not get the bot's auto-rebuild.
- A command that reads a running stack needs Docker/Tilt for its e2e test; a pure option parser does not. See [writing an e2e test](../contributing/05-write-e2e.md).
