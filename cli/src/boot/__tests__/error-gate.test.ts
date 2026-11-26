// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import type { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { showDemoHelp, showHelp } from "../../commands/help.js";
import type { DemoRootOptions } from "../../utils/demo-args.js";
import {
  checkColimaGate,
  checkHelpGates,
  checkPlatformGate,
  checkRootOptionGates,
} from "../error-gate.js";

vi.mock("../../commands/help.js", () => ({
  showHelp: vi.fn(),
  showDemoHelp: vi.fn(),
}));

const colima = vi.hoisted(() => ({ checkColimaAsync: vi.fn() }));

vi.mock("../../utils/colima.js", () => ({ checkColimaAsync: colima.checkColimaAsync }));

const rootOptions = (overrides: Partial<DemoRootOptions> = {}): DemoRootOptions => ({
  keep: false,
  help: false,
  yes: false,
  ...overrides,
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(showHelp).mockClear();
  vi.mocked(showDemoHelp).mockClear();
  colima.checkColimaAsync.mockReset();
});

describe("checkRootOptionGates", () => {
  it("continues when argv carries no template", () => {
    expect(checkRootOptionGates(rootOptions())).toBeUndefined();
    expect(checkRootOptionGates(rootOptions({ help: true }))).toBeUndefined();
    expect(checkRootOptionGates(rootOptions({ unknownOption: "--dry-run" }))).toBeUndefined();
  });

  it("prints the demo help for --template=demo --help, before any setup", () => {
    expect(checkRootOptionGates(rootOptions({ template: "demo", help: true }))).toBe(0);
    expect(showDemoHelp).toHaveBeenCalledTimes(1);
    expect(showHelp).not.toHaveBeenCalled();
  });

  it("prints the global help for another template with --help", () => {
    expect(checkRootOptionGates(rootOptions({ template: "restaurant", help: true }))).toBe(0);
    expect(showHelp).toHaveBeenCalledTimes(1);
    expect(showDemoHelp).not.toHaveBeenCalled();
  });

  it("refuses an option the flow does not know, like Commander does (#4487)", () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });

    expect(
      checkRootOptionGates(rootOptions({ template: "demo", unknownOption: "--dry-run" })),
    ).toBe(1);
    expect(errors.join("\n")).toContain("error: unknown option '--dry-run'");
  });

  it("refuses a malformed --project value before any setup", () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });

    expect(
      checkRootOptionGates(rootOptions({ template: "demo", projectError: "needs a directory" })),
    ).toBe(1);
    expect(errors.join("\n")).toContain("needs a directory");
  });

  it("continues into the demo for a template with valid options", () => {
    expect(
      checkRootOptionGates(rootOptions({ template: "demo", project: "./out" })),
    ).toBeUndefined();
  });
});

describe("checkPlatformGate", () => {
  it.each([
    ["darwin", undefined],
    ["linux", undefined],
    ["win32", "1"],
  ] as const)("lets platform %s (allow=%s) continue", async (platform, allow) => {
    expect(await checkPlatformGate(platform, allow)).toBeUndefined();
  });

  it("refuses native Windows with the WSL2 guide", async () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });

    expect(await checkPlatformGate("win32", undefined)).toBe(1);
    const output = errors.join("\n");
    expect(output).toContain("WSL2");
    expect(output).toContain("docs/start-here-on-windows.md");
  });
});

describe("checkColimaGate", () => {
  it("continues when Docker is not on Colima", async () => {
    colima.checkColimaAsync.mockResolvedValue({ isColima: false, running: false });
    expect(await checkColimaGate()).toBeUndefined();
  });

  it("continues when the Colima VM is up", async () => {
    colima.checkColimaAsync.mockResolvedValue({ isColima: true, running: true });
    expect(await checkColimaGate()).toBeUndefined();
  });

  it("stops with the fix when the Colima VM is stopped", async () => {
    colima.checkColimaAsync.mockResolvedValue({
      isColima: true,
      running: false,
      problem: "The Colima VM is stopped.",
      fix: "colima start",
    });
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });

    expect(await checkColimaGate()).toBe(1);
    const output = lines.join("\n");
    expect(output).toContain("The Colima VM is stopped.");
    expect(output).toContain("Fix: colima start");
  });

  it("falls back to default text when Colima reports no detail", async () => {
    colima.checkColimaAsync.mockResolvedValue({ isColima: true, running: false });
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });

    expect(await checkColimaGate()).toBe(1);
    const output = lines.join("\n");
    expect(output).toContain("The Colima VM is not running.");
    expect(output).toContain("colima start");
  });
});

describe("checkHelpGates", () => {
  const program = {
    commands: [] as Command[],
    error: vi.fn(),
  } as unknown as Command;

  it("rewrites --doctor to the doctor command", () => {
    const argv = ["node", "flisk", "--doctor"];
    expect(checkHelpGates(argv, program)).toBeUndefined();
    expect(argv[2]).toBe("doctor");
  });

  it.each(["-h", "--help", "help"])("prints the command table for a lone %s", (flag) => {
    expect(checkHelpGates(["node", "flisk", flag], program)).toBe(0);
    expect(showHelp).toHaveBeenCalled();
    expect(showDemoHelp).not.toHaveBeenCalled();
  });

  it("prints the demo help for `flisk help demo` (#3743)", () => {
    expect(checkHelpGates(["node", "flisk", "help", "demo"], program)).toBe(0);
    expect(showDemoHelp).toHaveBeenCalled();
  });

  it("does not take `help demo` with extra arguments", () => {
    const prog = {
      commands: [] as Command[],
      error: vi.fn(),
    } as unknown as Command;
    expect(checkHelpGates(["node", "flisk", "help", "demo", "extra"], prog)).toBeUndefined();
    // `help demo extra` falls through to resolveHelpTarget: `demo` is not in the
    // program tree, so it is reported unknown through program.error.
    expect(prog.error).toHaveBeenCalledWith(
      "error: unknown command 'demo'",
      expect.objectContaining({ exitCode: 1, code: "commander.unknownCommand" }),
    );
  });

  it("reports an unknown help target through the program, like an unknown command", () => {
    const prog = {
      commands: [] as Command[],
      error: vi.fn(),
    } as unknown as Command;
    checkHelpGates(["node", "flisk", "help", "bogus"], prog);
    expect(prog.error).toHaveBeenCalledWith(
      "error: unknown command 'bogus'",
      expect.objectContaining({ exitCode: 1, code: "commander.unknownCommand" }),
    );
  });

  it("prints the nested command's help for `help <cmd> <sub>`", () => {
    const leaf = {
      name: () => "check",
      aliases: () => [] as string[],
      commands: [] as Command[],
      help: vi.fn(),
    };
    const parent = {
      name: () => "mcp",
      aliases: () => [] as string[],
      commands: [leaf] as unknown as Command[],
      help: vi.fn(),
    };
    const prog = {
      commands: [parent] as unknown as Command[],
      error: vi.fn(),
    } as unknown as Command;

    expect(checkHelpGates(["node", "flisk", "help", "mcp", "check"], prog)).toBeUndefined();
    expect(leaf.help).toHaveBeenCalledTimes(1);
  });

  it("continues to parseAsync for a plain command", () => {
    expect(checkHelpGates(["node", "flisk", "status"], program)).toBeUndefined();
  });
});
