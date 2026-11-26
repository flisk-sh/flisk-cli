// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTempProject,
  projectJsonFixture,
  runCommandInProcess,
  runFlisk,
} from "../../test-support/index.js";
import { RESOURCE_CREATE_TYPE_VALUES } from "../../types/index.js";
import { clearDiscoveryCache } from "../../utils/discovery-context.js";

const promptMocks = vi.hoisted(() => ({
  promptSelect: vi.fn(),
  promptText: vi.fn(),
  promptConfirm: vi.fn(),
  promptMultiSelect: vi.fn(),
}));
vi.mock("../../utils/prompt.js", () => promptMocks);

const originalCwd = process.cwd();

const TYPE_PROMPT_PROJECT = {
  ...projectJsonFixture("type-prompt-test"),
  discovery: { paths: ["services/**", "apps/**", "workers/**", "packages/**"] },
};

async function runResource(projectRoot: string, args: string[], options: { isTTY?: boolean } = {}) {
  vi.resetModules();
  const { resourceCommand } = await import("../resource.js");
  clearDiscoveryCache();

  const isTTY = options.isTTY ?? true;
  const originalStdinTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  Object.defineProperty(process.stdin, "isTTY", { value: isTTY, configurable: true });
  try {
    return await runCommandInProcess(resourceCommand, args, projectRoot);
  } finally {
    if (originalStdinTTY) {
      Object.defineProperty(process.stdin, "isTTY", originalStdinTTY);
    } else {
      Object.defineProperty(process.stdin, "isTTY", { value: undefined, configurable: true });
    }
  }
}

function typePromptCalls() {
  return promptMocks.promptSelect.mock.calls.filter(
    ([opts]) => typeof opts?.message === "string" && opts.message === "Resource type:",
  );
}

describe("resource type prompt when --type is omitted", () => {
  const dirs: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    // The type prompt is skipped in CI, so the prompt tests must not inherit CI from the runner.
    vi.stubEnv("CI", "");
    promptMocks.promptConfirm.mockResolvedValue(true);
    promptMocks.promptText.mockRejectedValue(new Error("Unexpected promptText call"));
    promptMocks.promptSelect.mockRejectedValue(new Error("Unexpected promptSelect call"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    process.chdir(originalCwd);
    clearDiscoveryCache();
    while (dirs.length > 0) {
      const dir = dirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it("presents every supported resource type with a short description in interactive terminals", async () => {
    const root = createTempProject({ projectJson: TYPE_PROMPT_PROJECT });
    dirs.push(root);
    const { RESOURCE_TYPE_CHOICES } = await import("../resource.js");

    expect(RESOURCE_TYPE_CHOICES[0]?.value).toBe("backend");
    const values = RESOURCE_TYPE_CHOICES.map((c) => c.value);
    for (const type of [...RESOURCE_CREATE_TYPE_VALUES, "sdk"]) {
      expect(values).toContain(type);
    }
    for (const choice of RESOURCE_TYPE_CHOICES) {
      expect(choice.title.startsWith(`${choice.value}: `)).toBe(true);
      expect(choice.title.slice(choice.value.length + 2).trim().length).toBeGreaterThan(5);
    }

    promptMocks.promptSelect.mockResolvedValueOnce("worker");
    const result = await runResource(root, ["job", "--stack", "shop"], { isTTY: true });

    expect(result.status, result.stderr).toBeUndefined();
    expect(typePromptCalls()).toHaveLength(1);
    expect(typePromptCalls()[0]?.[0].choices).toEqual(RESOURCE_TYPE_CHOICES);
    const manifest = JSON.parse(readFileSync(join(root, "workers/job/service.json"), "utf8"));
    expect(manifest.appType).toBe("worker");
    expect(existsSync(join(root, "services/shop/job"))).toBe(false);
  });

  it("prompts for type before resource name and validates frontend options cleanly", async () => {
    const root = createTempProject({ projectJson: TYPE_PROMPT_PROJECT });
    dirs.push(root);
    promptMocks.promptSelect.mockResolvedValueOnce("frontend").mockResolvedValueOnce("react");
    promptMocks.promptText.mockResolvedValueOnce("storefront");

    const result = await runResource(root, ["--stack", "shop", "--base-path", "/shop"], {
      isTTY: true,
    });

    expect(result.status, result.stderr).toBeUndefined();
    expect(promptMocks.promptSelect.mock.calls.map(([o]) => o.message)).toEqual([
      "Resource type:",
      "Frontend framework:",
    ]);
    expect(promptMocks.promptText).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Resource name (kebab-case):" }),
    );
    const manifest = JSON.parse(readFileSync(join(root, "apps/storefront/service.json"), "utf8"));
    expect(manifest.appType).toBe("frontend");
    expect(manifest.framework).toBe("react");
    expect(manifest.basePath).toBe("/shop");
  });

  it("preserves inference handling when selected from the interactive type prompt", async () => {
    const root = createTempProject({ projectJson: TYPE_PROMPT_PROJECT });
    dirs.push(root);
    promptMocks.promptSelect.mockResolvedValueOnce("inference");

    const result = await runResource(root, ["llm", "--stack", "shop"], { isTTY: true });

    expect(result.status, result.stderr).toBeUndefined();
    expect(typePromptCalls()).toHaveLength(1);
    const manifest = JSON.parse(readFileSync(join(root, "services/shop/llm/service.json"), "utf8"));
    expect(manifest.appType).toBe("bring-your-own");
    expect(manifest.port).toBe(11434);
    expect(manifest.image).toBe("ollama/ollama");
    expect(manifest.healthCheckPath).toBe("/v1/models");
  });

  it("skips the type prompt when --type is supplied", async () => {
    const root = createTempProject({ projectJson: TYPE_PROMPT_PROJECT });
    dirs.push(root);
    promptMocks.promptSelect.mockResolvedValueOnce("hono");

    const backendResult = await runResource(root, ["api", "--type", "backend", "--stack", "shop"], {
      isTTY: true,
    });
    expect(backendResult.status, backendResult.stderr).toBeUndefined();
    expect(typePromptCalls()).toHaveLength(0);
    expect(promptMocks.promptSelect).toHaveBeenCalledTimes(1);
    expect(promptMocks.promptSelect).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Backend framework:" }),
    );

    const workerResult = await runResource(root, ["job", "--type", "worker", "--stack", "shop"], {
      isTTY: true,
    });
    expect(workerResult.status, workerResult.stderr).toBeUndefined();
    expect(promptMocks.promptSelect).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["--yes in terminal", ["--yes"], true],
    ["--yes non-TTY", ["--yes"], false],
    ["--json in terminal", ["--json"], true],
    ["--json non-TTY", ["--json"], false],
    ["--dry-run non-TTY", ["--dry-run"], false],
  ])("preserves the backend default without prompting under %s", async (_label, flags, isTTY) => {
    const root = createTempProject({ projectJson: TYPE_PROMPT_PROJECT });
    dirs.push(root);

    const result = await runResource(root, ["api", "--stack", "shop", ...flags], { isTTY });

    expect(result.status, result.stderr).toBeUndefined();
    expect(typePromptCalls()).toHaveLength(0);
    expect(promptMocks.promptSelect).not.toHaveBeenCalled();

    if (flags.includes("--dry-run")) {
      expect(existsSync(join(root, "services/shop/api"))).toBe(false);
    } else {
      const manifest = JSON.parse(
        readFileSync(join(root, "services/shop/api/service.json"), "utf8"),
      );
      expect(manifest.appType).toBe("backend");
    }
  });

  it("keeps requiring --yes or a terminal when --type is omitted in non-TTY", () => {
    const root = createTempProject({ projectJson: TYPE_PROMPT_PROJECT });
    dirs.push(root);

    const result = runFlisk(["resource", "api", "--stack", "shop"], { cwd: root, input: "" });
    expect(result.status).toBe(1);
    expect(result.stderr + result.stdout).toContain("--yes or a terminal");
    expect(existsSync(join(root, "services/shop/api"))).toBe(false);
  });

  it("still rejects invalid explicit --type values with supported-types guidance without prompting", async () => {
    const root = createTempProject({ projectJson: TYPE_PROMPT_PROJECT });
    dirs.push(root);

    const result = await runResource(root, ["api", "--type", "bakend", "--stack", "shop"], {
      isTTY: true,
    });

    expect(result.status).toBe(1);
    expect(promptMocks.promptSelect).not.toHaveBeenCalled();
    expect(promptMocks.promptText).not.toHaveBeenCalled();
    expect(result.stderr).toMatch(/Unknown resource type "bakend"\. Supported types: backend/);
    expect(result.stderr).toContain('Did you mean "backend"?');
  });

  it("names --type and --yes, not --stack, when type selection fails", async () => {
    const root = createTempProject({ projectJson: TYPE_PROMPT_PROJECT });
    dirs.push(root);
    promptMocks.promptSelect.mockRejectedValueOnce(new Error("Closed"));

    const result = await runResource(root, ["api"], { isTTY: true });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Pass --type <type> or --yes to skip this prompt.");
    expect(result.stderr).toContain("flisk resource api --type backend --yes");
    expect(result.stderr).not.toContain("--stack");
  });

  it.each(["1", "true"])("keeps the backend default without prompting when CI=%s", async (ci) => {
    vi.stubEnv("CI", ci);
    const root = createTempProject({ projectJson: TYPE_PROMPT_PROJECT });
    dirs.push(root);
    // Only the type question is skipped in CI; the backend framework prompt still runs on a TTY.
    promptMocks.promptSelect.mockResolvedValueOnce("hono");

    const result = await runResource(root, ["api", "--stack", "shop"], { isTTY: true });

    expect(result.status, result.stderr).toBeUndefined();
    expect(typePromptCalls()).toHaveLength(0);
    const manifest = JSON.parse(readFileSync(join(root, "services/shop/api/service.json"), "utf8"));
    expect(manifest.appType).toBe("backend");
  });
});
