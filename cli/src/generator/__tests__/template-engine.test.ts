// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { generateMasterConfigs, loadTemplate, TemplateEngine } from "../template-engine.js";

describe("template engine module contract", () => {
  it("publishes the template entry points", () => {
    expect(typeof loadTemplate).toBe("function");
    expect(typeof generateMasterConfigs).toBe("function");
    expect(typeof TemplateEngine).toBe("function");
  });
});
