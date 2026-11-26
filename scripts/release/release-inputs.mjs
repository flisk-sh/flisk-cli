// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
// The single source of truth for release input paths (#3095): the list lives in .github/release-inputs.txt.
//   - the "changes" job of release-binaries.yml turns it into the dorny/paths-filter rules with --emit-filters;
//   - the publish gate (scripts/check-release-candidate.mjs) matches changed files against it (releaseInputFor).
//   node scripts/release/release-inputs.mjs --emit-filters
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const RELEASE_INPUTS_FILE = new URL("../../.github/release-inputs.txt", import.meta.url);

// One pattern per line; whitespace is trimmed and blank lines and "#" comments are ignored.
export const parseReleaseInputs = (text) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));

export const RELEASE_INPUTS = parseReleaseInputs(readFileSync(RELEASE_INPUTS_FILE, "utf8"));

// Only two forms appear in RELEASE_INPUTS: an exact path, or a directory followed by "/**". Anything else is a bug in
// the list, so it throws rather than being guessed at.
export const matchesInput = (glob, file) => {
  if (glob.endsWith("/**")) {
    return file.startsWith(glob.slice(0, -2));
  }
  if (glob.includes("*")) {
    throw new Error(`unsupported release input pattern: ${glob}`);
  }
  return file === glob;
};

// The release input a changed path falls under, or undefined when the path cannot change the shipped package.
export const releaseInputFor = (file) => RELEASE_INPUTS.find((glob) => matchesInput(glob, file));

// The `release` filter in dorny/paths-filter's YAML format, the same shape the changes job used to keep inline.
export const releaseFiltersYaml = () => {
  for (const pattern of RELEASE_INPUTS) {
    if (pattern.includes('"')) {
      throw new Error(`release input pattern cannot contain a double quote: ${pattern}`);
    }
  }
  return `release:\n${RELEASE_INPUTS.map((pattern) => `  - "${pattern}"`).join("\n")}\n`;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== "--emit-filters") {
    console.error("usage: release-inputs.mjs --emit-filters");
    process.exit(2);
  }
  process.stdout.write(releaseFiltersYaml());
}
