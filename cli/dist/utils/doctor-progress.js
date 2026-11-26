// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import chalk from "chalk";
import { doctorCheckName } from "./doctor-runner.js";
function progressSymbol(result) {
    if (!result || (!result.didPass && !result.isSkipped && !result.isWarning))
        return chalk.red("✗");
    if (result.isWarning)
        return chalk.yellow("⚠");
    if (result.isSkipped)
        return chalk.gray("○");
    return chalk.green("✓");
}
export function createDoctorProgress(options) {
    const pending = new Map();
    let lineShown = false;
    const clearLine = () => {
        if (lineShown)
            options.write("\r\x1b[2K");
        lineShown = false;
    };
    const redrawLine = () => {
        if (pending.size === 0) {
            clearLine();
            return;
        }
        const width = Math.max(20, (options.columns ?? 80) - 1);
        const line = `⏳ Checking: ${[...pending.values()].join(", ")}`;
        options.write(`\r\x1b[2K${line.length > width ? `${line.slice(0, width - 1)}…` : line}`);
        lineShown = true;
    };
    return {
        onCheckStart(check) {
            const name = doctorCheckName(check);
            pending.set(check, name);
            if (options.redraw) {
                redrawLine();
            }
            else {
                options.write(`${chalk.dim("→")} Checking ${name}\n`);
            }
        },
        onCheckFinish(check, result) {
            const name = pending.get(check) ?? result?.name ?? doctorCheckName(check);
            pending.delete(check);
            if (options.redraw) {
                redrawLine();
            }
            else {
                options.write(`${progressSymbol(result)} ${result?.name ?? name}\n`);
            }
        },
        finish() {
            if (options.redraw)
                clearLine();
        },
    };
}
