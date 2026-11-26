// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { argSpec, option, positional } from "../../spec-args.js";

/**
 * The stack family: stack topology (`stack_list`), the ingress URLs across stacks (`network_list`) and assigning
 * resources between stacks (`stack_assign`). Each tool's arguments are declared once in an argSpec table bound to the
 * command's generated spec.
 */

/** The `stack_list` tool's arguments, bound to the `flisk stacks` spec. */
export const stackListArgs = argSpec(
  ["stacks"],
  [
    "--json",
    option("--services", { description: "Include the service names in each stack" }),
    option("--verbose", { description: "Include each stack's description" }),
  ],
);

/** `flisk stacks [--services] [--verbose] --json`. */
export function buildStackListArgs(args: Record<string, unknown>): string[] {
  return stackListArgs.build(args);
}

/** The `network_list` tool's arguments, bound to the `flisk networks` spec. */
export const networkListArgs = argSpec(
  ["networks"],
  ["--json", option("--stack", { as: "name", description: "Only this stack" })],
);

/** `flisk networks [--stack=<stack>] --json`. */
export function buildNetworkListArgs(args: Record<string, unknown>): string[] {
  return networkListArgs.build(args);
}

/** The `stack_assign` tool's arguments, bound to the `flisk stack` spec. */
export const stackAssignArgs = argSpec(
  ["stack"],
  [
    positional("stack-name", {
      arg: "stack",
      required: true,
      suggestions: ["Pass the kebab-case stack to assign them to"],
      description: "Stack name (kebab-case)",
    }),
    option("--move", {
      description: "Move resources that are already in another stack instead of refusing them",
    }),
    option("--resources", {
      required: true,
      requiredMessage: "resources must name at least one resource",
      minItems: 1,
      suggestions: ["resource_list shows each resource's stack; pass the names without one"],
      description: "Names of the resources to assign",
    }),
    "--json",
  ],
);

/** `flisk stack <stack> --resources=<name>... --json`: one `--resources=` per name so a value is never a flag. */
export function buildStackAssignArgs(args: Record<string, unknown>): string[] {
  return stackAssignArgs.build(args);
}
