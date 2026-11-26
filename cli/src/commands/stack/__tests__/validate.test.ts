// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { makeResource } from "../../../test-support/index.js";
import type { DiscoveredResource } from "../../../types/index.js";
import { FliskError } from "../../../utils/errors.js";
import { JsonCommandError } from "../../../utils/json-command.js";
import {
  assertCompatibleStackOptions,
  assertNoExtraStackArguments,
  assertNonInteractiveInputs,
  isBareStackListRequest,
  normalizeResourceNames,
  planNamedResourceUpdates,
} from "../validate.js";

const ROOT = "/proj";

/** A discovered resource living at `<root>/services/<dir>/service.json`. */
function stacked(name: string, dir: string, stack?: string): DiscoveredResource {
  return {
    name,
    path: `${ROOT}/services/${dir}`,
    configPath: `${ROOT}/services/${dir}/service.json`,
    stack,
  };
}

describe("normalizeResourceNames", () => {
  it("splits commas, trims, and dedupes in order", () => {
    expect(normalizeResourceNames(["api,worker", " api ", "web"])).toEqual([
      "api",
      "worker",
      "web",
    ]);
    expect(normalizeResourceNames(["", "  ", " , "])).toEqual([]);
  });
});

describe("isBareStackListRequest", () => {
  it.each([
    ["list", true],
    ["LIST", true],
    ["List", true],
    ["core", false],
    [undefined, false],
  ])("%s -> %s", (name, expected) => {
    expect(isBareStackListRequest(name)).toBe(expected);
  });
});

describe("assertNoExtraStackArguments", () => {
  it("accepts a run with no extra positionals", () => {
    expect(() => assertNoExtraStackArguments("core", [])).not.toThrow();
    expect(() => assertNoExtraStackArguments(undefined, [])).not.toThrow();
  });

  it("points `stack assign <resource> <stack>` at the --resources form", () => {
    let caught: unknown;
    try {
      assertNoExtraStackArguments("assign", ["users-api", "core"]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FliskError);
    expect((caught as FliskError).message).toBe("Assign one resource by naming the stack first.");
    expect((caught as FliskError).suggestions).toContain("flisk stack core --resources users-api");
  });

  it("points `stack create <name>` at assignment", () => {
    expect(() => assertNoExtraStackArguments("create", ["shop"])).toThrow(
      "A stack is created when you assign resources to it.",
    );
  });

  it("rejects any other extra positionals", () => {
    expect(() => assertNoExtraStackArguments("core", ["extra"])).toThrow(
      "Provide one stack name and pass resource names with --resources.",
    );
  });
});

describe("assertCompatibleStackOptions", () => {
  it.each([
    [
      "core",
      { move: true, remove: true, resources: ["api"] },
      "--move and --remove cannot be used together.",
    ],
    [
      "core",
      { list: true, move: true, resources: ["api"] },
      "--list cannot be combined with --move or --remove.",
    ],
    [
      "core",
      { list: true, remove: true, resources: ["api"] },
      "--list cannot be combined with --move or --remove.",
    ],
    ["core", { remove: true, resources: ["api"] }, "--remove does not take a stack name."],
    ["core", { move: true }, "--move and --remove require --resources <name...>."],
    [undefined, { remove: true }, "--move and --remove require --resources <name...>."],
    [
      "list",
      { resources: ["api"] },
      '"list" is reserved for listing stacks and cannot be used as a stack name.',
    ],
  ])("rejects %s with %o: %s", (stackName, options, message) => {
    let caught: unknown;
    try {
      assertCompatibleStackOptions(stackName, options);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FliskError);
    expect((caught as FliskError).message).toBe(message);
  });

  it.each([
    ["core", { resources: ["api"] }],
    ["core", { move: true, resources: ["api"] }],
    [undefined, { remove: true, resources: ["api"] }],
    ["list", {}],
    ["list", { list: true }],
    [undefined, {}],
  ])("accepts %s with %o", (stackName, options) => {
    expect(() => assertCompatibleStackOptions(stackName, options)).not.toThrow();
  });
});

describe("assertNonInteractiveInputs", () => {
  it("requires --resources when stdin is not a TTY", () => {
    expect(() => assertNonInteractiveInputs("core", {}, false)).toThrow(
      "Interactive resource selection requires a TTY.",
    );
    expect(() => assertNonInteractiveInputs("core", { json: true }, false)).toThrow(
      "Interactive resource selection requires a TTY.",
    );
    expect(() => assertNonInteractiveInputs("core", { json: true }, true)).toThrow(
      "Interactive resource selection requires a TTY.",
    );
  });

  it("requires a stack name for non-interactive assignment", () => {
    expect(() =>
      assertNonInteractiveInputs(undefined, { resources: ["api"], yes: true }, false),
    ).toThrow("A stack name is required when stdin is not a TTY.");
  });

  it("lets --remove run without a stack name", () => {
    expect(() =>
      assertNonInteractiveInputs(undefined, { resources: ["api"], remove: true, yes: true }, false),
    ).not.toThrow();
  });

  it("requires --yes for a non-interactive run without --json", () => {
    expect(() => assertNonInteractiveInputs("core", { resources: ["api"] }, false)).toThrow(
      "Confirmation requires a TTY.",
    );
    expect(() =>
      assertNonInteractiveInputs("core", { resources: ["api"], yes: true }, false),
    ).not.toThrow();
    expect(() =>
      assertNonInteractiveInputs("core", { resources: ["api"], json: true }, false),
    ).not.toThrow();
  });

  it("leaves a TTY run without --json free to prompt", () => {
    expect(() => assertNonInteractiveInputs(undefined, {}, true)).not.toThrow();
    expect(() => assertNonInteractiveInputs("core", {}, true)).not.toThrow();
  });
});

describe("planNamedResourceUpdates", () => {
  it("normalizes the requested names and selects the matching manifests", () => {
    const api = makeResource("api", "backend");
    const web = makeResource("web", "frontend");
    const plan = planNamedResourceUpdates(["api, web ", "api"], [api, web], ROOT, "core");
    expect(plan.selectedPaths).toEqual([api.configPath, web.configPath]);
    expect(plan.relocations.size).toBe(0);
  });

  it.each([[[" , "]], [["--yes"]]])("rejects empty or option-shaped --resources %o", (names) => {
    let caught: unknown;
    try {
      planNamedResourceUpdates(names, [makeResource("api", "backend")], ROOT, "core");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(JsonCommandError);
    expect((caught as JsonCommandError).code).toBe("USAGE");
    expect((caught as JsonCommandError).exitCode).toBe(2);
    expect((caught as JsonCommandError).message).toBe(
      "--resources needs at least one resource name",
    );
  });

  it("reports every manifest path when a name is duplicated", () => {
    const first = stacked("api", "a/api");
    const second = stacked("api", "b/api");
    let caught: unknown;
    try {
      planNamedResourceUpdates(["api"], [first, second], ROOT, "core");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FliskError);
    expect((caught as FliskError).message).toBe(
      "Cannot update resources while duplicate names are present.",
    );
    const suggestions = (caught as FliskError).suggestions.join("\n");
    expect(suggestions).toContain(first.configPath);
    expect(suggestions).toContain(second.configPath);
  });

  it("lists the valid resource names when one is unknown", () => {
    const api = makeResource("api", "backend");
    const worker = makeResource("worker", "worker");
    let caught: unknown;
    try {
      planNamedResourceUpdates(["missing"], [api, worker], ROOT, "core");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FliskError);
    expect((caught as FliskError).message).toBe('Resource "missing" not found');
    expect((caught as FliskError).suggestions[0]).toBe("Valid resources: api, worker");
  });

  it("rejects an assigned resource without --move or --remove", () => {
    const api = stacked("api", "legacy/api", "legacy");
    expect(() => planNamedResourceUpdates(["api"], [api], ROOT, "core")).toThrow(
      'Resource "api" is already assigned to stack "legacy".',
    );
  });

  it("selects an assigned resource under --remove without planning a move", () => {
    const api = stacked("api", "legacy/api", "legacy");
    const plan = planNamedResourceUpdates(["api"], [api], ROOT, null, { remove: true });
    expect(plan.selectedPaths).toEqual([api.configPath]);
    expect(plan.relocations.size).toBe(0);
  });

  it("plans a folder relocation for a move out of services/<stack>/<name>", () => {
    const api = stacked("api", "legacy/api", "legacy");
    const plan = planNamedResourceUpdates(["api"], [api], ROOT, "backend", { move: true });
    expect(plan.relocations.get(api.configPath)).toBe(`${ROOT}/services/backend/api/service.json`);
    expect(plan.selectedPaths).toEqual([api.configPath]);
  });

  it("leaves a resource in place when its folder is not services/<stack>/<name>", () => {
    const api = stacked("api", "main/api", "legacy");
    const plan = planNamedResourceUpdates(["api"], [api], ROOT, "backend", { move: true });
    expect(plan.relocations.size).toBe(0);
    expect(plan.selectedPaths).toEqual([api.configPath]);
  });

  it("does not relocate a resource already in the target stack", () => {
    const api = stacked("api", "backend/api", "backend");
    const plan = planNamedResourceUpdates(["api"], [api], ROOT, "backend", { move: true });
    expect(plan.relocations.size).toBe(0);
    expect(plan.selectedPaths).toEqual([api.configPath]);
  });

  it("refuses a move target that already exists on disk", () => {
    const api = stacked("api", "legacy/api", "legacy");
    expect(() =>
      planNamedResourceUpdates(["api"], [api], ROOT, "backend", {
        move: true,
        exists: () => true,
      }),
    ).toThrow(`Cannot move "api" to stack "backend": ${ROOT}/services/backend/api already exists.`);
  });

  it("refuses two moves that claim the same target folder", () => {
    const first = stacked("web-a", "a/web", "a");
    const second = stacked("web-b", "b/web", "b");
    let caught: unknown;
    try {
      planNamedResourceUpdates(["web-a", "web-b"], [first, second], ROOT, "core", {
        move: true,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FliskError);
    expect((caught as FliskError).message).toContain("already moves to");
    expect((caught as FliskError).message).toContain('"web-a"');
  });
});
