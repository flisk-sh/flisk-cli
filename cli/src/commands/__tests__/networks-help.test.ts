// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { expect, it } from "vitest";
import { networksCommand } from "../networks.js";

it("shows examples in networks help", () => {
  let help = "";
  networksCommand.configureOutput({ writeOut: (text) => (help += text) });
  networksCommand.outputHelp();
  expect(help).toContain("Examples:");
  expect(help).toContain("flisk networks --stack shop");
});
