// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { runFlisk } from "../../test-support/index.js";
import { restartCommand } from "../restart.js";

const helpText = () => {
  let help = "";
  restartCommand.configureOutput({ writeOut: (text) => (help += text) });
  restartCommand.outputHelp();
  return help;
};

it("shows examples in restart help", () => {
  const help = helpText();
  expect(help).toContain("Examples:");
  expect(help).toContain("flisk restart orders-api");
});

it("documents --rebuild in restart help", () => {
  const help = helpText();
  expect(help).toContain("--rebuild");
  expect(help).toContain("Rebuild the image through Tilt");
  expect(help).toContain("flisk restart orders-api --rebuild");
});

it("documents the local-process restart and its no-name form in restart help", () => {
  const help = helpText();
  expect(help).toContain("local processes restart through the running `flisk up`");
  expect(help).toContain("flisk restart ");
});

describe("restart without a resource", () => {
  it("names flisk resources in the help-after-error hint", () => {
    const hint = (restartCommand as unknown as { _showHelpAfterError?: string })
      ._showHelpAfterError;
    expect(hint).toContain("flisk resources");
    expect(hint).toContain("resource names");
  });

  it("reports the project, not the argument, outside a Flisk project", () => {
    const result = runFlisk(["restart"], { cwd: process.cwd() });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(
      /Could not find project root|Not in a Flisk project, and \d+ Flisk projects? (is|are) running/,
    );
  });
});
