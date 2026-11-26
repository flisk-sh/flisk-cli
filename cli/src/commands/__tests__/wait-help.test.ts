// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { expect, it } from "vitest";
import { waitCommand } from "../wait.js";

it("prints the --timeout default once in wait help", () => {
  let help = "";
  waitCommand.configureOutput({ writeOut: (text) => (help += text) });
  waitCommand.outputHelp();
  const timeoutLine = help.split("\n").find((line) => line.includes("--timeout"));
  expect(timeoutLine).toBeDefined();
  expect(timeoutLine?.match(/\(default/g)).toHaveLength(1);
});
