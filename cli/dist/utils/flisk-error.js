// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
// A leaf module: it imports nothing from utils/errors.ts or utils/paths.ts, so both can throw a FliskError without a
// circular import (a cycle made vi.mock of paths.js miss errors.ts and failed 22 tests, #5546).
import chalk from "chalk";
import { rememberShownError } from "./last-error.js";
export class FliskError extends Error {
    suggestions;
    exitCode;
    constructor(message, suggestions = [], exitCode = 1) {
        super(message);
        this.name = "FliskError";
        this.suggestions = suggestions;
        this.exitCode = exitCode;
    }
    display() {
        showError(this.message, undefined, this.suggestions);
    }
    /** Display this error and exit the process with its exit code. */
    exit() {
        this.display();
        process.exit(this.exitCode);
    }
}
/** Display a formatted error message. Does NOT exit. */
export function showError(message, context, suggestions) {
    rememberShownError({ message, suggestions: suggestions ?? [] });
    console.error(chalk.red(`❌ ${message}`));
    if (context) {
        console.error(chalk.gray(`   ${context}`));
    }
    if (suggestions && suggestions.length > 0) {
        console.error(chalk.yellow("\n💡 Suggestions:"));
        for (const s of suggestions) {
            console.error(chalk.cyan(`   → ${s}`));
        }
    }
}
