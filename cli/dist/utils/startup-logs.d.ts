/** The most of a failure message `flisk up` prints for one resource. */
export declare const MAX_FAILURE_MESSAGE = 300;
/** The last lines of a log that have text, joined on one line, keeping the end when it is too long. */
export declare function logTail(log: string, lines?: number): string | null;
/**
 * The last `ERROR:`/`error:` line of an image build and the four lines before it. Docker's reason is on that line, but
 * the lines above it (the step and command that failed) are what make it readable, so keep them instead of only the
 * one-line summary used for health checks.
 */
export declare function buildOutputTail(log: string, lines?: number): string | null;
/**
 * The last `ERROR: ...` line of a resource log, without that prefix, or null. Tilt may put the resource name and a
 * separator before each line, so the marker can come after other text.
 */
export declare function loggedErrorLine(log: string): string | null;
/** "last line" or "last 3 lines". */
export declare function lastLines(count: number): string;
export declare function capStart(text: string): string;
/** Keep the end of a log excerpt, where the reason is, when it is too long for one message. */
export declare function capEnd(text: string): string;
