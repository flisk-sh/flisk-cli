/** A port the OS just handed out, for a test that starts a server on it. Safer than a guessed one under parallel workers. */
export declare function freePort(): Promise<number>;
