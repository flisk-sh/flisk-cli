// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import fs from "node:fs";
import path from "node:path";
import { TILTFILE_IMPORTER } from "./invocation.js";

/**
 * The root Compose file names the importer reads. When one is present the importer reads it alone,
 * so a sibling Procfile is silently dropped (flisk-sh/flisk#5033).
 */
const COMPOSE_FILE_NAMES = [
  "compose.yaml",
  "compose.yml",
  "docker-compose.yaml",
  "docker-compose.yml",
];

/** A file the importer leaves alone even though it declares runnable processes. */
export interface SkippedImportSource {
  /** The file name in the import directory, for example `Procfile` or `Procfile.dev`. */
  file: string;
  /** The process names it declares, in file order (`web`, `worker`, ...). */
  processes: string[];
}

/** The directory the importer reads, or null when the forwarded run is a `tiltfile` import. */
export function importTargetDir(forwardedArgs: string[]): string | null {
  if (forwardedArgs[0] === TILTFILE_IMPORTER) return null;
  return forwardedArgs.find((arg) => !arg.startsWith("-")) ?? ".";
}

function isProcfileName(name: string): boolean {
  return name === "Procfile" || name.startsWith("Procfile.");
}

/** Process names declared in a Procfile: `web: node server.js` yields `web`. Comments and blanks are skipped. */
function procfileProcesses(filePath: string): string[] {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }
  const processes: string[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const colon = trimmed.indexOf(":");
    if (colon <= 0) continue;
    const name = trimmed.slice(0, colon).trim();
    if (name !== "") processes.push(name);
  }
  return processes;
}

/**
 * The Procfiles sitting next to the root Compose file in `dir`. The importer reads the Compose file
 * and leaves these untouched, so the caller reports them as skipped instead of dropping them silently.
 */
export function findSkippedProcfiles(dir: string): SkippedImportSource[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const fileNames = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  if (!fileNames.some((name) => COMPOSE_FILE_NAMES.includes(name))) return [];
  return fileNames
    .filter(isProcfileName)
    .sort((a, b) => a.localeCompare(b))
    .map((file) => ({ file, processes: procfileProcesses(path.join(dir, file)) }));
}

/** The skipped sibling sources for a forwarded import run; always [] for a `tiltfile` import. */
export function skippedImportSources(forwardedArgs: string[]): SkippedImportSource[] {
  const dir = importTargetDir(forwardedArgs);
  return dir === null ? [] : findSkippedProcfiles(dir);
}

/**
 * The "Skipped / not fully imported" block the CLI adds when `flisk import` leaves sibling Procfiles
 * alone, so the user sees their processes did not move and how to bring each in by hand.
 */
export function skippedSourcesNotice(skipped: SkippedImportSource[]): string {
  const lines = skipped.map((source) => {
    const processes = source.processes.length > 0 ? ` (${source.processes.join(", ")})` : "";
    return `  ${source.file}${processes}: not imported; flisk import reads only the root Compose file`;
  });
  return [
    "Skipped / not fully imported:",
    ...lines,
    "  -> Add each process with `flisk resource <name> --type bring-your-own` (or the flisk-import-procfile skill)",
  ].join("\n");
}
