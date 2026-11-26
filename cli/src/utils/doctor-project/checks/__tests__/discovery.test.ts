// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { checkResourceDiscovery } from "../discovery.js";
import { useTempProject } from "./fixtures.js";

describe("checkResourceDiscovery", () => {
  const tempProject = useTempProject();

  function newProject() {
    return tempProject({
      projectJson: { discovery: { paths: ["services/*/*"] } },
      files: { Tiltfile: "" },
    });
  }

  it("passes when every resource is under a discovery path", () => {
    const project = newProject();
    project.writeService("shop/storefront", { appType: "frontend", stack: "shop" });

    expect(checkResourceDiscovery().didPass).toBe(true);
  });

  it("fails and names resources that Tilt would never start", () => {
    const project = newProject();
    project.writeService("shop/orders-api", { appType: "frontend", stack: "shop" });
    project.writeFile(
      "apps/storefront/service.json",
      JSON.stringify({ appName: "storefront", appType: "frontend", stack: "shop" }),
    );

    const result = checkResourceDiscovery();

    expect(result.didPass).toBe(false);
    expect(result.message).toContain("apps/storefront");
    expect(result.message).not.toContain("orders-api");
    expect(result.fix).toContain("discovery.paths");
  });
});
