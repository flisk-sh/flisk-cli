// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoveryProblem } from "../../../types/index.js";
import {
  createServiceWarnings,
  printServiceWarningOnce,
  resetPrintedServiceWarnings,
  skippedServiceFiles,
  warnAboutSkippedFiles,
} from "../warnings.js";

const skipped = (path: string, reason: string): DiscoveryProblem => ({ path, reason });

beforeEach(() => {
  resetPrintedServiceWarnings();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createServiceWarnings", () => {
  it("prints each key once through the injected printer", () => {
    const lines: string[] = [];
    const warnings = createServiceWarnings((line) => lines.push(line));

    warnings.warnOnce("a", "line a");
    warnings.warnOnce("a", "line a");
    warnings.warnOnce("b", "line b");
    warnings.warnOnce("a", "line a");

    expect(lines).toEqual(["line a", "line b"]);
  });

  it("dedups on the key, not on the printed line", () => {
    const lines: string[] = [];
    const warnings = createServiceWarnings((line) => lines.push(line));

    warnings.warnOnce("same-key", "first line");
    warnings.warnOnce("same-key", "different line");
    warnings.warnOnce("other-key", "first line");

    expect(lines).toEqual(["first line", "first line"]);
  });

  it("prints again after reset", () => {
    const lines: string[] = [];
    const warnings = createServiceWarnings((line) => lines.push(line));

    warnings.warnOnce("a", "line a");
    warnings.reset();
    warnings.warnOnce("a", "line a");

    expect(lines).toEqual(["line a", "line a"]);
  });

  it("defaults to console.warn", () => {
    createServiceWarnings().warnOnce("x", "default sink");
    expect(console.warn).toHaveBeenCalledWith("default sink");
  });
});

describe("printServiceWarningOnce", () => {
  it("prefixes the warning and prints each unique warning once", () => {
    printServiceWarningOnce("field `foo` is unknown");
    printServiceWarningOnce("field `foo` is unknown");
    printServiceWarningOnce("field `bar` is deprecated");

    expect(console.warn).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenNthCalledWith(1, "⚠️  field `foo` is unknown");
    expect(console.warn).toHaveBeenNthCalledWith(2, "⚠️  field `bar` is deprecated");
  });

  it("shares its dedup set with warnAboutSkippedFiles", () => {
    warnAboutSkippedFiles([skipped("/p/a/service.json", "invalid JSON")]);
    printServiceWarningOnce("skipped /p/a/service.json: invalid JSON");

    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("prints again after resetPrintedServiceWarnings", () => {
    printServiceWarningOnce("once");
    resetPrintedServiceWarnings();
    printServiceWarningOnce("once");

    expect(console.warn).toHaveBeenCalledTimes(2);
  });
});

describe("warnAboutSkippedFiles", () => {
  it("prints one prefixed line per problem", () => {
    warnAboutSkippedFiles([
      skipped("/root/api/service.json", "invalid JSON"),
      skipped("/root/web/service.json", "unreadable"),
    ]);

    expect(console.warn).toHaveBeenNthCalledWith(
      1,
      "⚠️  skipped /root/api/service.json: invalid JSON",
    );
    expect(console.warn).toHaveBeenNthCalledWith(
      2,
      "⚠️  skipped /root/web/service.json: unreadable",
    );
  });

  it("does not repeat a problem it already printed", () => {
    const problems = [skipped("/root/api/service.json", "invalid JSON")];
    warnAboutSkippedFiles(problems);
    warnAboutSkippedFiles(problems);

    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when the problem list is empty", () => {
    warnAboutSkippedFiles([]);
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe("skippedServiceFiles", () => {
  it("returns an empty object when nothing was skipped", () => {
    expect(skippedServiceFiles([], "/project")).toEqual({});
  });

  it("names each skipped file relative to the project root", () => {
    expect(
      skippedServiceFiles([skipped("/project/api/service.json", "invalid JSON")], "/project"),
    ).toEqual({ skipped: [{ file: "api/service.json", reason: "invalid JSON" }] });
  });

  it("keeps the absolute path when there is no project root", () => {
    const result = skippedServiceFiles([skipped("/elsewhere/api/service.json", "bad")], null);
    expect(result.skipped?.[0]?.file).toBe("/elsewhere/api/service.json");
  });
});
