// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import * as fs from "node:fs";
import * as path from "node:path";

/** A minimal valid `.flisk/project.json` body for the config command's extracted modules. */
export const configProjectJson = (
  name = "config-modules",
  optionalInfra: Record<string, boolean> = {},
) => ({
  version: "1.0",
  project: { name, version: "1.0.0" },
  phases: Object.fromEntries(
    ["pre_alpha", "alpha", "beta", "out_of_scope"].map((phase) => [
      phase,
      { name: phase, description: "", enabledStacks: [] },
    ]),
  ),
  optional_infra: {
    monitoring: false,
    elk: false,
    debezium: false,
    golden_image: false,
    verdaccio: false,
    ...optionalInfra,
  },
  discovery: { paths: ["services/*/*"] },
});

/** Reads `.flisk/project.json` back from a temp project root. */
export const readProjectJson = (root: string) =>
  JSON.parse(fs.readFileSync(path.join(root, ".flisk", "project.json"), "utf-8")) as {
    optional_infra: Record<string, boolean>;
  };

/** Runs `fn` with `process.cwd()` inside `root` so `findProjectRoot` resolves the temp project. */
export async function inProject<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const before = process.cwd();
  process.chdir(root);
  try {
    return await fn();
  } finally {
    process.chdir(before);
  }
}
