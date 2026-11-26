// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureExit } from "../../../test-support/index.js";
import { listProjectTemplates, PROJECT_TEMPLATES } from "../../../utils/project-templates.js";
import {
  ACTION_WORD_HINTS,
  actionWordHint,
  exitUnknownTemplate,
  formatProjectPaths,
  printTemplateCatalog,
} from "../template-catalog.js";

/** Captures everything written to console.log until restore. */
function captureLog(): string[] {
  const lines: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  return lines;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("actionWordHint", () => {
  it.each([
    ["validate", "flisk project --check"],
    ["check", "flisk project --check"],
    ["verify", "flisk project --check"],
    ["info", "flisk info"],
    ["list", "flisk resources"],
    ["status", "flisk status"],
  ])("maps action word '%s' to '%s'", (word, command) => {
    expect(actionWordHint(word)).toBe(command);
  });

  it("matches action words case-insensitively", () => {
    expect(actionWordHint("VALIDATE")).toBe("flisk project --check");
    expect(actionWordHint("Status")).toBe("flisk status");
  });

  it.each(["deploy", "", "listall", "checklist"])(
    "returns undefined for non-action word '%s'",
    (word) => {
      expect(actionWordHint(word)).toBeUndefined();
    },
  );

  it.each(["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"])(
    "does not treat prototype key '%s' as an action word",
    (word) => {
      expect(actionWordHint(word)).toBeUndefined();
    },
  );

  it("covers exactly the documented action words", () => {
    expect(Object.keys(ACTION_WORD_HINTS).sort()).toEqual([
      "check",
      "info",
      "list",
      "status",
      "validate",
      "verify",
    ]);
  });
});

describe("exitUnknownTemplate", () => {
  /** Refuses `name` and returns everything the command printed plus the exit code used. */
  function refuse(name: string): { output: string; exit: ReturnType<typeof captureExit> } {
    const lines = captureLog();
    const exit = captureExit();
    expect(() => exitUnknownTemplate(name)).toThrow();
    return { output: lines.join("\n"), exit };
  }

  it("exits 1 and prints the error, the whole catalog, and the blank-project hint", () => {
    const { output, exit } = refuse("not-a-template");

    exit.expectExit(1);
    expect(output).toContain('Unknown template: "not-a-template"');
    expect(output).toContain("Available templates:");
    for (const [name, info] of Object.entries(PROJECT_TEMPLATES)) {
      expect(output).toContain(name);
      expect(output).toContain(info.description);
    }
    expect(output).toContain("flisk project` with no template for a blank project");
  });

  it("suggests the closest starter for a near miss", () => {
    const { output } = refuse("sas");
    expect(output).toContain('Did you mean "saas"?');
    expect(output.indexOf('Did you mean "saas"?')).toBeLessThan(
      output.indexOf('Unknown template: "sas"'),
    );
  });

  it("prefers the action-word hint over a fuzzy template match", () => {
    const { output } = refuse("status");
    expect(output).toContain('Did you mean "flisk status"?');
  });
});

describe("formatProjectPaths", () => {
  it("formats a plain POSIX relative target", () => {
    expect(formatProjectPaths("my-app", "linux", {})).toEqual({
      displayDirWithSlash: "my-app/",
      cdTarget: "my-app",
      cdCommands: ["cd my-app"],
    });
  });

  it("strips trailing slashes but keeps the display slash", () => {
    const result = formatProjectPaths("apps/my-app///", "darwin", {});
    expect(result.displayDirWithSlash).toBe("apps/my-app/");
    expect(result.cdCommands).toEqual(["cd apps/my-app"]);
  });

  it("keeps a root or single-character directory name intact", () => {
    expect(formatProjectPaths("/", "linux", {}).cdCommands).toEqual(["cd /"]);
    expect(formatProjectPaths("a", "linux", {}).cdCommands).toEqual(["cd a"]);
  });

  it("prefixes ./ on names that would read as flags", () => {
    expect(formatProjectPaths("-app", "linux", {}).cdCommands).toEqual(["cd ./-app"]);
    expect(formatProjectPaths("-app", "win32", { MSYSTEM: "MINGW64" }).cdCommands).toEqual([
      "cd '.\\-app'",
    ]);
  });

  it("quotes POSIX targets with spaces and escapes single quotes", () => {
    expect(formatProjectPaths("my app", "linux", {}).cdCommands).toEqual(["cd 'my app'"]);
    expect(formatProjectPaths("O'Reilly app", "darwin", {}).cdCommands).toEqual([
      "cd 'O'\\''Reilly app'",
    ]);
  });

  it("emits cmd syntax on Windows when the shell is explicit", () => {
    expect(formatProjectPaths("my-app", "win32", {}, "cmd").cdCommands).toEqual(["cd my-app"]);
    expect(formatProjectPaths("D:\\work\\my-app", "win32", {}, "cmd").cdCommands).toEqual([
      "cd /d D:\\work\\my-app",
    ]);
    expect(formatProjectPaths("\\\\server\\share\\my-app", "win32", {}, "cmd").cdCommands).toEqual([
      "pushd \\\\server\\share\\my-app",
    ]);
  });

  it("escapes cmd metacharacters and doubles cmd commands for ! paths", () => {
    expect(formatProjectPaths("apps/%TEMP%", "win32", {}, "cmd").cdCommands).toEqual([
      "cd apps/^%TEMP^%",
    ]);
    expect(formatProjectPaths("apps/!TEMP!", "win32", {}, "cmd").cdCommands).toEqual([
      'cmd.exe:         cd "apps/!TEMP!"',
      "cmd.exe (/v:on): cd apps/^^^!TEMP^^^!",
    ]);
    expect(
      formatProjectPaths("apps/unmatched!bang", "win32", {}, "cmd-delayed").cdCommands,
    ).toEqual(["cd apps/unmatched^^^!bang"]);
  });

  it("emits PowerShell syntax for an unambiguous pwsh", () => {
    const env = { POWERSHELL_DISTRIBUTION_CHANNEL: "MSI:Windows" };
    expect(formatProjectPaths("apps/[demo]", "win32", env).cdCommands).toEqual([
      "Set-Location -LiteralPath 'apps/[demo]'",
    ]);
    expect(formatProjectPaths("D:\\work\\my-app", "win32", env).cdCommands).toEqual([
      "cd D:\\work\\my-app",
    ]);
  });

  it("prints labeled cmd, PowerShell and Git Bash alternatives when the shell is ambiguous", () => {
    expect(formatProjectPaths("apps/100%", "win32", {}).cdCommands).toEqual([
      "cmd.exe:    cd apps/100^%",
      "PowerShell: Set-Location -LiteralPath 'apps/100%'",
      "Git Bash:   cd 'apps/100%'",
    ]);
  });

  it("honors FLISK_SHELL and an explicit shell argument over the environment", () => {
    expect(
      formatProjectPaths("apps/[demo]", "win32", { FLISK_SHELL: "powershell" }).cdCommands,
    ).toEqual(["Set-Location -LiteralPath 'apps/[demo]'"]);
    expect(
      formatProjectPaths("apps/my app", "win32", { FLISK_SHELL: "cmd" }, "powershell").cdCommands,
    ).toEqual(["Set-Location -LiteralPath 'apps/my app'"]);
    expect(formatProjectPaths("apps/100%", "win32", { MSYSTEM: "MINGW64" }).cdCommands).toEqual([
      "cd 'apps/100%'",
    ]);
  });

  it("resolves drive-rooted Windows paths against the working directory", () => {
    expect(formatProjectPaths("/d", "win32", {}, "cmd", "D:\\work").cdCommands).toEqual([
      "cd /d D:\\d",
    ]);
    expect(
      formatProjectPaths("/d", "win32", {}, "cmd", "\\\\server\\share\\work").cdCommands,
    ).toEqual(["pushd \\\\server\\share\\d"]);
    expect(formatProjectPaths("/d", "win32", {}, "cmd", "").cdCommands).toEqual(["cd \\d"]);
  });

  it("keeps a drive-root display label as the bare drive root", () => {
    const result = formatProjectPaths("C:\\", "win32", {}, "cmd");
    expect(result.displayDirWithSlash).toBe("C:\\");
  });
});

describe("printTemplateCatalog", () => {
  it("prints the standard envelope with the templates in data.templates for --json", () => {
    const lines = captureLog();

    printTemplateCatalog(true);

    expect(lines).toHaveLength(1);
    const envelope = JSON.parse(lines[0]);
    expect(envelope.schemaVersion).toBe(1);
    expect(envelope.errors).toEqual([]);
    expect(envelope.data.templates).toEqual(listProjectTemplates());
  });

  it("prints one block per template with key, description, repo, needs and ref for a person", () => {
    const lines = captureLog();

    printTemplateCatalog(false);

    const text = lines.join("\n");
    expect(text).toContain("Starter templates (flisk project <key>):");
    for (const { key, repo, description, needs, ref } of listProjectTemplates()) {
      expect(text).toContain(key);
      expect(text).toContain(description);
      expect(text).toContain(repo);
      expect(text).toContain(`needs: ${needs}`);
      if (ref) expect(text).toContain(`ref ${ref}`);
    }
    expect(text).not.toContain("undefined");
  });
});
