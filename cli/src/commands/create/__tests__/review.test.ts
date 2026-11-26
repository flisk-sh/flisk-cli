// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { beforeEach, describe, expect, it, vi } from "vitest";

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
import { buildCreatePlan, type CreateAnswers } from "../../../utils/create-plan.js";
import { confirmCreate, reviewLines } from "../review.js";

const defaultBackend = backendCatalog()[0];

const allDefaults: CreateAnswers = {
  name: "my-app",
  runtime: "local",
  frontend: frontendCatalog()[0]?.id,
  backend: {
    language: defaultBackend?.id ?? "",
    ...(defaultBackend?.frameworks[0] ? { framework: defaultBackend.frameworks[0].id } : {}),
  },
  extras: [],
};

beforeEach(() => {
  for (const mock of Object.values(prompts)) mock.mockReset();
});

function withCapturedLog(run: () => Promise<unknown>): Promise<string[]> {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  return run()
    .then(() => log.mock.calls.map((call) => String(call[0])))
    .finally(() => log.mockRestore());
}

describe("reviewLines", () => {
  it("reports what is created, what it needs and what was chosen", () => {
    const lines = reviewLines(allDefaults, buildCreatePlan(allDefaults), () => true);
    expect(lines[0]).toMatch(/^Creating my-app: /);
    expect(lines[1]).toMatch(/^Needs: /);
    expect(lines[2]).toMatch(/^Chosen: /);
  });
});

describe("confirmCreate", () => {
  it("prints the review plainly and never asks without a terminal", async () => {
    const expected = reviewLines(allDefaults, buildCreatePlan(allDefaults));
    const printed = await withCapturedLog(async () => {
      expect(await confirmCreate(allDefaults, buildCreatePlan(allDefaults), false)).toBe(true);
    });
    expect(printed).toEqual(expected);
    expect(prompts.arrowSelect).not.toHaveBeenCalled();
  });

  it("skips the question when every answer is the default", async () => {
    const expected = reviewLines(allDefaults, buildCreatePlan(allDefaults));
    const printed = await withCapturedLog(async () => {
      expect(await confirmCreate(allDefaults, buildCreatePlan(allDefaults), true)).toBe(true);
    });
    expect(printed).toEqual(["", ...expected.map((line) => `  ${line}`), ""]);
    expect(prompts.arrowSelect).not.toHaveBeenCalled();
  });

  it("asks before writing when any answer was a real choice", async () => {
    const chosen: CreateAnswers = { ...allDefaults, name: "shop" };
    const steps = buildCreatePlan(chosen);
    await withCapturedLog(async () => {
      prompts.arrowSelect.mockResolvedValueOnce("create");
      expect(await confirmCreate(chosen, steps, true)).toBe(true);
      prompts.arrowSelect.mockResolvedValueOnce("cancel");
      expect(await confirmCreate(chosen, steps, true)).toBe(false);
    });
    expect(prompts.arrowSelect).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Create it?" }),
    );
  });
});
