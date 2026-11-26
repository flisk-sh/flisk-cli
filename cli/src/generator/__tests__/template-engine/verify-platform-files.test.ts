// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import {
  describe,
  expect,
  fs,
  generateMasterConfigs,
  it,
  os,
  path,
  projectConfig,
  repoRoot,
  verifyMasterConfigs,
  writeProjectJson,
} from "./test-support.js";

describe("verifyMasterConfigs platform compose files", () => {
  it("reports drift for a hand-edited or deleted database-management docker-compose.yml (#3735)", async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "flisk-platform-compose-"));
    const oldExtensionSource = process.env.FLISK_EXTENSION_SOURCE;
    process.env.FLISK_EXTENSION_SOURCE = repoRoot;
    try {
      const config = projectConfig();
      config.phases.pre_alpha.enabledStacks = ["database-management"];
      writeProjectJson(projectRoot, config);
      await generateMasterConfigs(projectRoot, { quiet: true });

      const composeRel = "services/platform/database-management/docker-compose.yml";
      const composePath = path.join(
        projectRoot,
        "services",
        "platform",
        "database-management",
        "docker-compose.yml",
      );
      expect(fs.existsSync(composePath)).toBe(true);
      const ok = verifyMasterConfigs(projectRoot);
      expect(ok.errors.filter((error) => error.includes(composeRel))).toEqual([]);

      fs.writeFileSync(
        composePath,
        fs.readFileSync(composePath, "utf-8").replace("postgres:16-alpine", "postgres:9-evil"),
      );
      const edited = verifyMasterConfigs(projectRoot, { diffFiles: [composeRel] });
      expect(edited.valid).toBe(false);
      expect(edited.errors.join("\n")).toContain(`Out of sync: ${composeRel}`);
      const diff = edited.diffs.find((entry) => entry.file === composeRel)?.diff ?? "";
      expect(diff).toContain(`--- a/${composeRel}`);
      expect(diff).toContain("-    image: postgres:9-evil");
      expect(diff).toContain("+    image: postgres:16-alpine");

      fs.rmSync(composePath);
      const deleted = verifyMasterConfigs(projectRoot, { diffFiles: [composeRel] });
      expect(deleted.valid).toBe(false);
      expect(deleted.errors.join("\n")).toContain(`Missing file: ${composeRel}`);
      expect(deleted.diffs.find((entry) => entry.file === composeRel)?.diff).toContain(
        `+++ b/${composeRel}`,
      );
    } finally {
      if (oldExtensionSource === undefined) delete process.env.FLISK_EXTENSION_SOURCE;
      else process.env.FLISK_EXTENSION_SOURCE = oldExtensionSource;
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("accepts the Tilt engine's own database-management compose after `flisk up` (#3735, #4851 e2e)", async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "flisk-engine-compose-"));
    const oldExtensionSource = process.env.FLISK_EXTENSION_SOURCE;
    process.env.FLISK_EXTENSION_SOURCE = repoRoot;
    try {
      const config = projectConfig();
      config.phases.pre_alpha.enabledStacks = ["database-management"];
      writeProjectJson(projectRoot, config);
      await generateMasterConfigs(projectRoot, { quiet: true });

      const composeRel = "services/platform/database-management/docker-compose.yml";
      const composePath = path.join(projectRoot, composeRel);
      // The engine's infra-loader.star writes its own header ("SYSTEM-GENERATED - DO
      // NOT EDIT", not the CLI marker) and env-resolved ports; `flisk up` leaves this
      // form on disk and `flisk config verify` must not call it drift.
      const engineVariant = [
        "###############################################################################",
        "# SYSTEM-GENERATED - DO NOT EDIT",
        "# Stack feature: database-management",
        '# Source: .flisk/project.json stacks.*.services includes "database-management"',
        "###############################################################################",
        "",
        "services:",
        "  postgres:",
        "    image: postgres:16-alpine",
        "    container_name: test-project_postgres",
        "    restart: unless-stopped",
        "    environment:",
        "      POSTGRES_USER: test-project",
        "      POSTGRES_PASSWORD: ${DB_PASSWORD}",
        "      POSTGRES_DB: postgres",
        "    ports:",
        '      - "127.0.0.1:15432:5432"',
        "    healthcheck:",
        '      test: ["CMD-SHELL", "pg_isready -h 127.0.0.1 -U test-project -d postgres"]',
        "",
      ].join("\n");
      fs.writeFileSync(composePath, engineVariant);

      const verified = verifyMasterConfigs(projectRoot);
      expect(verified.errors.filter((error) => error.includes(composeRel))).toEqual([]);
    } finally {
      if (oldExtensionSource === undefined) delete process.env.FLISK_EXTENSION_SOURCE;
      else process.env.FLISK_EXTENSION_SOURCE = oldExtensionSource;
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
