// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import {
  buildForwardedImportArgs,
  IMPORT_PACKAGE,
  importInvocation,
  TILTFILE_IMPORTER,
} from "../invocation.js";

describe("flisk-import invocation contract", () => {
  it("runs the pinned importer package through npx --yes, without a shell", () => {
    const inv = importInvocation(["."], {}, "linux");
    expect(inv).toMatchObject({
      command: "npx",
      args: ["--yes", IMPORT_PACKAGE, "."],
      shell: false,
      windowsVerbatimArguments: false,
    });
    expect(inv.pkg).toBe(IMPORT_PACKAGE);
  });

  it("pins the importer to an exact published version", () => {
    expect(IMPORT_PACKAGE).toMatch(/^flisk-import@\d+\.\d+\.\d+$/);
  });

  it("honours FLISK_IMPORT_PACKAGE only when it is a safe package spec", () => {
    expect(importInvocation([], { FLISK_IMPORT_PACKAGE: "flisk-import@1" }, "linux").pkg).toBe(
      "flisk-import@1",
    );
    expect(importInvocation([], { FLISK_IMPORT_PACKAGE: "pkg; rm -rf /" }, "linux").pkg).toBe(
      IMPORT_PACKAGE,
    );
  });
});

describe("forwarded flag bridge", () => {
  it.each([
    ["--yes", { yes: true }],
    ["--force", { force: true }],
    ["--dry-run", { dryRun: true }],
  ])("forwards the parsed %s option as exactly one flag", (flag, options) => {
    expect(buildForwardedImportArgs(["./svc"], options)).toEqual(["./svc", flag]);
  });

  it.each([
    ["--yes", "-y"],
    ["--yes", "--yes"],
    ["--force", "-f"],
    ["--force", "--force"],
    ["--dry-run", "--dry-run"],
  ])("normalizes the %s alias %s in positional args to one flag", (flag, alias) => {
    expect(buildForwardedImportArgs(["./svc", alias])).toEqual(["./svc", flag]);
  });

  it("appends --dry-run once even when it is already in the args", () => {
    expect(buildForwardedImportArgs(["--dry-run", "./svc"], { dryRun: true })).toEqual([
      "--dry-run",
      "./svc",
    ]);
  });

  it("strips the compose keyword once and keeps everything else", () => {
    expect(buildForwardedImportArgs(["compose", "./svc"])).toEqual(["./svc"]);
    expect(buildForwardedImportArgs(["compose", "./compose"])).toEqual(["./compose"]);
    expect(buildForwardedImportArgs(["compose"])).toEqual([]);
  });

  it("never strips a path after the tiltfile keyword, even one named compose", () => {
    expect(buildForwardedImportArgs([TILTFILE_IMPORTER, "compose"])).toEqual([
      TILTFILE_IMPORTER,
      "compose",
    ]);
  });

  it("orders the generated flags deterministically: dry-run, yes, force", () => {
    expect(buildForwardedImportArgs(["./svc"], { yes: true, force: true, dryRun: true })).toEqual([
      "./svc",
      "--dry-run",
      "--yes",
      "--force",
    ]);
  });
});
