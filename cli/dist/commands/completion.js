// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
/**
 * The shell completion scripts.
 *
 * The scripts are rendered from `commands/completion-candidates.ts`, which reads the registered
 * commands, their flags and the framework, language and resource-type registries. A new command or
 * a new registry entry therefore shows up in all four shells without editing a list here. The
 * shared table-to-fragments logic lives in `commands/completion-core.ts`; each shell renderer in
 * `commands/completion-<shell>.ts` holds only that shell's syntax.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import chalk from "chalk";
import { Command } from "commander";
import { FliskError, showError } from "../utils/errors.js";
import { safeCliPath } from "../utils/safe-cli-path.js";
import { renderBash } from "./completion-bash.js";
import { buildCompletionCandidates } from "./completion-candidates.js";
import { renderFish } from "./completion-fish.js";
import { renderPowerShell } from "./completion-powershell.js";
import { SUPPORTED_SHELLS } from "./completion-shells.js";
import { renderZsh } from "./completion-zsh.js";
/** Renders the completion script of one shell. */
export function renderCompletionScript(shell, candidates) {
    switch (shell) {
        case "bash":
            return renderBash(candidates);
        case "zsh":
            return renderZsh(candidates);
        case "fish":
            return renderFish(candidates);
        case "powershell":
            return renderPowerShell(candidates);
    }
}
// --output is a file the user names: resolve it, and refuse a NUL byte or an existing directory.
function resolveOutputPath(output) {
    const path = safeCliPath(output, "--output");
    if (existsSync(path) && statSync(path).isDirectory()) {
        throw new FliskError(`--output ${output} is a directory; give a file path`, [
            `Add a file name, for example ${join(output, "flisk-completion")}`,
        ]);
    }
    return path;
}
const POWERSHELL_START = "# FLISK-CLI-COMPLETION-START";
const POWERSHELL_END = "# FLISK-CLI-COMPLETION-END";
export const completionCommand = new Command("completion")
    .argument("[shell]", "Target shell (bash, zsh, fish, powershell)")
    .description("Generate shell completion scripts")
    .option("-s, --shell <shell>", "Target shell (bash, zsh, fish, powershell)")
    .option("-o, --output <path>", "Output file path (default: stdout)")
    .option("--install", "Install completion; prints any shell configuration steps still needed")
    .addHelpText("after", "\nExamples:\n  flisk completion zsh --install\n  flisk completion bash --install\n  flisk completion fish --install")
    .action((shellArgument, options, command) => {
    // The argument and the option both name the shell, so two different values would silently
    // ignore one of them.
    if (shellArgument !== undefined &&
        options.shell !== undefined &&
        shellArgument.trim().toLowerCase() !== options.shell.trim().toLowerCase()) {
        new FliskError(`Conflicting shells: argument "${shellArgument}" does not match --shell "${options.shell}".`, ["Pass the shell once, either as the argument or with --shell"]).exit();
    }
    const requestedShell = options.shell ?? shellArgument;
    const environmentShell = basename(process.env.SHELL ?? "")
        .replace(/\.exe$/i, "")
        .toLowerCase();
    const defaultShell = SUPPORTED_SHELLS.includes(environmentShell)
        ? environmentShell
        : "bash";
    const shell = (requestedShell ?? defaultShell).toLowerCase();
    if (requestedShell === undefined) {
        console.error(chalk.gray(`Using ${shell} completion`));
    }
    if (!SUPPORTED_SHELLS.includes(shell)) {
        showError(`Unsupported shell: ${shell}`, "Supported shells: bash, zsh, fish, powershell");
        process.exit(1);
    }
    // The candidates come from the program this command is registered on, so the completions and
    // the CLI always offer the same commands and flags.
    const program = command.parent;
    if (!program) {
        console.error(chalk.red("❌ The completion command must be registered on the flisk program."));
        process.exit(1);
    }
    const candidates = buildCompletionCandidates(program);
    const completionScript = renderCompletionScript(shell, candidates);
    const filename = shell === "bash"
        ? "flisk-completion.bash"
        : shell === "zsh"
            ? "_flisk"
            : shell === "fish"
                ? "flisk.fish"
                : "Microsoft.PowerShell_profile.ps1";
    if (options.install) {
        const home = homedir();
        let installPath;
        let installInstructions;
        switch (shell) {
            case "powershell": {
                const docs = join(home, "Documents");
                const ps7 = process.env.PSModulePath?.includes(join("Documents", "PowerShell", "Modules"));
                const profileDir = join(docs, ps7 ? "PowerShell" : "WindowsPowerShell");
                installPath = join(profileDir, filename);
                mkdirSync(profileDir, { recursive: true });
                const existing = existsSync(installPath) ? readFileSync(installPath, "utf-8") : "";
                const block = `${POWERSHELL_START}\n${completionScript}\n${POWERSHELL_END}`;
                // The marked block is replaced with the new script, without a regular expression.
                const blockStart = existing.indexOf(POWERSHELL_START);
                const blockEnd = existing.indexOf(POWERSHELL_END, blockStart);
                const updated = blockStart >= 0 && blockEnd > blockStart
                    ? existing.slice(0, blockStart) +
                        block +
                        existing.slice(blockEnd + POWERSHELL_END.length)
                    : `${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}${block}\n`;
                writeFileSync(installPath, updated, "utf-8");
                installInstructions = "\n# Close and reopen PowerShell to load the completion.";
                break;
            }
            case "bash": {
                installPath = join(home, ".bash_completion.d", filename);
                const bashDir = join(home, ".bash_completion.d");
                if (!existsSync(bashDir)) {
                    mkdirSync(bashDir, { recursive: true });
                }
                installInstructions = `\n# Add to ~/.bashrc:\nsource ~/.bash_completion.d/${filename}`;
                break;
            }
            case "zsh": {
                installPath = join(home, ".zsh", "completions", filename);
                const zshDir = join(home, ".zsh", "completions");
                if (!existsSync(zshDir)) {
                    mkdirSync(zshDir, { recursive: true });
                }
                installInstructions =
                    "\n# Add to ~/.zshrc:\nfpath+=(~/.zsh/completions)\nautoload -U compinit && compinit";
                break;
            }
            case "fish": {
                installPath = join(home, ".config", "fish", "completions", filename);
                const fishDir = join(home, ".config", "fish", "completions");
                if (!existsSync(fishDir)) {
                    mkdirSync(fishDir, { recursive: true });
                }
                installInstructions = "Fish completions loaded automatically";
                break;
            }
            default:
                installPath = "";
                installInstructions = "";
        }
        // PowerShell already wrote the merged profile above; a plain write here would drop the user's other profile lines.
        if (shell !== "powershell") {
            writeFileSync(installPath, completionScript, "utf-8");
        }
        console.log(chalk.green(`✅ Installed ${shell} completion to:`));
        console.log(chalk.cyan(`   ${installPath}`));
        console.log(chalk.yellow(installInstructions));
    }
    else if (options.output) {
        const outputPath = resolveOutputPath(options.output);
        writeFileSync(outputPath, completionScript, "utf-8");
        console.log(chalk.green(`✅ Wrote ${shell} completion to:`));
        console.log(chalk.cyan(`   ${outputPath}`));
        const hints = {
            bash: "# Source this file in your shell; add the source command to ~/.bashrc to load it automatically.",
            zsh: "# Put this file in a folder on $fpath as _flisk, then run: autoload -U compinit && compinit",
            fish: "# Copy this file to ~/.config/fish/completions/ as flisk.fish.",
            powershell: "# Dot-source this file in PowerShell; add the command to your $PROFILE to load it automatically.",
        };
        console.log(chalk.yellow(hints[shell]));
    }
    else {
        console.log(completionScript);
    }
});
