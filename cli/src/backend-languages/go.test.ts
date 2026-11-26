// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { GO_DEV_COMMAND, goBackendProvider } from "./go.js";

const files = goBackendProvider.createFiles?.("test-app") ?? [];
const contentOf = (filename: string): string =>
  files.find((file) => file.filename === filename)?.content ?? "";

describe("Go backend language module", () => {
  it("exposes the provider contract", () => {
    expect(goBackendProvider).toMatchObject({
      id: "go",
      label: "Go 1.23 (net/http)",
      devCommand: GO_DEV_COMMAND,
    });
    expect(GO_DEV_COMMAND).toBe("go run .");
  });

  it("generates go.mod, main.go and main_test.go, none empty", () => {
    expect(files.map((file) => file.filename)).toEqual(["go.mod", "main.go", "main_test.go"]);
    for (const file of files) {
      expect(file.content.trim(), file.filename).not.toBe("");
    }
  });

  it.each<[filename: string, expected: string[]]>([
    ["go.mod", ["module test-app", "go 1.23"]],
    [
      "main.go",
      [
        '"service": "test-app"',
        "test-app listening on :%s",
        'mux.HandleFunc("GET /health"',
        'mux.HandleFunc("GET /{$}"',
        '"status": "ok"',
      ],
    ],
    [
      "main_test.go",
      ['"test-app"', "func TestHealth(t *testing.T)", '"/health"', "func TestRoot(t *testing.T)"],
    ],
  ])("%s carries the expected content", (filename, expected) => {
    for (const snippet of expected) {
      expect(contentOf(filename)).toContain(snippet);
    }
  });
});

describe("Go backend port handling", () => {
  it("validates PORT before listening and defaults to 3000 on invalid values", () => {
    const source = contentOf("main.go");
    expect(source).toContain('"strconv"');
    expect(source).toContain("func portFromEnv() string {");
    expect(source).toContain("strconv.Atoi(port)");
    expect(source).toContain("err != nil || number < 1 || number > 65535");
    expect(source).toContain('return "3000"');
    expect(source).toContain("port := portFromEnv()");
  });

  it("generates regression cases for malformed, out-of-range, and valid port values", () => {
    const tests = contentOf("main_test.go");
    expect(tests).toContain("func TestPortFromEnv(t *testing.T)");
    for (const value of ['"abc"', '"70000"', '"0"', '"-1"', '"3000.5"']) {
      expect(tests).toContain(value);
    }
    expect(tests).toContain('t.Setenv("PORT", tt.value)');
  });
});

describe("Go backend build outputs", () => {
  it("ignores the binary go build writes for the scaffolded module", () => {
    // `go build` names the binary after the module (`${name}`), appending .exe on Windows.
    expect(goBackendProvider.gitignore).toEqual(["/${name}", "/${name}.exe"]);
  });
});
