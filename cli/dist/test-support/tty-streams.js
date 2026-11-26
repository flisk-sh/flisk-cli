// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { PassThrough } from "node:stream";
/** Fake TTY stdio triple for Ink render tests: writable stdin and 120x30 output panes. */
export function ttyStreams() {
    const stdin = new PassThrough();
    Object.assign(stdin, {
        isTTY: true,
        isRaw: false,
        setRawMode: () => { },
        ref: () => { },
        unref: () => { },
    });
    const stdout = new PassThrough();
    Object.assign(stdout, { isTTY: true, columns: 120, rows: 30 });
    const stderr = new PassThrough();
    Object.assign(stderr, { isTTY: true, columns: 120, rows: 30 });
    return { stdin, stdout, stderr };
}
