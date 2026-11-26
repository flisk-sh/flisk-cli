// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureConsole,
  importCli,
  restoreArgv,
  throwOnExit,
} from "../../test-support/cli-exit.js";

const machine = vi.hoisted(() => ({ ready: vi.fn(async () => {}) }));

// The name is refused before the Windows refusal and the machine checks, so a test that
// reaches either of them fails instead of pretending the order is right.
vi.mock("../../utils/native-windows.js", () => ({
  nativeWindowsStackRefusal: () => undefined,
}));

vi.mock("../../utils/cold-preflight.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/cold-preflight.js")>()),
  assertMachineReadyOrExit: machine.ready,
}));

afterEach(() => {
  restoreArgv();
  vi.restoreAllMocks();
});

describe("flisk --template with an unknown name", () => {
  it.each(["nope", "constructor", "__proto__", "toString"])(
    "refuses %s before the demo progress screen",
    async (name) => {
      const lines = captureConsole();
      throwOnExit();
      machine.ready.mockClear();

      const code = await importCli("--template", name, "--project", "./t-x");

      expect(code).toBe(1);
      const output = lines.join("\n");
      expect(output).toContain(`Unknown template: "${name}"`);
      expect(output).toContain("Available templates:");
      expect(output).not.toContain("Did you mean");
      expect(output).not.toContain("Demo folder");
      expect(output).not.toContain("Fetching the demo");
      expect(machine.ready).not.toHaveBeenCalled();
    },
  );
});

describe("flisk --template with a mistyped starter name", () => {
  it.each([
    ["sas", "saas"],
    ["dem", "demo"],
    ["resturant", "restaurant"],
  ])("suggests %s for %s above the catalog", async (typed, expected) => {
    const lines = captureConsole();
    throwOnExit();
    machine.ready.mockClear();

    const code = await importCli("--template", typed, "--project", "./t-x");

    expect(code).toBe(1);
    const output = lines.join("\n");
    expect(output).toContain(`Did you mean "${expected}"?`);
    expect(output.indexOf(`Did you mean "${expected}"?`)).toBeLessThan(
      output.indexOf("Available templates:"),
    );
    expect(machine.ready).not.toHaveBeenCalled();
  });

  it.each(["shop", "nope", "xyz"])("lists the catalog with no suggestion for %s", async (name) => {
    const lines = captureConsole();
    throwOnExit();
    machine.ready.mockClear();

    const code = await importCli("--template", name, "--project", "./t-x");

    expect(code).toBe(1);
    const output = lines.join("\n");
    expect(output).toContain(`Unknown template: "${name}"`);
    expect(output).toContain("Available templates:");
    expect(output).not.toContain("Did you mean");
    expect(machine.ready).not.toHaveBeenCalled();
  });
});
