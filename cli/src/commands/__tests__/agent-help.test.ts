// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { expect, it } from "vitest";
import { agentCommand } from "../agent.js";

it("shows examples in agent sessions help", () => {
  const sessionsCmd = agentCommand.commands.find((c) => c.name() === "sessions");
  let help = "";
  sessionsCmd?.configureOutput({ writeOut: (text) => (help += text) });
  sessionsCmd?.outputHelp();
  expect(help).toContain("Examples:");
  expect(help).toContain("flisk agent sessions <resource> --session-id <id>");
});
