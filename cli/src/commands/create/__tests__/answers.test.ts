// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it, vi } from "vitest";

const prompts = vi.hoisted(() => ({
  arrowText: vi.fn(),
  arrowSelect: vi.fn(),
  arrowMultiSelect: vi.fn(),
}));
vi.mock("../../../utils/arrow-prompt.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/arrow-prompt.js")>()),
  ...prompts,
}));

import { backendCatalog, frontendCatalog } from "../../../utils/create-catalog.js";
import { collectAnswers, installHelp, isInteractive } from "../answers.js";

describe("installHelp", () => {
  it("keeps the order of the missing list and drops programs it knows nothing about", () => {
    expect(installHelp(["bun", "made-up-tool", "go"])).toEqual([
      "  Bun: curl -fsSL https://bun.sh/install | bash",
      "  Go: https://go.dev/dl",
    ]);
    expect(installHelp([])).toEqual([]);
  });
});

describe("isInteractive", () => {
  it("is true only for a terminal on both ends without --yes", () => {
    expect(isInteractive({}, { in: true, out: true })).toBe(true);
    expect(isInteractive({}, { in: true, out: false })).toBe(false);
    expect(isInteractive({}, { in: false, out: false })).toBe(false);
    expect(isInteractive({ yes: true }, { in: true, out: true })).toBe(false);
  });
});

describe("collectAnswers", () => {
  it("fills an unflagged run with the registries' defaults without a terminal", async () => {
    const answers = await collectAnswers("shop", {}, false);
    expect(answers.name).toBe("shop");
    expect(answers.runtime).toBe("local");
    expect(answers.frontend).toBe(frontendCatalog().find((option) => option.local)?.id);
    expect(answers.backend?.language).toBe(backendCatalog()[0]?.id);
    expect(answers.extras).toEqual([]);
    expect(prompts.arrowSelect).not.toHaveBeenCalled();
  });

  it("--runtime docker alone switches the runtime without touching the parts", async () => {
    const answers = await collectAnswers("shop", { runtime: "docker" }, false);
    expect(answers.runtime).toBe("docker");
    expect(answers.frontend).toBe(frontendCatalog().find((option) => option.local)?.id);
  });
});
