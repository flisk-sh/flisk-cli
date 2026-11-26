// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import {
  buildOutputTail,
  capEnd,
  capStart,
  lastLines,
  loggedErrorLine,
  logTail,
  MAX_FAILURE_MESSAGE,
} from "../startup-logs.js";

describe("logTail", () => {
  it("joins the last lines that have text on one line", () => {
    const log = "first line\n\nsecond line   \n   \nthird line\n";
    expect(logTail(log)).toBe("first line second line third line");
  });

  it("keeps only the last three lines by default", () => {
    const log = "one\ntwo\nthree\nfour\nfive\n";
    expect(logTail(log)).toBe("three four five");
  });

  it("honours a different line count", () => {
    const log = "one\ntwo\nthree\n";
    expect(logTail(log, 1)).toBe("three");
    expect(logTail(log, 2)).toBe("two three");
  });

  it("strips terminal control sequences before measuring", () => {
    const log = "\u001b[31mred text\u001b[0m\nplain\n";
    expect(logTail(log)).toBe("red text plain");
    expect(logTail(log)).not.toContain("\u001b");
  });

  it("returns null for a log with no text", () => {
    expect(logTail("")).toBeNull();
    expect(logTail("\n\n  \n")).toBeNull();
  });

  it("keeps the end of a long tail, where the reason is", () => {
    const poolExhausted =
      "Error response from daemon: all predefined address pools have been fully subnetted";
    const tail = logTail(`${"x".repeat(400)}\n${poolExhausted}\n`);
    expect(tail?.length).toBe(MAX_FAILURE_MESSAGE);
    expect(tail?.endsWith(poolExhausted)).toBe(true);
  });
});

describe("loggedErrorLine", () => {
  it("returns the last ERROR line without its prefix", () => {
    const log = "ERROR: first failure\nsome noise\nERROR: second failure\n";
    expect(loggedErrorLine(log)).toBe("second failure");
  });

  it("finds the marker after a Tilt resource prefix", () => {
    const log = "postgres-healthy │ ERROR: container api exited with code 3\n";
    expect(loggedErrorLine(log)).toBe("container api exited with code 3");
  });

  it("returns null when no line carries the marker", () => {
    expect(loggedErrorLine("all quiet\nerror: lowercase does not count\n")).toBeNull();
    expect(loggedErrorLine("")).toBeNull();
  });
});

describe("buildOutputTail", () => {
  const buildLog = [
    "Step 1/6 : FROM flisk-sh/flisk-l4-base:latest",
    "Step 2/6 : WORKDIR /app",
    "Step 3/6 : COPY install-deps.sh .",
    "Step 4/6 : RUN ./install-deps.sh",
    "bun install v1.2.20",
    "\u001b[31mERROR: error: FailedToOpenSocket downloading package manifest @flisk-sh/flisk\u001b[0m",
    "",
  ].join("\n");

  it("returns the error line and the four lines before it", () => {
    const tail = buildOutputTail(buildLog);
    const lines = tail?.split("\n") ?? [];
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe("Step 2/6 : WORKDIR /app");
    expect(lines.at(-1)).toBe(
      "ERROR: error: FailedToOpenSocket downloading package manifest @flisk-sh/flisk",
    );
  });

  it("keeps every line when the build log is shorter than the tail", () => {
    const tail = buildOutputTail("Step 1/2 : FROM scratch\nERROR: failed\n");
    expect(tail?.split("\n")).toHaveLength(2);
  });

  it("uses the last error line when a build logged several", () => {
    const log = "ERROR: first\nmore work\nerror: lowercase second\n";
    expect(buildOutputTail(log)?.split("\n").at(-1)).toBe("error: lowercase second");
  });

  it("accepts the lowercase spelling Docker uses on some steps", () => {
    expect(buildOutputTail("line\nerror: lowercase failed\n")).toContain("error: lowercase failed");
  });

  it("handles CRLF line endings", () => {
    expect(buildOutputTail("Step 1/2 : A\r\nERROR: failed\r\n")).toContain("ERROR: failed");
  });

  it("returns null when no line marks an error", () => {
    expect(buildOutputTail("Step 1/2 : FROM scratch\nok\n")).toBeNull();
    expect(buildOutputTail("")).toBeNull();
  });
});

describe("lastLines", () => {
  it("says last line for one and last N lines otherwise", () => {
    expect(lastLines(1)).toBe("last line");
    expect(lastLines(3)).toBe("last 3 lines");
    expect(lastLines(0)).toBe("last 0 lines");
  });
});

describe("message capping", () => {
  it("caps at MAX_FAILURE_MESSAGE characters", () => {
    expect(MAX_FAILURE_MESSAGE).toBe(300);
    expect(capStart("x".repeat(400))).toHaveLength(MAX_FAILURE_MESSAGE);
    expect(capEnd("x".repeat(400))).toHaveLength(MAX_FAILURE_MESSAGE);
  });

  it("capStart keeps the beginning with an ellipsis, capEnd keeps the end", () => {
    const text = `${"a".repeat(200)}MIDDLE${"z".repeat(200)}`;
    expect(capStart(text).startsWith("a")).toBe(true);
    expect(capStart(text).endsWith("…")).toBe(true);
    expect(capEnd(text).endsWith("z".repeat(50))).toBe(true);
    expect(capEnd(text).startsWith("…")).toBe(true);
  });

  it("leaves a message at or under the cap unchanged", () => {
    expect(capStart("x".repeat(MAX_FAILURE_MESSAGE))).toBe("x".repeat(MAX_FAILURE_MESSAGE));
    expect(capEnd("short")).toBe("short");
  });
});
