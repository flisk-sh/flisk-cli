// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkSchemaVersions, warnSchemaVersions } from "../schema.js";
import { tempProject } from "./helpers.js";

const project = tempProject("flisk-schema-checks-");
const { service } = project;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("checkSchemaVersions", () => {
  it("warns, rather than fails, when schemaVersion is missing, and points at migrate", () => {
    service("api");
    const result = checkSchemaVersions(project.root);
    expect(result.didPass).toBe(false);
    expect(result.isWarning).toBe(true);
    expect(result.message).toContain("schemaVersion: missing");
    expect(result.fix).toContain("flisk config migrate");
  });

  it("warns about a version this flisk does not support, with an upgrade fix", () => {
    service("api", { schemaVersion: 99 });
    const result = checkSchemaVersions(project.root);
    expect(result.didPass).toBe(false);
    expect(result.message).toContain("schemaVersion 99");
    expect(result.message).toContain("this flisk supports 1");
    expect(result.fix).toContain("upgrade flisk");
  });

  it("lists missing and unsupported files together", () => {
    service("old");
    service("new", { port: 4001, schemaVersion: 99 });
    const result = checkSchemaVersions(project.root);
    expect(result.didPass).toBe(false);
    expect(result.message).toContain("missing");
    expect(result.message).toContain("99");
    expect(result.fix).toContain("migrate");
    expect(result.fix).toContain("upgrade flisk");
  });

  it("is not a warning in strict mode", () => {
    service("api");
    const result = checkSchemaVersions(project.root, true);
    expect(result.didPass).toBe(false);
    expect(result.isWarning).toBe(false);
  });
});

describe("warnSchemaVersions", () => {
  it("prints the warning once for a project without schemaVersion", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    service("api");
    warnSchemaVersions(project.root);
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0]?.[0])).toContain("schemaVersion");
  });

  it("prints the fix on a second line without the Fix: prefix other warners use", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    service("api");
    warnSchemaVersions(project.root);
    expect(warn.mock.calls.length).toBeGreaterThanOrEqual(2);
    const fixLine = String(warn.mock.calls[1]?.[0]);
    expect(fixLine).toContain("migrate");
    expect(fixLine).not.toContain("Fix:");
  });

  it("stays silent when every service.json is current", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    service("api", { schemaVersion: 1 });
    warnSchemaVersions(project.root);
    expect(warn).not.toHaveBeenCalled();
  });
});
