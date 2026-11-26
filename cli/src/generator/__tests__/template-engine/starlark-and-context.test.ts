// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import {
  compileTemplate,
  describe,
  expect,
  it,
  projectConfig,
  TemplateEngine,
} from "./test-support.js";

describe("starlark helper", () => {
  const compile = (source: string) =>
    compileTemplate(source, (new TemplateEngine() as unknown as { helpers(): never }).helpers());
  const render = (value: unknown) => {
    return compile("{{starlark v}}")({ v: value });
  };

  it("escapes a trailing backslash so it cannot close the string", () => {
    expect(render("C:\\dir\\")).toBe('"C:\\\\dir\\\\"');
  });

  it("escapes quotes and backslashes in object keys too", () => {
    expect(render({ 'a"b\\': "x" })).toBe('{"a\\"b\\\\": "x"}');
  });

  it("renders every JSON value kind as Starlark", () => {
    expect(render(null)).toBe("None");
    expect(render(undefined)).toBe("None");
    expect(render(true)).toBe("True");
    expect(render(false)).toBe("False");
    expect(render(42)).toBe("42");
    expect(render([1, 'a"b', { k: null }])).toBe('[1, "a\\"b", {"k": None}]');
  });

  it("starlarkArray renders [] for a non-array and one item per array element", () => {
    const template = compile("{{starlarkArray v}}");
    expect(template({ v: "proxy" })).toBe("[]");
    expect(template({ v: ["proxy", 1, true] })).toBe('["proxy", 1, True]');
  });

  it("json helper emits compact JSON", () => {
    expect(compile("{{{json v}}}")({ v: { a: 1, b: [null] } })).toBe('{"a":1,"b":[null]}');
  });
});

describe("buildContext", () => {
  it("dedupes repeated enabledStacks without mutating the input config", () => {
    const config = projectConfig();
    config.phases.alpha = {
      name: "Alpha",
      description: "",
      enabledStacks: ["proxy", "proxy", "database-management"],
    };

    const context = new TemplateEngine().buildContext(config);

    expect(context.phases.alpha.enabledStacks).toEqual(["proxy", "database-management"]);
    expect(config.phases.alpha.enabledStacks).toEqual(["proxy", "proxy", "database-management"]);
  });

  it("uses the discovery paths from the project config", () => {
    const context = new TemplateEngine().buildContext(
      projectConfig({ discovery: { paths: ["apps/*"] } }),
    );
    expect(context.discovery.paths).toEqual(["apps/*"]);
  });

  it("defaults alwaysEnabledInfra and keeps an explicit list as given", () => {
    const engine = new TemplateEngine();
    expect(engine.buildContext(projectConfig()).alwaysEnabledInfra).toEqual([
      "database-management",
      "proxy",
    ]);
    expect(
      engine.buildContext(projectConfig({ always_enabled_infra: ["proxy"] })).alwaysEnabledInfra,
    ).toEqual(["proxy"]);
  });
});
