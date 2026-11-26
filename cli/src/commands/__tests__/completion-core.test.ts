// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProgram } from "../../program.js";
import { renderCompletionScript } from "../completion.js";
import { renderBash } from "../completion-bash.js";
import { buildCompletionCandidates, type CompletionCandidates } from "../completion-candidates.js";
import { buildCompletionTable, commandWords, flatten } from "../completion-core.js";
import { renderFish } from "../completion-fish.js";
import { renderPowerShell } from "../completion-powershell.js";
import { SUPPORTED_SHELLS, type SupportedShell } from "../completion-shells.js";
import { renderZsh } from "../completion-zsh.js";

const program = createProgram();
const candidates = buildCompletionCandidates(program);
const table = buildCompletionTable(candidates);

const RENDERERS: Record<SupportedShell, (candidates: CompletionCandidates) => string> = {
  bash: renderBash,
  zsh: renderZsh,
  fish: renderFish,
  powershell: renderPowerShell,
};

function script(shell: SupportedShell): string {
  return renderCompletionScript(shell, candidates);
}

describe("completion table core", () => {
  it("flattens every command and sub-command exactly once", () => {
    const all = table.entries.flatMap((entry) => [entry, ...flatten(entry.subcommands)]);
    expect(table.flat).toHaveLength(all.length);
    expect(new Set(table.flat).size).toBe(table.flat.length);
    for (const entry of table.flat) {
      expect(table.flat.filter((candidate) => candidate.path === entry.path)).toHaveLength(1);
    }
  });

  it("splits the flattened entries into top-level commands and sub-commands", () => {
    expect(table.flat).toHaveLength(table.entries.length + table.subEntries.length);
    for (const entry of table.subEntries) {
      expect(entry.parent).not.toBe("");
    }
    for (const entry of table.entries) {
      expect(entry.parent).toBe("");
    }
  });

  it("lists every top-level name and alias as command words", () => {
    expect(table.words).toEqual(commandWords(table.entries));
    expect(table.aliasRows).toHaveLength(table.entries.reduce((n, e) => n + e.aliases.length, 0));
  });

  it("groups the option, sub-command and positional rows a renderer iterates", () => {
    expect(table.topOptionEntries.every((entry) => entry.options.length > 0)).toBe(true);
    expect(
      table.subOptionEntries.every((entry) => entry.parent !== "" && entry.options.length > 0),
    ).toBe(true);
    expect(table.withSubcommands.every((entry) => entry.subcommands.length > 0)).toBe(true);
    expect(table.subcommandRows).toHaveLength(
      table.withSubcommands.reduce((n, e) => n + e.subcommands.length, 0),
    );
    expect(table.subPositionalEntries).toEqual(
      table.positionalEntries.filter((entry) => entry.parent !== ""),
    );
    expect(table.topPositionalEntries).toEqual(
      table.positionalEntries.filter((entry) => entry.parent === ""),
    );
    // Every entry with a positional lands in one of the per-kind rows a shell consumes.
    for (const entry of table.positionalEntries) {
      const rows = [table.stackEntries, table.resourceEntries, table.commandNameEntries].filter(
        (row) => row.includes(entry),
      );
      expect(rows.length > 0 || entry.positional === "hosts", entry.path).toBe(true);
    }
  });

  it("keys the command flag values by command path and flag", () => {
    const keys = table.commandValueRows.map((row) => row.key);
    expect(keys).toContain("resources --type");
    expect(keys).toContain("completion --shell");
    expect(keys).toContain("doctor --scope");
    for (const row of table.commandValueRows) {
      expect(row.key.endsWith(` ${row.flag}`)).toBe(true);
      const path = row.key.slice(0, row.key.length - row.flag.length - 1);
      const owner = table.flat.find((entry) => entry.path === path);
      expect(owner?.optionValues?.[row.flag]).toEqual(row.values);
    }
  });

  it("merges the fallback values into the `--type` arms once", () => {
    const framework = table.typeValueRows.find((row) => row.flag === "--framework");
    expect(framework).toBeDefined();
    const fallbackArm = framework?.arms.find((arm) => arm.types.includes(""));
    // The fallback offers the backend frameworks, so it merges into the backend arm.
    expect(fallbackArm?.types).toContain("backend");
    expect(fallbackArm?.values).toEqual(framework?.values.fallback);
    expect(framework?.arms.some((arm) => arm.types.includes("frontend"))).toBe(true);
  });
});

describe("completion renderers", () => {
  it.each(SUPPORTED_SHELLS)("dispatches %s to its own renderer", (shell) => {
    expect(script(shell)).toBe(RENDERERS[shell](candidates));
  });

  it.each(SUPPORTED_SHELLS)("renders %s deterministically", (shell) => {
    expect(script(shell)).toBe(script(shell));
  });

  it.each(SUPPORTED_SHELLS)("emits the %s script shape", (shell) => {
    const source = script(shell);
    switch (shell) {
      case "bash":
        expect(source).toContain("_flisk_completions() {");
        expect(source).toContain("complete -F _flisk_completions flisk");
        break;
      case "zsh":
        expect(source).toContain("#compdef flisk");
        expect(source).toContain("compdef _flisk flisk");
        break;
      case "fish":
        expect(source).toContain("complete -c flisk -f");
        break;
      case "powershell":
        expect(source).toContain("Register-ArgumentCompleter -Native -CommandName flisk");
        break;
    }
  });

  it("lands a change to the shared table in all four shells", () => {
    const extended: CompletionCandidates = {
      ...candidates,
      commands: [
        ...candidates.commands,
        {
          name: "zz-core-probe",
          aliases: ["zzcp"],
          description: "probe command",
          options: [{ flag: "--zz", description: "probe flag", takesValue: true }],
          subcommands: [],
        },
      ],
    };
    for (const shell of SUPPORTED_SHELLS) {
      const source = renderCompletionScript(shell, extended);
      expect(source, shell).toContain("zz-core-probe");
      expect(source, shell).toContain("zzcp");
      // fish long flags are `-l zz`; the other shells spell the flag with its dashes.
      const flag = shell === "fish" ? "-l zz" : "--zz";
      expect(source, shell).toContain(flag);
    }
  });
});

// The scripts the command prints are what the shells load, so each one must parse under its own
// shell. fish and PowerShell run only where the shell is installed.
describe("completion scripts parse under their shells", () => {
  let dir: string;

  const hasZsh = spawnSync("zsh", ["--version"]).status === 0;
  const hasFish = spawnSync("fish", ["--version"]).status === 0;
  const powershell = ["pwsh", "powershell"].find(
    (binary) => spawnSync(binary, ["--version"]).status === 0,
  );

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "flisk-completion-"));
    for (const shell of SUPPORTED_SHELLS) {
      writeFileSync(join(dir, `flisk.${shell}`), script(shell));
    }
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("parses under bash -n", () => {
    const result = spawnSync("bash", ["-n", join(dir, "flisk.bash")], { encoding: "utf-8" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it.skipIf(!hasZsh)("parses under zsh -n", () => {
    const result = spawnSync("zsh", ["-n", join(dir, "flisk.zsh")], { encoding: "utf-8" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it.skipIf(!hasFish)("parses under fish --no-execute", () => {
    const result = spawnSync("fish", ["--no-execute", join(dir, "flisk.fish")], {
      encoding: "utf-8",
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it.skipIf(!powershell)("loads under PowerShell", () => {
    const result = spawnSync(
      powershell as string,
      ["-NoProfile", "-File", join(dir, "flisk.powershell")],
      {
        encoding: "utf-8",
      },
    );
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});
