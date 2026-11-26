// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { runCompletionCommand } from "../../test-support/index.js";
import { getRegisteredCommands } from "../registry.js";

const SHELLS = ["bash", "zsh", "fish", "powershell"] as const;

async function renderCompletion(shell: string): Promise<string> {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await runCompletionCommand(["--shell", shell]);
    return log.mock.calls.map(([value]) => String(value)).join("\n");
  } finally {
    log.mockRestore();
  }
}

describe("top-level shell completions", () => {
  it.each(SHELLS)("offers every registered command in the %s script", async (shell) => {
    const script = await renderCompletion(shell);
    // The words of the script, so that "up" is not found inside "upgrade".
    const words = script.split(/[^A-Za-z0-9-]+/).filter(Boolean);

    for (const command of getRegisteredCommands()) {
      expect(words, `${shell} is missing the command ${command.name()}`).toContain(command.name());
      for (const alias of command.aliases()) {
        expect(words, `${shell} is missing the alias ${alias}`).toContain(alias);
      }
    }
  });

  it("uses the command descriptions for config and networks", async () => {
    // Bash lists the command names only; the other shells show a description next to them.
    for (const shell of ["zsh", "fish", "powershell"]) {
      const script = await renderCompletion(shell);
      expect(script, shell).toContain("Manage project configuration and regenerate master files");
      // The scripts strip `:` and truncate descriptions past 60 chars, so assert what survives.
      expect(script, shell).toContain("Show service URLs Traefik routes, or localhost addresses");
    }
  });
});

const HAS_BASH = spawnSync("bash", ["--version"], { stdio: "ignore" }).status === 0;

/** The words bash would offer at the end of a rendered completion script. */
function bashCompletions(script: string, words: string[]): string[] {
  const quotedWords = words.map((word) => JSON.stringify(word)).join(" ");
  const probe = `${script}
COMP_WORDS=(${quotedWords})
COMP_CWORD=${words.length - 1}
_flisk_completions
printf '%s\\n' "\${COMPREPLY[*]}"
`;
  const result = spawnSync("bash", ["-s"], { input: probe, encoding: "utf-8" });
  if (result.status !== 0 || result.error) {
    throw result.error ?? new Error(result.stderr);
  }
  return result.stdout.trim().split(/\s+/).filter(Boolean);
}

describe.skipIf(!HAS_BASH)("bash completion fallbacks", () => {
  it("still offers the command list before a command is typed", async () => {
    const words = bashCompletions(await renderCompletion("bash"), ["flisk", ""]);

    expect(words).toContain("down");
    expect(words).toContain("connect");
  });

  it("does not offer the command list after a command with no positional completion", async () => {
    const script = await renderCompletion("bash");

    // Commands such as `completion`, `project`, `down` and `status` have no special case. The
    // script used to default to the full command list for all of them.
    for (const command of ["completion", "project", "down", "status"]) {
      expect(bashCompletions(script, ["flisk", command, ""]), command).toEqual([]);
    }
  });
});
