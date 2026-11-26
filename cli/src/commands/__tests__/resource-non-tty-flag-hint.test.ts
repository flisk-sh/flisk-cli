// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it, vi } from "vitest";
import { runCommandInProcess } from "../../test-support/run-in-process.js";
import { createTempProject } from "../../test-support/temp-project.js";
import { toMachineError } from "../../utils/machine-output.js";
import { resourceNoInputError } from "../resource.js";

const promptMocks = vi.hoisted(() => ({
  promptSelect: vi.fn(),
  promptText: vi.fn(),
  promptConfirm: vi.fn(),
  promptMultiSelect: vi.fn(),
}));

vi.mock("../../utils/prompt.js", () => promptMocks);

describe("resource no-input flag hint (issue 4345)", () => {
  it("names --stack <name> and --yes in the error and its suggestions", () => {
    const error = resourceNoInputError(
      new Error("No input available to answer the prompt. Run this in a terminal."),
    );

    expect(error.message).toContain("--stack <name>");
    expect(error.message).toContain("--yes");
    expect(error.suggestions.join(" ")).toContain("--stack <name>");
    expect(error.suggestions.join(" ")).toContain("--yes");
  });

  it("carries the same hint and exit code 1 into a JSON error envelope", () => {
    const error = resourceNoInputError(
      new Error("No input available to answer the prompt. Run this in a terminal."),
    );
    const { error: machine, exitCode } = toMachineError(error);

    expect(exitCode).toBe(1);
    expect(JSON.stringify(machine)).toContain("--stack <name>");
    expect(JSON.stringify(machine)).toContain("--yes");
  });

  it("prints --stack and --yes in the non-TTY text error", async () => {
    vi.resetModules();
    promptMocks.promptText.mockRejectedValue(
      new Error("No input available to answer the prompt. Run this in a terminal."),
    );

    const { resourceCommand: command } = await import("../resource.js");
    const { clearDiscoveryCache } = await import("../../utils/discovery-context.js");
    const projectRoot = createTempProject();
    clearDiscoveryCache();
    const result = await runCommandInProcess(command, ["api", "--type", "backend"], projectRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--stack <name>");
    expect(result.stderr).toContain("--yes");
  });
});

describe("resource no-terminal example from the typed command (issue 5059)", () => {
  it("builds the example from the name, type and --local the user typed", () => {
    const error = resourceNoInputError(
      new Error("No input available to answer the prompt. Run this in a terminal."),
      { name: "web", type: "frontend", isTypeExplicit: true, local: true },
    );

    expect(error.suggestions.join(" ")).toContain(
      "flisk resource web --type frontend --local --stack main --yes",
    );
    expect(error.suggestions.join(" ")).not.toContain("flisk resource api --type backend");
  });

  it("keeps the fixed example when no name was typed", () => {
    const error = resourceNoInputError(
      new Error("No input available to answer the prompt. Run this in a terminal."),
    );

    expect(error.suggestions.join(" ")).toContain(
      "flisk resource api --type backend --stack main --yes",
    );
  });

  it("repeats --framework but not --type when the type was not typed explicitly", () => {
    const error = resourceNoInputError(
      new Error("No input available to answer the prompt. Run this in a terminal."),
      { name: "api", type: "backend", isTypeExplicit: false, framework: "express" },
    );

    expect(error.suggestions.join(" ")).toContain(
      "flisk resource api --framework express --stack main --yes",
    );
    expect(error.suggestions.join(" ")).not.toContain("--type backend");
  });

  it("prints the typed example in the non-TTY text error", async () => {
    vi.resetModules();
    promptMocks.promptText.mockRejectedValue(
      new Error("No input available to answer the prompt. Run this in a terminal."),
    );

    const { resourceCommand: command } = await import("../resource.js");
    const { clearDiscoveryCache } = await import("../../utils/discovery-context.js");
    const projectRoot = createTempProject();
    clearDiscoveryCache();
    const result = await runCommandInProcess(
      command,
      ["web", "--type", "frontend", "--local"],
      projectRoot,
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "flisk resource web --type frontend --local --stack main --yes",
    );
  });
});
