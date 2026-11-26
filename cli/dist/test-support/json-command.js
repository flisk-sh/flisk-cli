import { vi } from "vitest";
/**
 * Runs a Commander command that prints a JSON envelope, capturing its output and exit spy. `inspect` can assert on
 * them while the spies are still live; all spies are restored before the function returns.
 */
export async function captureJsonCommand(command, args, inspect) {
    const lines = [];
    const log = vi.spyOn(console, "log").mockImplementation((...parts) => {
        lines.push(parts.map(String).join(" "));
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => { });
    const exit = vi.spyOn(process, "exit").mockImplementation((() => { }));
    try {
        await command.parseAsync(args, { from: "user" });
        await inspect?.({ exit, lines });
    }
    finally {
        log.mockRestore();
        error.mockRestore();
        exit.mockRestore();
    }
    return { lines };
}
