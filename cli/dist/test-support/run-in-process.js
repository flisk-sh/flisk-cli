import { vi } from "vitest";
import { ProcessExitError } from "../utils/errors.js";
import { captureExit } from "./doubles.js";
/**
 * Runs a Commander command object in-process from `cwd` and captures its output. Use it for envelope-only and
 * flag-only cases; a case that exercises the top-level handler or the real request path stays a `runFlisk` spawn.
 * `process.exit` throws through `captureExit`, so the run stops where the command would exit. Commander keeps option
 * values between calls, so pass every flag a case needs on each call and never rely on an earlier one being absent.
 * The caller clears any discovery cache first, for example with `clearDiscoveryCache()`.
 */
export async function runCommandInProcess(command, args, cwd) {
    const exit = captureExit();
    let stdout = "";
    let stderr = "";
    const capture = (sink) => (chunk) => {
        if (sink === "stdout")
            stdout += String(chunk);
        else
            stderr += String(chunk);
        return true;
    };
    const out = vi.spyOn(process.stdout, "write").mockImplementation(capture("stdout"));
    const err = vi.spyOn(process.stderr, "write").mockImplementation(capture("stderr"));
    const log = vi.spyOn(console, "log").mockImplementation((...lines) => {
        stdout += `${lines.map(String).join(" ")}\n`;
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation((...lines) => {
        stderr += `${lines.map(String).join(" ")}\n`;
    });
    const cwdBefore = process.cwd();
    process.chdir(cwd);
    let status;
    try {
        await command.parseAsync([...args], { from: "user" }).catch((error) => {
            if (!(error instanceof ProcessExitError))
                throw error;
        });
    }
    finally {
        // Read the exit code before the restore: mockRestore clears the spy's recorded calls.
        status = exit.exit.mock.calls[0]?.[0];
        process.chdir(cwdBefore);
        out.mockRestore();
        err.mockRestore();
        log.mockRestore();
        errorLog.mockRestore();
        exit.exit.mockRestore();
    }
    return { stdout, stderr, status };
}
