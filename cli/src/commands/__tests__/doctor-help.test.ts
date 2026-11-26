// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { expect, it } from "vitest";
import { doctorCommand } from "../doctor.js";

it("shows examples in doctor help", () => {
  let help = "";
  doctorCommand.configureOutput({ writeOut: (text) => (help += text) });
  doctorCommand.outputHelp();
  expect(help).toContain("Examples:");
  expect(help).toContain("flisk doctor");
});

it("prints the --scope default once in doctor help", () => {
  let help = "";
  doctorCommand.configureOutput({ writeOut: (text) => (help += text) });
  doctorCommand.outputHelp();
  const start = help.indexOf("--scope <scope>");
  expect(start).toBeGreaterThanOrEqual(0);
  const scopeHelp = help.slice(start, help.indexOf("\n  -", start));
  expect(scopeHelp).toContain("(default:");
  expect(scopeHelp.match(/\(default/g)).toHaveLength(1);
});
