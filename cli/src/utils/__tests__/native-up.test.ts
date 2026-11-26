// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTempDir } from "../../test-support/index.js";
import { runVariables } from "../native-up.js";

const originalEnv = process.env;

afterEach(() => {
  vi.unstubAllEnvs();
  // A test that replaced process.env outright gets the real object back.
  process.env = originalEnv;
});

/** Runs `fn` with `process.env` replaced by `env`. Only a replaced object can hold a real `undefined` value: assigning `env.X = undefined` stores the string "undefined". */
function withShellEnv<T>(env: NodeJS.ProcessEnv, fn: () => T): T {
  process.env = env;
  try {
    return fn();
  } finally {
    process.env = originalEnv;
  }
}

describe("runVariables", () => {
  it("returns only the shell's variables when the project has no .env file", () => {
    const root = createTempDir();
    const shell = { ...process.env, FLISK_NU_SHELL_ONLY: "from-shell" };

    const vars = withShellEnv(shell, () => runVariables(root));

    expect(vars).toEqual({
      ...shell,
      FLISK_CHECKOUT_ID: expect.any(String),
      FLISK_CHECKOUT_NAME: expect.any(String),
    });
  });

  it("uses a .env value the shell does not set", () => {
    const root = createTempDir();
    writeFileSync(join(root, ".env"), "FLISK_NU_FILE_ONLY=from-file\n");
    vi.stubEnv("FLISK_NU_FILE_ONLY", undefined);

    expect(runVariables(root).FLISK_NU_FILE_ONLY).toBe("from-file");
  });

  it("lets the shell win when the .env and the shell set the same name", () => {
    const root = createTempDir();
    writeFileSync(join(root, ".env"), "FLISK_NU_SHARED=from-file\n");
    vi.stubEnv("FLISK_NU_SHARED", "from-shell");

    expect(runVariables(root).FLISK_NU_SHARED).toBe("from-shell");
  });

  it("reads envFilePath instead of <projectRoot>/.env when given", () => {
    const root = createTempDir();
    writeFileSync(join(root, ".env"), "FLISK_NU_PROJECT_ENV=from-dotenv\n");
    writeFileSync(join(root, "custom.env"), "FLISK_NU_CUSTOM_ENV=from-custom\n");
    vi.stubEnv("FLISK_NU_PROJECT_ENV", undefined);
    vi.stubEnv("FLISK_NU_CUSTOM_ENV", undefined);

    const vars = runVariables(root, join(root, "custom.env"));

    expect(vars.FLISK_NU_CUSTOM_ENV).toBe("from-custom");
    expect(vars).not.toHaveProperty("FLISK_NU_PROJECT_ENV");
  });

  it("drops shell entries whose value is undefined instead of blanking a .env value", () => {
    const root = createTempDir();
    writeFileSync(join(root, ".env"), "FLISK_NU_KEPT=from-file\n");
    const shell = {
      ...process.env,
      FLISK_NU_KEPT: undefined,
      FLISK_NU_GONE: undefined,
    };

    const vars = withShellEnv(shell, () => runVariables(root));

    expect(vars.FLISK_NU_KEPT).toBe("from-file");
    expect(vars).not.toHaveProperty("FLISK_NU_GONE");
  });
});
