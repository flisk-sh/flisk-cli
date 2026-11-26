// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { runFlisk } from "../../test-support/index.js";

const CLI_SPAWN_TIMEOUT_MS = 30_000;

describe("flisk project --check in an empty folder", () => {
  it(
    "does not announce that a project is being initialised",
    () => {
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "flisk-check-banner-"));
      try {
        const result = runFlisk(["project", "--check"], { cwd, timeout: CLI_SPAWN_TIMEOUT_MS });
        const output = `${result.stdout}${result.stderr}`;

        expect(result.status).toBe(1);
        expect(output).not.toContain("Initializing");
        expect(output).toContain("Checking the Flisk project configuration");
        // Read-only: the folder is still empty afterwards.
        expect(fs.readdirSync(cwd)).toEqual([]);
      } finally {
        fs.rmSync(cwd, { recursive: true, force: true });
      }
    },
    CLI_SPAWN_TIMEOUT_MS,
  );
});
