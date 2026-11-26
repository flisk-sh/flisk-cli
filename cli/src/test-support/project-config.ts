// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProjectConfig } from "../types/index.js";

const phase = (enabledStacks: string[] = []) => ({
  name: "phase",
  description: "phase",
  enabledStacks,
});

export function projectConfig(
  preAlpha: string[],
  assigned: Partial<Record<"alpha" | "beta" | "out_of_scope", string[]>> = {},
): ProjectConfig {
  return {
    version: "1.0",
    project: { name: "fixture", version: "1.0.0" },
    phases: {
      pre_alpha: phase(preAlpha),
      alpha: phase(assigned.alpha),
      beta: phase(assigned.beta),
      out_of_scope: phase(assigned.out_of_scope),
    },
    optional_infra: {
      monitoring: false,
      elk: false,
      debezium: false,
      golden_image: true,
      verdaccio: false,
    },
    discovery: { paths: ["services/*/*"] },
    overrides: {},
  };
}

export const projectJsonPath = (root: string) => join(root, ".flisk", "project.json");

export const readProjectConfig = (root: string) =>
  JSON.parse(readFileSync(projectJsonPath(root), "utf-8")) as ProjectConfig;

export function writeProjectConfig(root: string, config: ProjectConfig): string {
  mkdirSync(join(root, ".flisk"), { recursive: true });
  const content = `${JSON.stringify(config, null, 2)}\n`;
  writeFileSync(projectJsonPath(root), content);
  return content;
}
/** The optional-infra defaults shared by command test fixtures. */
export const ALL_OPTIONAL_INFRA_DISABLED = {
  monitoring: false,
  elk: false,
  debezium: false,
  golden_image: false,
  verdaccio: false,
} as const;

/** The phase map shared by command test fixtures. */
export const BASE_PHASES = Object.fromEntries(
  ["pre_alpha", "alpha", "beta", "out_of_scope"].map((name) => [
    name,
    { name, description: "", enabledStacks: [] },
  ]),
);

/** The discovery glob shared by command test fixtures. */
export const SERVICES_DISCOVERY_PATHS = ["services/**"] as const;
