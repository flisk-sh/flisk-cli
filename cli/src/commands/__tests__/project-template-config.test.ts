// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTempDir,
  git,
  parseEnvelope,
  runFlisk,
  singleCommitRepo,
} from "../../test-support/index.js";
import { projectNeedsDatabaseKeys } from "../../utils/capabilities.js";
import { parseEnv, validateEnvFile } from "../../utils/env-validator.js";
import { PROJECT_TEMPLATES } from "../../utils/project-templates.js";
import { cloneProjectTemplate } from "../project.js";

const TEST_KEY = "config-test-template";

const readProjectConfig = (dest: string) =>
  JSON.parse(readFileSync(join(dest, ".flisk", "project.json"), "utf-8"));

/** Registers a one-commit repo as the test template. */
function registerRepoTemplate(files: Record<string, string>): void {
  PROJECT_TEMPLATES[TEST_KEY] = {
    repo: pathToFileURL(singleCommitRepo(files)).href,
    description: "test template",
  };
}

const projectJson = (name: string) => JSON.stringify({ version: "1.0", project: { name } });

/** Scaffolds a template into a fresh directory and returns where it went. */
async function scaffold(
  template: string,
  name: string,
  options = { quiet: true },
): Promise<string> {
  const dest = join(createTempDir(), name);
  await cloneProjectTemplate(template, dest, [], options);
  return dest;
}

afterEach(() => {
  delete PROJECT_TEMPLATES[TEST_KEY];
});

describe("cloneProjectTemplate project config", () => {
  it("copies the bundled example with a project config", async () => {
    const dest = await scaffold("example", "flisk-example");
    expect(existsSync(join(dest, ".flisk", "project.json"))).toBe(true);
    const config = readProjectConfig(dest);
    expect(config.project.name).toBe("flisk-example");
    expect(config.discovery.paths).toEqual(["services/*/*"]);
  });

  it("makes the copied example a project root", async () => {
    const dest = await scaffold("example", "flisk-example");
    const result = runFlisk(["project", "--check", "--json"], { cwd: dest });
    const data = parseEnvelope(result.stdout).data;
    expect(data.hasProjectJson).toBe(true);
  });

  it("passes config verify on the first run after scaffolding (#4196)", async () => {
    const dest = await scaffold("example", "flisk-example");

    const result = runFlisk(["config", "verify", "--json"], { cwd: dest });
    expect(result.status, result.stderr).toBe(0);
    expect(parseEnvelope(result.stdout).data.valid).toBe(true);
  }, 120_000);

  it("writes .env with working defaults when scaffolding a starter (#3883)", async () => {
    const dest = await scaffold("example", "flisk-example");

    const envPath = join(dest, ".env");
    expect(existsSync(envPath)).toBe(true);
    const env = parseEnv(readFileSync(envPath, "utf-8"));
    expect(env.get("TILT_ENV")).toBe("dev");
    expect(env.get("DB_PASSWORD")).toMatch(/^[0-9a-f]{32}$/);
    expect(env.get("JWT_SECRET")).toMatch(/^[0-9a-f]{64}$/);

    // The two `flisk doctor` findings of the issue report, checked the way doctor checks them:
    // the master files exist and the env validation it runs reports nothing missing.
    expect(existsSync(join(dest, ".flisk", ".flisk-out", "spec.master"))).toBe(true);
    expect(validateEnvFile(dest, { databaseKeys: projectNeedsDatabaseKeys(dest) }).missing).toEqual(
      [],
    );
  });

  it("still writes .env when the starter's master files cannot be generated", async () => {
    registerRepoTemplate({ ".flisk/project.json": projectJson("incomplete") });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const dest = await scaffold(TEST_KEY, "my-app");
      expect(warnSpy.mock.calls.flat().join("\n")).toContain("Could not generate the master files");
      expect(existsSync(join(dest, ".env"))).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("keeps a .env the starter ships and completes the missing keys (#3883)", async () => {
    registerRepoTemplate({
      ".env": "TILT_ENV=staging\nDB_PASSWORD=keep-this-password\n",
      ".flisk/project.json": projectJson("shipped-env"),
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const dest = await scaffold(TEST_KEY, "my-app");
      const env = parseEnv(readFileSync(join(dest, ".env"), "utf-8"));
      expect(env.get("TILT_ENV")).toBe("staging");
      expect(env.get("DB_PASSWORD")).toBe("keep-this-password");
      expect(env.get("JWT_SECRET")).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("does not write .env for a generated local-process starter (#3883)", async () => {
    const dest = await scaffold("swarm", "swarm-app");
    expect(existsSync(join(dest, ".env"))).toBe(false);
  });

  it("writes a project config for a cloned repo template", async () => {
    registerRepoTemplate({ "version.txt": "1.0" });
    const dest = await scaffold(TEST_KEY, "my-app");
    expect(existsSync(join(dest, ".flisk", "project.json"))).toBe(true);
    const config = readProjectConfig(dest);
    expect(config.project.name).toBe("my-app");
  });

  it("keeps a project config the template already ships", async () => {
    registerRepoTemplate({ ".flisk/project.json": projectJson("already-here") });
    const dest = await scaffold(TEST_KEY, "my-app");
    expect(existsSync(join(dest, ".flisk", "project.json"))).toBe(true);
    const config = readProjectConfig(dest);
    expect(config.project.name).toBe("already-here");
  });

  it("points at config regenerate when a starter config cannot generate files (#4196)", async () => {
    registerRepoTemplate({ ".flisk/project.json": projectJson("incomplete") });
    const dest = join(createTempDir(), "my-app");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await cloneProjectTemplate(TEST_KEY, dest, [], {});
      expect(warnSpy.mock.calls.flat().join("\n")).toContain("Could not generate the master files");
      expect(logSpy.mock.calls.flat().join("\n")).toContain("flisk config regenerate");
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it("writes a project config into a generated local-process starter (#4292)", async () => {
    const dest = await scaffold("swarm", "swarm-app");
    expect(existsSync(join(dest, ".flisk", "project.json"))).toBe(true);
    const config = readProjectConfig(dest);
    expect(config.project.name).toBe("swarm-app");
  });
});
