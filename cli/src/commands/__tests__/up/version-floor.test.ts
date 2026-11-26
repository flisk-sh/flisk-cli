// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import {
  afterEach,
  beforeEach,
  describe,
  enforceVersionFloor,
  expect,
  it,
  join,
  mkdirSync,
  mkdtempSync,
  rmTreeBestEffort,
  tmpdir,
  vi,
  writeFileSync,
} from "../../test-support/up.js";

describe("enforceVersionFloor", () => {
  let dir: string;
  const exit = () =>
    vi.fn((code: number) => {
      throw new Error(`exit ${code}`);
    }) as unknown as (code: number) => never;
  const write = (config: object) =>
    writeFileSync(join(dir, ".flisk", "project.json"), JSON.stringify(config));

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "flisk-up-version-"));
    mkdirSync(join(dir, ".flisk"), { recursive: true });
  });
  afterEach(() => {
    rmTreeBestEffort(dir);
    vi.restoreAllMocks();
  });

  it("rejects a CLI version that differs from the repository pin", () => {
    write({ pinnedFliskVersion: "1.3.80" });

    const e = exit();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const onFail = vi.fn();

    expect(() => enforceVersionFloor(dir, { onFail }, "1.3.81", e)).toThrow("exit 1");

    expect(err).toHaveBeenCalledWith(
      expect.stringContaining("does not match pinnedFliskVersion 1.3.80"),
    );
    expect(err).toHaveBeenCalledWith(
      expect.stringContaining("npm install -g @flisk-sh/flisk@1.3.80"),
    );
    expect(onFail).toHaveBeenCalledWith(
      expect.stringContaining("edit pinnedFliskVersion"),
      "mismatch",
    );
  });

  it("allows the exact pinned version", () => {
    write({ pinnedFliskVersion: "1.3.80" });

    const e = exit();
    enforceVersionFloor(dir, {}, "1.3.80", e);

    expect(e).not.toHaveBeenCalled();
  });

  it("warns when the project uses legacy minTdkVersion", () => {
    write({ minTdkVersion: "1.3.80" });

    const e = exit();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    enforceVersionFloor(dir, {}, "1.3.80", e);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("minTdkVersion is deprecated"));
    expect(e).not.toHaveBeenCalled();
  });

  it("exits 1 with doctor's message when the CLI is older", () => {
    write({ minFliskVersion: "1.3.80" });
    const e = exit();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const onFail = vi.fn();
    expect(() => enforceVersionFloor(dir, { onFail }, "1.3.79", e)).toThrow("exit 1");
    expect(err).toHaveBeenCalledWith(
      expect.stringContaining(
        "flisk 1.3.79 is older than the 1.3.80 this project requires (minFliskVersion)",
      ),
    );
    expect(err).toHaveBeenCalledWith(expect.stringContaining("Run: flisk upgrade"));
    expect(onFail).toHaveBeenCalledWith(expect.stringContaining("Run: flisk upgrade"), "too-old");
  });

  it("exits 1 on a malformed value", () => {
    write({ minFliskVersion: "latest" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => enforceVersionFloor(dir, {}, "1.3.80", exit())).toThrow("exit 1");
  });

  it("passes at or above the floor and when no minFliskVersion is set", () => {
    const e = exit();
    write({ minFliskVersion: "1.3.80" });
    enforceVersionFloor(dir, {}, "1.3.80", e);
    enforceVersionFloor(dir, {}, "2.0.0", e);
    write({});
    enforceVersionFloor(dir, {}, "0.0.1", e);
    expect(e).not.toHaveBeenCalled();
  });

  it("--ignore-version warns and does not exit", () => {
    write({ minFliskVersion: "9.9.9" });
    const e = exit();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    enforceVersionFloor(dir, { ignoreVersion: true }, "1.0.0", e);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("--ignore-version"));
    expect(e).not.toHaveBeenCalled();
  });
});
