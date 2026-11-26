// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it, vi } from "vitest";
import { makeResource } from "../../../test-support/index.js";
import {
  confirmStackUpdate,
  promptForResources,
  promptForStackName,
  type ResourcePickPrompt,
  validatePromptedStackName,
} from "../prompt.js";

describe("validatePromptedStackName", () => {
  it.each([
    ["core", true],
    ["my-stack-2", true],
    ["list", '"list" is reserved for listing stacks. Use: flisk stack --list'],
    [" LIST ", '"list" is reserved for listing stacks. Use: flisk stack --list'],
  ])("%s -> %s", (input, expected) => {
    expect(validatePromptedStackName(input)).toBe(expected);
  });

  it.each(["", "Invalid Stack", "-x", "--json"])("rejects %s with a message", (input) => {
    expect(typeof validatePromptedStackName(input)).toBe("string");
  });
});

describe("promptForStackName", () => {
  it("asks with the stack-name message and returns the answer", async () => {
    const ask = vi.fn(async () => "chosen-stack");

    const answer = await promptForStackName(ask);

    expect(answer).toBe("chosen-stack");
    expect(ask).toHaveBeenCalledWith({
      message: "Stack name (kebab-case recommended):",
      validate: validatePromptedStackName,
    });
  });
});

describe("promptForResources", () => {
  it("offers each unassigned resource by name and returns the picked paths", async () => {
    const api = makeResource("api", "backend");
    const web = makeResource("web", "frontend");
    const ask = vi.fn<ResourcePickPrompt>(async () => [api.configPath]);

    const picked = await promptForResources([api, web], "core", ask);

    expect(picked).toEqual([api.configPath]);
    const options = ask.mock.calls[0]?.[0];
    expect(options?.message).toBe('Select resources to add to stack "core":');
    expect(options?.choices).toEqual([
      { title: "api", value: api.configPath },
      { title: "web", value: web.configPath },
    ]);
    expect(options?.validate?.([])).toBe("Select at least one resource");
    expect(options?.validate?.([api.configPath])).toBe(true);
  });
});

describe("confirmStackUpdate", () => {
  it("pre-answers under --yes or --json without asking", async () => {
    const ask = vi.fn(async () => false);

    await expect(confirmStackUpdate({ yes: true }, ask)).resolves.toBe(true);
    await expect(confirmStackUpdate({ json: true }, ask)).resolves.toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });

  it.each([true, false])("asks otherwise and returns the answer %s", async (answer) => {
    const ask = vi.fn(async () => answer);

    await expect(confirmStackUpdate({}, ask)).resolves.toBe(answer);
    expect(ask).toHaveBeenCalledWith("Proceed?");
  });
});
