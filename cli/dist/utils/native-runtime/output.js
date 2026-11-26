import { LOG_SEQ_SUB_MILLISECOND } from "../log-cursors.js";
import { appendNativeLogLine } from "../native-log.js";
import { createPrivateKeyLineGuard } from "../secret-redaction.js";
/** Pipes a service child's stdout and stderr into its log file and the run's event callbacks. */
export function pipeServiceStreams(name, child, options) {
    pipeServiceOutput(name, child.stdout, "stdout", options);
    pipeServiceOutput(name, child.stderr, "stderr", options);
}
/** Pipes one service stream into its log file and the run's event callbacks. */
export function pipeServiceOutput(name, stream, kind, options) {
    if (!stream)
        return;
    const logPath = options.logPath;
    let pending = "";
    let redactionWarningShown = false;
    // One guard per stream: a private key printed over many lines is masked from its BEGIN line to its END line.
    const keyGuard = createPrivateKeyLineGuard();
    const emit = (line) => {
        let safeLine;
        try {
            safeLine = options.redactLine(keyGuard(line));
        }
        catch {
            // An unreadable env file must not turn a secret-scrubbing failure into a leak.
            if (!redactionWarningShown) {
                options.onNote?.(name, "output withheld: env secrets could not be read for redaction");
                redactionWarningShown = true;
            }
            return;
        }
        if (options.isCurrentRun?.() ?? true) {
            try {
                // A timestamp per line lets `flisk logs` merge services in order and honour --since; the number lets a
                // cursor read ask for only what came later. It has the same time-based scale as numbers derived from
                // Tilt/Docker lines, so the two runtimes can share one cursor. The log is rotated to <service>.log.1 at
                // NATIVE_LOG_MAX_BYTES, so it cannot grow without bound (#3720).
                const now = new Date();
                options.seq.value = Math.max(options.seq.value + 1, now.getTime() * LOG_SEQ_SUB_MILLISECOND);
                appendNativeLogLine(logPath, `${now.toISOString()} #${options.seq.value} ${safeLine}\n`, options.logSizes);
            }
            catch {
                // A full disk must not stop the service; the terminal still shows the line.
            }
        }
        options.onLine?.(name, safeLine, kind);
    };
    stream.setEncoding?.("utf-8");
    stream.on("data", (chunk) => {
        const lines = (pending + chunk).split(/\r?\n/);
        pending = lines.pop() ?? "";
        for (const line of lines)
            emit(line);
    });
    stream.on("end", () => {
        if (pending)
            emit(pending);
        pending = "";
    });
}
