// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureExit,
  createTempDir,
  git,
  makeResource,
  projectConfig,
  projectJsonPath,
  readProjectConfig,
  singleCommitRepo,
  writeProjectConfig,
} from "../../../test-support/index.js";
import type { DiscoveredResource } from "../../../types/index.js";
import { FliskError } from "../../../utils/errors.js";
import { PROJECT_FEATURES } from "../../../utils/project-features.js";
import { PROJECT_TEMPLATES } from "../../../utils/project-templates.js";
import {
  cloneProjectTemplate,
  DEFAULT_PROJECT_JSON,
  discoverExistingServiceStacks,
  enableDiscoveredStacks,
  lastLine,
  syncDiscoveredStacksToPreAlpha,
  writeDefaultProjectConfig,
} from "../clone.js";

const TEST_KEY = "clone-module-test-template";

function stackResource(stack: string, name = `${stack}-api`): DiscoveredResource {
  return { ...makeResource(name, "backend"), stack };
}

afterEach(() => {
  delete PROJECT_TEMPLATES[TEST_KEY];
  vi.restoreAllMocks();
});

describe("lastLine", () => {
  it("returns the final non-empty line", () => {
    expect(lastLine("one\ntwo\nthree\n")).toBe("three");
    expect(lastLine("error\nfatal: cannot open\n\n  \n")).toBe("fatal: cannot open");
  });

  it("trims the line it returns", () => {
    expect(lastLine("   spaced out   ")).toBe("spaced out");
  });

  it("returns 'unknown error' for blank input", () => {
    expect(lastLine("")).toBe("unknown error");
    expect(lastLine(" \n\t\n  ")).toBe("unknown error");
  });
});

describe("DEFAULT_PROJECT_JSON", () => {
  it("has the shape `flisk project --yes` writes", () => {
    expect(DEFAULT_PROJECT_JSON.version).toBe("1.0");
    expect(Object.keys(DEFAULT_PROJECT_JSON.phases)).toEqual([
      "pre_alpha",
      "alpha",
      "beta",
      "out_of_scope",
    ]);
    expect(DEFAULT_PROJECT_JSON.phases.alpha.enabledStacks).toEqual([]);
    expect(DEFAULT_PROJECT_JSON.discovery.paths).toEqual(["services/*/*"]);
    expect(DEFAULT_PROJECT_JSON.optional_infra).toEqual({
      monitoring: false,
      elk: false,
      debezium: false,
      golden_image: true,
      verdaccio: false,
    });
  });

  it("enables exactly the default-on core features in pre_alpha", () => {
    const expected = Object.values(PROJECT_FEATURES)
      .filter((f) => f.enabled_by_default && f.category === "core")
      .map((f) => f.name);
    expect(DEFAULT_PROJECT_JSON.phases.pre_alpha.enabledStacks).toEqual(expected);
    expect(expected.length).toBeGreaterThan(0);
  });
});

describe("writeDefaultProjectConfig", () => {
  it("writes .flisk/project.json with a derived name and creates .flisk when missing", () => {
    const root = join(createTempDir(), "My App.v2");

    writeDefaultProjectConfig(root);

    const config = readProjectConfig(root);
    expect(config.project.name).toBe("my-app-v2");
    expect(config.project.version).toBe("1.0.0");
    expect(config.discovery.paths).toEqual(["services/*/*"]);
    expect(config.phases.pre_alpha.enabledStacks).toEqual(
      DEFAULT_PROJECT_JSON.phases.pre_alpha.enabledStacks,
    );
  });

  it("does not mutate DEFAULT_PROJECT_JSON", () => {
    writeDefaultProjectConfig(join(createTempDir(), "some-app"));
    expect(DEFAULT_PROJECT_JSON.project.name).toBe("");
  });
});

describe("discoverExistingServiceStacks", () => {
  it("returns the sorted unique stack names of the given resources", () => {
    const root = createTempDir();
    expect(
      discoverExistingServiceStacks(root, [
        stackResource("payments"),
        stackResource("catalog"),
        stackResource("payments", "payments-worker"),
      ]),
    ).toEqual(["catalog", "payments"]);
  });

  it("returns an empty list for no resources, none given, or an unreadable root", () => {
    const root = createTempDir();
    expect(discoverExistingServiceStacks(root, [])).toEqual([]);
    expect(discoverExistingServiceStacks(root)).toEqual([]);
    expect(discoverExistingServiceStacks(join(root, "does-not-exist"))).toEqual([]);
  });

  it("reads service.json files from disk when resources are not passed", () => {
    const root = createTempDir();
    writeDefaultProjectConfig(root);
    const serviceDir = join(root, "services", "shop", "orders");
    mkdirSync(serviceDir, { recursive: true });
    writeFileSync(
      join(serviceDir, "service.json"),
      JSON.stringify({
        name: "orders",
        appName: "orders",
        appType: "backend",
        runtime: "node",
        stack: "shop",
      }),
    );

    expect(discoverExistingServiceStacks(root)).toEqual(["shop"]);
  });
});

describe("syncDiscoveredStacksToPreAlpha", () => {
  it("appends unassigned stacks to pre_alpha and returns them", () => {
    const config = projectConfig(["platform"]);

    const enabled = syncDiscoveredStacksToPreAlpha(config, ["payments", "orders"]);

    expect(enabled).toEqual(["payments", "orders"]);
    expect(config.phases.pre_alpha.enabledStacks).toEqual(["platform", "payments", "orders"]);
  });

  it("does not re-enable stacks assigned to another phase", () => {
    const config = projectConfig(["platform"], { alpha: ["payments"] });

    const enabled = syncDiscoveredStacksToPreAlpha(config, ["payments", "catalog"]);

    expect(enabled).toEqual(["catalog"]);
    expect(config.phases.alpha.enabledStacks).toEqual(["payments"]);
    expect(config.phases.pre_alpha.enabledStacks).toEqual(["platform", "catalog"]);
  });

  it("returns nothing and dedupes pre_alpha when every stack is assigned", () => {
    const config = projectConfig(["platform", "platform"]);

    const enabled = syncDiscoveredStacksToPreAlpha(config, ["platform"]);

    expect(enabled).toEqual([]);
    expect(config.phases.pre_alpha.enabledStacks).toEqual(["platform"]);
  });
});

describe("enableDiscoveredStacks", () => {
  it("does nothing when there is no .flisk/project.json", () => {
    const root = createTempDir();
    expect(enableDiscoveredStacks(root, [stackResource("payments")])).toEqual([]);
    expect(existsSync(projectJsonPath(root))).toBe(false);
  });

  it("adds newly discovered stacks to pre_alpha and persists them", () => {
    const root = createTempDir();
    writeProjectConfig(root, projectConfig(["platform"]));

    const enabled = enableDiscoveredStacks(root, [
      stackResource("payments"),
      stackResource("orders"),
    ]);

    expect(enabled).toEqual(["orders", "payments"]);
    expect(readProjectConfig(root).phases.pre_alpha.enabledStacks).toEqual([
      "platform",
      "orders",
      "payments",
    ]);
  });

  it("leaves the file untouched when every discovered stack is already assigned", () => {
    const root = createTempDir();
    const original = writeProjectConfig(
      root,
      projectConfig(["platform"], { out_of_scope: ["payments"] }),
    );

    const enabled = enableDiscoveredStacks(root, [
      stackResource("platform"),
      stackResource("payments"),
    ]);

    expect(enabled).toEqual([]);
    expect(readFileSync(projectJsonPath(root), "utf-8")).toBe(original);
  });
});

describe("cloneProjectTemplate", () => {
  it("refuses an unknown template name with exit 1 and the catalog", async () => {
    const exit = captureExit();
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line = "") => {
      lines.push(String(line));
    });

    await expect(cloneProjectTemplate("nope-template", undefined, [], {})).rejects.toThrow();

    exit.expectExit(1);
    expect(lines.join("\n")).toContain('Unknown template: "nope-template"');
  });

  it("refuses a target directory with unsafe characters", async () => {
    const exit = captureExit();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(cloneProjectTemplate("swarm", "bad<dir>", [], { quiet: true })).rejects.toThrow();

    exit.expectExit(1);
  });

  it("refuses a non-empty destination directory", async () => {
    const exit = captureExit();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const parent = createTempDir();
    const destination = join(parent, "taken");
    mkdirSync(destination, { recursive: true });
    writeFileSync(join(destination, "existing.txt"), "already here");

    await expect(cloneProjectTemplate("swarm", destination, [], { quiet: true })).rejects.toThrow();

    exit.expectExit(1);
    expect(readFileSync(join(destination, "existing.txt"), "utf-8")).toBe("already here");
  });

  it("scaffolds a generated starter quietly and resolves the absolute destination", async () => {
    const parent = createTempDir();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const destination = join(parent, "swarm-app");

    const result = await cloneProjectTemplate("swarm", destination, [], { quiet: true });

    expect(result).toBe(destination);
    expect(isAbsolute(result)).toBe(true);
    expect(existsSync(join(destination, "README.md"))).toBe(true);
    expect(readProjectConfig(destination).project.name).toBe("swarm-app");
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("copies the bundled example template with its services and a project config", async () => {
    const destination = join(createTempDir(), "flisk-example");

    const result = await cloneProjectTemplate("example", destination, [], { quiet: true });

    expect(result).toBe(destination);
    // The bundled copy is used, not a git clone, so the example's own layout is intact.
    expect(existsSync(join(destination, "services"))).toBe(true);
    expect(existsSync(join(destination, "README.md"))).toBe(true);
    const config = readProjectConfig(destination);
    expect(config.project.name).toBe("flisk-example");
    expect(config.discovery.paths).toEqual(["services/*/*"]);
  });

  it("clones a registered repository template into the target directory", async () => {
    const repo = singleCommitRepo({ "version.txt": "1.0" });
    PROJECT_TEMPLATES[TEST_KEY] = {
      repo: pathToFileURL(repo).href,
      description: "test template",
    };
    const destination = join(createTempDir(), "my-app");

    const result = await cloneProjectTemplate(TEST_KEY, destination, [], { quiet: true });

    expect(result).toBe(destination);
    expect(readFileSync(join(destination, "version.txt"), "utf-8")).toBe("1.0");
    expect(readProjectConfig(destination).project.name).toBe("my-app");
    expect(git(destination, "remote", "get-url", "upstream")).toBe(pathToFileURL(repo).href);
  });

  it("keeps a project config the template already ships", async () => {
    const repo = singleCommitRepo({
      ".flisk/project.json": JSON.stringify({ version: "1.0", project: { name: "already" } }),
    });
    PROJECT_TEMPLATES[TEST_KEY] = {
      repo: pathToFileURL(repo).href,
      description: "test template",
    };
    const destination = join(createTempDir(), "my-app");

    await cloneProjectTemplate(TEST_KEY, destination, [], { quiet: true });

    expect(readProjectConfig(destination).project.name).toBe("already");
  });

  it("rejects with a FliskError carrying the last error line when a quiet clone fails", async () => {
    PROJECT_TEMPLATES[TEST_KEY] = {
      repo: pathToFileURL(join(createTempDir(), "missing-repo")).href,
      description: "broken",
    };
    const destination = join(createTempDir(), "my-app");

    const failure = cloneProjectTemplate(TEST_KEY, destination, [], { quiet: true });

    await expect(failure).rejects.toBeInstanceOf(FliskError);
    await expect(failure).rejects.toThrow(/git clone failed: .+/);
  });

  it("prints the next steps and runtime lines for a cloned starter", async () => {
    const repo = singleCommitRepo({ "version.txt": "1.0" });
    PROJECT_TEMPLATES[TEST_KEY] = {
      repo: pathToFileURL(repo).href,
      description: "test template",
    };
    const parent = createTempDir();
    const destination = join(parent, "my-app");
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line = "") => {
      lines.push(String(line));
    });

    const result = await cloneProjectTemplate(TEST_KEY, destination, ["Install Tilt first"], {});

    const output = lines.join("\n");
    expect(result).toBe(destination);
    expect(output).toContain(`Cloned "${TEST_KEY}" into ${destination}/`);
    expect(output).toContain("flisk doctor");
    expect(output).toContain("flisk up");
    expect(output).toContain("git remote add origin <url>");
    expect(output).toContain("Runtime readiness:");
    expect(output).toContain("Install Tilt first");
  });

  it("prints the local-process next steps for a generated starter", async () => {
    const parent = createTempDir();
    const destination = join(parent, "swarm");
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line = "") => {
      lines.push(String(line));
    });

    const result = await cloneProjectTemplate("swarm", destination, [], {});

    const output = lines.join("\n");
    expect(result).toBe(destination);
    expect(output).toContain(`Created "swarm" in ${destination}/`);
    expect(output).toContain("start it as local processes");
    expect(output).not.toContain("Runtime readiness:");
  });
});
