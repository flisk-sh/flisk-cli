// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type { AgentConfig, DevConfig, DevTestOnSaveConfig } from "../dev-config.js";

describe("dev and agent config types", () => {
  it("shapes the dev loop knobs, testOnSave as flag or object", () => {
    const flagForm: DevConfig = {
      command: "bun run dev",
      watch: ["src", "package.json"],
      liveReload: true,
      testOnSave: true,
    };
    const objectForm: DevConfig = {
      testOnSave: { enabled: true, path: "src" } satisfies DevTestOnSaveConfig,
    };
    expect(flagForm.testOnSave).toBe(true);
    expect(objectForm.testOnSave).toEqual({ enabled: true, path: "src" });
  });

  it("keeps agent durability to the two supported stores", () => {
    const files: AgentConfig = { runtime: "custom", durability: "files" };
    const postgres: AgentConfig = { durability: "postgres" };
    expect(files.durability).toBe("files");
    expect(postgres.durability).toBe("postgres");
  });
});
