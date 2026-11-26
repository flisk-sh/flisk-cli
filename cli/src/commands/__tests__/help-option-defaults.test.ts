// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import type { Command, Option } from "commander";
import { expect, it } from "vitest";
import { createProgram } from "../../program.js";

function collectCommands(root: Command): Command[] {
  return [root, ...root.commands.flatMap((sub) => collectCommands(sub))];
}

function commandPath(command: Command): string {
  const names: string[] = [];
  for (let current: Command | null = command; current; current = current.parent) {
    names.unshift(current.name());
  }
  return names.join(" ");
}

// Mirrors Commander's Help.optionDescription: a "(default: ...)" suffix is printed
// when the option takes a value, or is a boolean option with a boolean default.
function helpShowsDefault(option: Option): boolean {
  if (option.defaultValue === undefined) {
    return false;
  }
  return (
    option.required ||
    option.optional ||
    (option.isBoolean() && typeof option.defaultValue === "boolean")
  );
}

it("no option description repeats the '(default' that help output appends", () => {
  const offenders: string[] = [];
  for (const command of collectCommands(createProgram())) {
    for (const option of command.options) {
      if (helpShowsDefault(option) && /\(default/i.test(option.description)) {
        offenders.push(`${commandPath(command)} ${option.flags}`);
      }
    }
  }
  expect(offenders).toEqual([]);
});
