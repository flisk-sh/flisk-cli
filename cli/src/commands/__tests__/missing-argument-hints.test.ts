// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
/**
 * A command that takes a required positional argument tells the user where to find valid
 * values when the argument is missing, the way `flisk restart` points at `flisk resources`
 * (#4985). The table is walked from the generated command specs, so a new command with a
 * required argument joins it automatically and fails until it declares a hint.
 */
import { describe, expect, it } from "vitest";
import { parseEnvelope, runFlisk } from "../../test-support/index.js";
import { COMMAND_SPECS } from "../command-specs.generated.js";
import type { CommandSpec } from "../command-specs.js";

/** The spec of every command and subcommand that declares a required positional argument. */
function requiredArgumentSpecs(): CommandSpec[] {
  const specs: CommandSpec[] = [];
  const walk = (spec: CommandSpec): void => {
    if (spec.arguments.some((argument) => argument.required)) specs.push(spec);
    for (const subcommand of spec.subcommands) walk(subcommand);
  };
  for (const spec of COMMAND_SPECS) walk(spec);
  return specs;
}

const REQUIRED_SPECS = requiredArgumentSpecs();
const CASES = REQUIRED_SPECS.map((spec) => [spec.path.join(" "), spec] as const);

describe("commands with a required positional argument (#4985)", () => {
  it("the walked table covers the commands the issue named", () => {
    const paths = REQUIRED_SPECS.map((spec) => spec.path.join(" "));
    expect(paths).toContain("run");
    expect(paths).toContain("config explain");
  });

  it.each(CASES)("flisk %s declares a help-after-error hint", (_name, spec) => {
    expect(spec.showHelpAfterError?.trim().length).toBeGreaterThan(0);
  });

  it.each(CASES)("flisk %s prints the parser error followed by its hint", (_name, spec) => {
    const result = runFlisk(spec.path, { cwd: process.cwd() });
    expect(result.status).toBe(2);
    const required = spec.arguments.find((argument) => argument.required);
    expect(result.stderr).toContain(`error: missing required argument '${required?.name}'`);
    expect(result.stderr).toContain(spec.showHelpAfterError?.trim() ?? "");
    const lines = result.stderr.split("\n").filter((line) => line.trim() !== "");
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });
});

describe("the commands the issue named", () => {
  it("flisk run with no service names where to list them", () => {
    const result = runFlisk(["run"], { cwd: process.cwd() });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("missing required argument 'service'");
    expect(result.stderr).toContain("Run `flisk resources`");
  });

  it("flisk config explain with no file shows an example path", () => {
    const result = runFlisk(["config", "explain"], { cwd: process.cwd() });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("missing required argument 'file'");
    expect(result.stderr).toContain("flisk config explain .flisk/project.json");
  });
});

describe("--json for a missing argument keeps the envelope clean (#4246)", () => {
  it.each([
    [["run", "--json"], "service"],
    [["config", "explain", "--json"], "file"],
  ])("flisk %s returns one USAGE envelope and nothing on stderr", (args, argument) => {
    const result = runFlisk(args, { cwd: process.cwd() });
    expect(result.status).toBe(2);
    expect(result.stderr).toBe("");
    const envelope = parseEnvelope(result.stdout);
    expect(envelope.errors[0]?.code).toBe("USAGE");
    expect(envelope.errors[0]?.message).toBe(`error: missing required argument '${argument}'`);
  });
});
