// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { expect, it } from "vitest";
import { ejectCommand } from "../eject.js";

it("shows examples in eject help", () => {
  let help = "";
  ejectCommand.configureOutput({ writeOut: (text) => (help += text) });
  ejectCommand.outputHelp();
  expect(help).toContain("Examples:");
  expect(help).toContain("flisk eject --dry-run");
});
