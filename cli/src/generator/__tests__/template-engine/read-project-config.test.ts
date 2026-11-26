// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import type { ProjectConfig } from "./test-support.js";
import {
  describe,
  expect,
  expectProjectConfigNotFound,
  expectProjectConfigReadFailure,
  FliskError,
  fs,
  it,
  os,
  ProjectConfigNotFoundError,
  path,
  projectConfig,
  readProjectConfig,
  writeProjectJson,
} from "./test-support.js";

describe("readProjectConfig", () => {
  /** Reads the file the same way the implementation does and returns the failure reason it reports. */
  function readFailureReason(filePath: string): string {
    try {
      fs.readFileSync(filePath, "utf-8");
    } catch (error) {
      return (error as Error).message;
    }
    throw new Error(`Expected reading ${filePath} to fail`);
  }

  function catchFromReadProjectConfig(projectRoot: string): unknown {
    try {
      readProjectConfig(projectRoot);
    } catch (error) {
      return error;
    }
    throw new Error("Expected readProjectConfig to throw");
  }

  it("rejects a repos entry whose branch is not a string, instead of cloning the default branch", () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "flisk-repos-branch-"));
    try {
      const fliskDir = path.join(projectRoot, ".flisk");
      fs.mkdirSync(fliskDir, { recursive: true });
      const config = {
        version: "1.0",
        project: { name: "hub", version: "0.1.0" },
        phases: {
          pre_alpha: { enabledStacks: [] },
          alpha: { enabledStacks: [] },
          beta: { enabledStacks: [] },
          out_of_scope: { enabledStacks: [] },
        },
        optional_infra: {
          monitoring: false,
          elk: false,
          debezium: false,
          golden_image: false,
          verdaccio: false,
        },
        discovery: { paths: ["services"] },
        repos: [{ url: "https://github.com/acme/orders.git", dir: "services/orders", branch: 7 }],
      };
      fs.writeFileSync(path.join(fliskDir, "project.json"), JSON.stringify(config), "utf-8");

      const message = (catchFromReadProjectConfig(projectRoot) as Error).message;

      expect(message).toContain(".flisk/project.json.repos[0].branch: expected a string");
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("throws an Error with the file path and parse reason when .flisk/project.json is malformed (#1521)", () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "flisk-malformed-project-json-"));
    try {
      const fliskDir = path.join(projectRoot, ".flisk");
      fs.mkdirSync(fliskDir, { recursive: true });
      const projectJsonPath = path.join(fliskDir, "project.json");
      const malformedContent = '{ "version": "1.0", broken json ';
      fs.writeFileSync(projectJsonPath, malformedContent, "utf-8");

      let expectedReason = "";
      try {
        JSON.parse(malformedContent);
      } catch (parseError) {
        expectedReason = (parseError as Error).message;
      }

      const caught = catchFromReadProjectConfig(projectRoot);

      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toBe(
        `Could not parse project.json at ${projectJsonPath}: ${expectedReason}`,
      );
      expect(caught).not.toBeInstanceOf(ProjectConfigNotFoundError);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("throws an Error with the file path and read reason when .flisk/project.json cannot be read as a file (#1521)", () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "flisk-unreadable-project-json-"));
    try {
      const projectJsonPath = path.join(projectRoot, ".flisk", "project.json");
      fs.mkdirSync(projectJsonPath, { recursive: true });
      const expectedReason = readFailureReason(projectJsonPath);

      const caught = catchFromReadProjectConfig(projectRoot);

      expectProjectConfigReadFailure(caught, projectJsonPath, expectedReason);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("throws ProjectConfigNotFoundError when the project has no .flisk directory", () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "flisk-missing-project-json-"));
    try {
      const projectJsonPath = path.join(projectRoot, ".flisk", "project.json");

      const caught = catchFromReadProjectConfig(projectRoot);

      expectProjectConfigNotFound(caught, projectJsonPath);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("throws ProjectConfigNotFoundError when .flisk exists but holds no project.json", () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "flisk-empty-flisk-dir-"));
    try {
      const fliskDir = path.join(projectRoot, ".flisk");
      fs.mkdirSync(fliskDir, { recursive: true });
      const projectJsonPath = path.join(fliskDir, "project.json");

      const caught = catchFromReadProjectConfig(projectRoot);

      expectProjectConfigNotFound(caught, projectJsonPath);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  // Windows reports ENOENT, not ENOTDIR, for a path under a regular file, so the
  // read-failure branch cannot be reached there; parametrize on the real reason instead.
  it("reports the read failure instead of a missing config when .flisk is not a directory", () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "flisk-flisk-not-a-directory-"));
    try {
      fs.writeFileSync(path.join(projectRoot, ".flisk"), "not a directory", "utf-8");
      const projectJsonPath = path.join(projectRoot, ".flisk", "project.json");
      const expectedReason = readFailureReason(projectJsonPath);

      const caught = catchFromReadProjectConfig(projectRoot);

      if (process.platform === "win32") {
        expect(caught).toBeInstanceOf(ProjectConfigNotFoundError);
      } else {
        expectProjectConfigReadFailure(caught, projectJsonPath, expectedReason);
      }
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  // Permission bits are not enforced on Windows, and root bypasses them, so the EACCES
  // path this guards (existsSync reporting an inaccessible file as missing) cannot be
  // produced there.
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "reports the permission failure instead of a missing config when .flisk is not accessible",
    () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "flisk-inaccessible-flisk-dir-"));
      const fliskDir = path.join(projectRoot, ".flisk");
      try {
        fs.mkdirSync(fliskDir, { recursive: true });
        fs.writeFileSync(path.join(fliskDir, "project.json"), "{}", "utf-8");
        const projectJsonPath = path.join(fliskDir, "project.json");
        fs.chmodSync(fliskDir, 0o000);
        const expectedReason = readFailureReason(projectJsonPath);

        const caught = catchFromReadProjectConfig(projectRoot);

        expectProjectConfigReadFailure(caught, projectJsonPath, expectedReason);
      } finally {
        fs.chmodSync(fliskDir, 0o755);
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    },
  );

  const invalidConfigs: Array<[string, unknown, string]> = [
    ["a non-object value", "not an object", ""],
    ["a non-string version", { version: 1 }, "version"],
    ["a missing project", { version: "1.0" }, "project"],
    ["a project without name/version", { version: "1.0", project: { version: 1 } }, "project.name"],
    [
      "phases missing a phase",
      {
        version: "1.0",
        project: { name: "p", version: "1.0.0" },
        phases: { pre_alpha: { enabledStacks: [] } },
      },
      "phases.alpha",
    ],
    [
      "phases whose enabledStacks is not an array",
      {
        version: "1.0",
        project: { name: "p", version: "1.0.0" },
        phases: {
          ...projectConfig().phases,
          alpha: { name: "Alpha", description: "", enabledStacks: "proxy" },
        },
        optional_infra: projectConfig().optional_infra,
        discovery: { paths: [] },
      },
      "phases.alpha.enabledStacks",
    ],
    [
      "a missing optional_infra",
      {
        version: "1.0",
        project: { name: "p", version: "1.0.0" },
        phases: projectConfig().phases,
        discovery: { paths: [] },
      },
      "optional_infra",
    ],
    [
      "a non-boolean optional_infra flag",
      {
        ...projectConfig(),
        optional_infra: { ...projectConfig().optional_infra, verdaccio: "yes" },
      },
      "optional_infra.verdaccio",
    ],
    ["a discovery without paths", { ...projectConfig(), discovery: {} }, "discovery.paths"],
  ];

  for (const flag of ["monitoring", "elk", "debezium", "golden_image", "verdaccio"] as const) {
    invalidConfigs.push([
      `a non-boolean optional_infra.${flag}`,
      { ...projectConfig(), optional_infra: { ...projectConfig().optional_infra, [flag]: 1 } },
      `optional_infra.${flag}`,
    ]);
  }
  invalidConfigs.push(
    ["a null discovery", { ...projectConfig(), discovery: null }, "discovery"],
    ["a string discovery", { ...projectConfig(), discovery: "services/*" }, "discovery"],
    [
      "discovery paths that are not an array",
      { ...projectConfig(), discovery: { paths: "services/*" } },
      "discovery.paths",
    ],
    ["a null optional_infra", { ...projectConfig(), optional_infra: null }, "optional_infra"],
  );

  for (const [label, value, field] of invalidConfigs) {
    it(`rejects ${label} and names ${field || "the file"}`, () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "flisk-invalid-project-json-"));
      try {
        writeProjectJson(projectRoot, value);

        const caught = catchFromReadProjectConfig(projectRoot);

        expect(caught).toBeInstanceOf(FliskError);
        const error = caught as FliskError;
        const name = field ? `.flisk/project.json.${field}` : ".flisk/project.json";
        expect(error.message).toContain(`${name}: expected`);
        expect(error.message).not.toContain("missing or invalid required fields");
        // A wrong type in the file is the user's error, not an internal failure.
        expect(error.exitCode).toBe(1);
        expect(caught).not.toBeInstanceOf(ProjectConfigNotFoundError);
      } finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    });
  }

  it("accepts a Compose-style project name with an underscore, as flisk import writes it", () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "flisk-underscore-name-"));
    try {
      const config = projectConfig({ project: { name: "pl_mail", version: "1.0.0" } });
      writeProjectJson(projectRoot, config);

      expect(readProjectConfig(projectRoot).project.name).toBe("pl_mail");
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it.each(["Pl Mail", "-lead", "has space", "UPPER", "a/b"])(
    "still rejects the project name %j",
    (name) => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "flisk-bad-name-"));
      try {
        writeProjectJson(projectRoot, projectConfig({ project: { name, version: "1.0.0" } }));
        expect(() => readProjectConfig(projectRoot)).toThrow(/project\.name/);
      } finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    },
  );

  it("returns every field of a valid config, including the optional ones", () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "flisk-valid-project-json-"));
    try {
      const config = projectConfig({
        always_enabled_infra: ["traefik"],
        overrides: { "shop/api": { port: 4100 } },
      } as Partial<ProjectConfig>);
      writeProjectJson(projectRoot, config);

      expect(readProjectConfig(projectRoot)).toEqual(config);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("migrates a legacy stacks config to phases", () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "flisk-legacy-stacks-"));
    try {
      writeProjectJson(projectRoot, {
        version: "1.0",
        project: { name: "legacy", version: "1.0.0" },
        stacks: {
          pre_alpha: { name: "Pre-Alpha", description: "d0", services: ["proxy"] },
          alpha: { name: "Alpha", description: "d1", services: ["database-management"] },
          beta: { name: "Beta", description: "d2", services: [] },
          out_of_scope: { name: "Out", description: "d3", services: ["verdaccio"] },
        },
        optional_infra: projectConfig().optional_infra,
        discovery: { paths: ["services/*/*"] },
        overrides: {},
      });

      const config = readProjectConfig(projectRoot);

      expect(config.phases.pre_alpha).toEqual({
        name: "Pre-Alpha",
        description: "d0",
        enabledStacks: ["proxy"],
      });
      expect(config.phases.alpha.enabledStacks).toEqual(["database-management"]);
      expect(config.phases.beta.enabledStacks).toEqual([]);
      expect(config.phases.out_of_scope.enabledStacks).toEqual(["verdaccio"]);
      expect(config.stacks).toBeUndefined();
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
