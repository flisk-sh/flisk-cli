// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import type { DiscoveredResource } from "../../types/index.js";
import { checkDuplicateResourcePorts } from "../doctor-wiring.js";

function makeBackend(
  name: string,
  port: number,
  command?: string,
  appType = "backend",
): DiscoveredResource {
  return {
    name,
    stack: "app",
    path: `/proj/services/app/${name}`,
    configPath: `/proj/services/app/${name}/service.json`,
    config: {
      appName: name,
      appType,
      port,
      ...(command ? { command } : {}),
    } as unknown as DiscoveredResource["config"],
  };
}

describe("checkDuplicateResourcePorts local-process vs container severity", () => {
  it("returns a hard error without container wording when two local-process services share a port", () => {
    const result = checkDuplicateResourcePorts("/proj", [
      makeBackend("api", 4000, "bun run dev"),
      makeBackend("db2", 4000, "bun run dev"),
    ]);
    expect(result.didPass).toBe(false);
    expect(result.isWarning).toBe(false);
    expect(result.message).toContain("port 4000: api, db2");
    expect(result.fix).toContain("local-process services");
    expect(result.fix).not.toContain("container");
  });

  it("keeps container-only duplicate ports as a warning", () => {
    const result = checkDuplicateResourcePorts("/proj", [
      makeBackend("api", 4000),
      makeBackend("worker", 4000),
    ]);
    expect(result.didPass).toBe(false);
    expect(result.isWarning).toBe(true);
    expect(result.fix).toContain("Each container can listen on the same port");
  });

  it("returns a hard error when two local-process frontends share a port", () => {
    const result = checkDuplicateResourcePorts("/proj", [
      makeBackend("web", 3000, "vite", "frontend"),
      makeBackend("admin", 3000, "vite", "frontend"),
    ]);
    expect(result.didPass).toBe(false);
    expect(result.isWarning).toBe(false);
    expect(result.message).toContain("port 3000: web, admin");
  });

  it("ignores container frontends and a lone local-process frontend beside a container backend", () => {
    expect(
      checkDuplicateResourcePorts("/proj", [
        makeBackend("web", 3000, undefined, "frontend"),
        makeBackend("admin", 3000, undefined, "frontend"),
      ]).didPass,
    ).toBe(true);
    expect(
      checkDuplicateResourcePorts("/proj", [
        makeBackend("web", 3000, "vite", "frontend"),
        makeBackend("api", 3000),
      ]).didPass,
    ).toBe(true);
  });
});
