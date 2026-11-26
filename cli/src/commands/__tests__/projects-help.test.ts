// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { expect, it } from "vitest";
import { projectsCommand } from "../projects.js";

it("shows examples in projects help", () => {
  let help = "";
  projectsCommand.configureOutput({ writeOut: (text) => (help += text) });
  projectsCommand.outputHelp();
  expect(help).toContain("Examples:");
  expect(help).toContain("flisk projects --check");
});
