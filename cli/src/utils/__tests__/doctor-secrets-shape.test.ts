// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { createTempProject, makeResource } from "../../test-support/index.js";
import { checkRequiredSecrets } from "../service-config-checks.js";

describe("checkRequiredSecrets shape validation", () => {
  it("fails when service.json secrets is an array instead of an object", () => {
    const root = createTempProject();
    const resource = makeResource("api", "backend", { secrets: ["API_TOKEN"] });
    const result = checkRequiredSecrets(root, [resource], {});
    expect(result.didPass).toBe(false);
    expect(result.message).toContain('expected an object like { "required": ["NAME"] }');
    expect(result.fix).toContain('{ "required": ["NAME"] }');
  });

  it("passes when service.json secrets uses the valid object shape and has a value", () => {
    const root = createTempProject();
    const resource = makeResource("api", "backend", { secrets: { required: ["API_TOKEN"] } });
    const result = checkRequiredSecrets(root, [resource], { API_TOKEN: "secret-val" });
    expect(result.didPass).toBe(true);
    expect(result.message).toBe("Every required secret has a value");
  });
});
