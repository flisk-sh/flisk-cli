// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export interface DirectoryStats {
  /** Number of regular files below the root. */
  files: number;
  /** Sum of the sizes of those files, in bytes. */
  bytes: number;
}

/**
 * Count the files and bytes under `root`, skipping directories named in `skip`.
 *
 * A demo reports both numbers to the user, so an unreadable path (or a file that vanishes
 * mid-walk) must not fail the command: the result is an estimate, not input to the stack.
 */
export function directoryStats(root: string, skip: string[] = []): DirectoryStats {
  const totals: DirectoryStats = { files: 0, bytes: 0 };
  const walk = (dir: string): void => {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (skip.includes(entry.name)) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(path);
        } else if (entry.isFile()) {
          totals.files += 1;
          try {
            totals.bytes += statSync(path).size;
          } catch {
            // A file removed while we walk is not worth failing a user-facing estimate.
          }
        }
      }
    } catch {
      // An unreadable directory must not cost the caller its result.
    }
  };
  walk(root);
  return totals;
}
