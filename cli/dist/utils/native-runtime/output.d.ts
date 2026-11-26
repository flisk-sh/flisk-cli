import type { ChildProcess } from "node:child_process";
/**
 * Where service output goes: each child's stdout and stderr are split into lines, scrubbed of secrets, stamped
 * and appended to the service's log file, and reported to `flisk up` through the event callbacks. The seq
 * counter and per-service log sizes are shared across the run's services so cursors and rotation stay coherent.
 */
/** What `pipeServiceOutput` needs beyond the stream itself. */
export interface ServiceOutputOptions {
    /** The service's log file (from `nativeLogPath`). */
    logPath: string;
    /** The run-wide line counter, shared so lines of different services never share a seq. */
    seq: {
        value: number;
    };
    /** Known size of each service log, shared by its stdout and stderr writers, for rotation (#3720). */
    logSizes: Map<string, number>;
    redactLine: (line: string) => string;
    onLine?: (service: string, line: string, stream: "stdout" | "stderr") => void;
    onNote?: (service: string, message: string) => void;
    /**
     * False once the service has a newer run: a child's stdio can outlive it (a descendant that inherited the pipe), and
     * its late output must not be logged after the new run's start marker, where it would be attributed to that run (#4693).
     * The terminal still shows the line.
     */
    isCurrentRun?: () => boolean;
}
/** Pipes a service child's stdout and stderr into its log file and the run's event callbacks. */
export declare function pipeServiceStreams(name: string, child: ChildProcess, options: ServiceOutputOptions): void;
/** Pipes one service stream into its log file and the run's event callbacks. */
export declare function pipeServiceOutput(name: string, stream: NodeJS.ReadableStream | null, kind: "stdout" | "stderr", options: ServiceOutputOptions): void;
