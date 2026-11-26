/** Fake TTY stdio triple for Ink render tests: writable stdin and 120x30 output panes. */
export declare function ttyStreams(): {
    stdin: NodeJS.ReadStream;
    stdout: NodeJS.WriteStream;
    stderr: NodeJS.WriteStream;
};
