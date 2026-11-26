// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { argSpec, option } from "../../spec-args.js";
/** The `down` tool's arguments, bound to the `flisk down` spec. */
export const downArgs = argSpec(["down"], ["--json", option("--dry-run", { arg: "dryRun" })]);
/** `flisk down [--dry-run] --json`. */
export function buildDownArgs(args) {
    return downArgs.build(args);
}
