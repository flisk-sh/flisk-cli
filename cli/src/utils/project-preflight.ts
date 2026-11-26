// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { PACKAGE_JSON } from "./constants.js";
import { FliskError } from "./errors.js";

function jsonSyntaxLine(error: unknown, text: string): number {
  const position = (error as { position?: unknown } | null)?.position;
  if (typeof position === "number" && position >= 0) {
    return text.slice(0, position).split("\n").length;
  }
  const message = String(error);
  const reportedLine = message.match(/line (\d+)/i);
  if (reportedLine) return Number(reportedLine[1]);

  // Node 26 reports the offending token but no offset. Locate it after the first colon so a value
  // like `hi` on line 2 is not mistaken for the same text inside a key on line 1.
  const token =
    message.match(/Unexpected token '([^']+)'/)?.[1] ?? message.match(/Unexpected ([^\s,]+)/)?.[1];
  if (token) {
    const colon = text.indexOf(":");
    const offset = text.indexOf(token, Math.max(colon, 0));
    if (offset >= 0) return text.slice(0, offset).split("\n").length;
  }
  return text.trimEnd().split("\n").length;
}

/**
 * Check the destinations `flisk project` is about to write before it creates anything (#5419).
 * A broken user-owned manifest or a conflicting file must be a Flisk error, not a raw parse stack
 * followed by a "successful" half-written project.
 */
export function preflightProjectFolder(projectRoot: string): void {
  for (const name of [".flisk", "services"]) {
    const target = path.join(projectRoot, name);
    if (existsSync(target) && !statSync(target).isDirectory()) {
      throw new FliskError(
        `${name} exists but is not a directory; Flisk cannot create the project folders`,
        [`Move or remove the file named ${name}`, "Then run: flisk project --yes"],
      );
    }
  }

  const packageJsonPath = path.join(projectRoot, PACKAGE_JSON);
  if (existsSync(packageJsonPath)) {
    let text: string;
    try {
      text = readFileSync(packageJsonPath, "utf-8");
    } catch (error) {
      throw new FliskError(
        `Cannot read package.json: ${error instanceof Error ? error.message : String(error)}`,
        ["Fix the file's permissions and run: flisk project --yes"],
      );
    }
    try {
      JSON.parse(text);
    } catch (error) {
      throw new FliskError(
        `package.json is not valid JSON (line ${jsonSyntaxLine(error, text)}); Flisk did not add workspaces.`,
        ["Fix package.json", "Then run: flisk config regenerate"],
      );
    }
  }

  if (existsSync(projectRoot)) {
    try {
      accessSync(projectRoot, constants.W_OK);
    } catch {
      throw new FliskError(`Cannot write to the project directory: ${projectRoot}`, [
        "Fix the directory's permissions and run: flisk project --yes",
      ]);
    }
  }
}
