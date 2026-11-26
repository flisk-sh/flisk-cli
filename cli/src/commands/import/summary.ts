// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** One line of the import coverage summary: a Compose feature that did not translate exactly. */
export interface CoverageFinding {
  /** The feature and what the importer did with it. */
  label: string;
  /** The anchor on docs/project/ADOPTER-COVERAGE.md naming the coverage row. */
  anchor: string;
}

/** The summary of what an import dropped, approximated or skipped by design. */
export interface ImportCoverage {
  dropped: CoverageFinding[];
  approximated: CoverageFinding[];
  byDesign: CoverageFinding[];
}

const COVERAGE_DOC = "docs/project/ADOPTER-COVERAGE.md";
const COVERAGE_DOC_URL = `https://github.com/flisk-sh/flisk/blob/main/${COVERAGE_DOC}`;
const TABLE_ANCHOR = "compose-features";

// The coverage rows a finding can link to by name; anything else links to the table itself.
const FEATURE_ANCHORS: ReadonlyArray<readonly [RegExp, string]> = [
  [/container_name/, "cov-container-name"],
  [/deploy\.resources\.reservations/, "cov-deploy-resources-reservations"],
  [/^restart not set for /, "cov-no-restart"],
  [/it is outside the project\b/, "cov-outside-project"],
];

/** The anchor for the coverage row a plan line belongs to. */
function anchorFor(text: string): string {
  return FEATURE_ANCHORS.find(([pattern]) => pattern.test(text))?.[1] ?? TABLE_ANCHOR;
}

// A feature Flisk kept approximately: it renamed, assigned, assumed or substituted something.
const APPROXIMATED: readonly RegExp[] = [
  /^renamed from /,
  /^port \d+ assigned:/,
  / is assumed:/,
  / keeps the Compose name,/,
  / is kept as Compose wrote it;/,
  / reads its path from /,
];

// A feature that was not carried over at all.
const DROPPED: readonly RegExp[] = [
  / is dropped:/,
  / is not carried over/,
  / is not translated/,
  /keys not translated:/,
  / not written:/,
  / is not written:/,
  /; not used\b/,
  /; not mounted\b/,
  / is not kept as /,
  / is not imported\b/,
  / not understood and ignored/,
];

type CoverageCategory = keyof ImportCoverage;

/**
 * Which bucket a plan line falls into, or null when it only informs. "By design" wins over
 * "dropped" for lines that describe a deliberate difference (an outside-the-project file is
 * skipped on purpose even though it is "not written"), matching the coverage table's status.
 */
function categoryOf(text: string): CoverageCategory | null {
  if (/^restart not set for /.test(text)) return "byDesign";
  if (/it is outside the project\b/.test(text)) return "byDesign";
  if (APPROXIMATED.some((pattern) => pattern.test(text))) return "approximated";
  if (DROPPED.some((pattern) => pattern.test(text))) return "dropped";
  return null;
}

const SERVICE_HEADER = /^ {2}(\S+)\s+\((?:service|job)\b/;
const NOTE_LINE = /^\s+note:\s+(\S.*)$/;
const REJECTED_LINE = /^ {2}not written: (.*?): (.*)$/;
const SKIPPED_HEADER = /^Skipped \/ not fully imported:\s*$/;
const SCAN_NOTES_HEADER = /^Scan notes:\s*$/;
// A skip line is "<indent><name> [<tag>]: <text>". The indented head and the tag are matched
// separately and the tag from the right: a ".*" between overlapping sets is what made the old
// single expression super-linear (typescript:S8786).
const SKIP_HEAD = /^ {2}\S/;
const SKIP_TAG = /\[[^\][]+\]:/g;
const READ_ONLY_LINE = /^Read only: (.+?)\. Lines below/m;

/**
 * Reads the importer's printed plan into the summary: the per-service `note:` lines and the
 * "Skipped / not fully imported:" lines, bucketed as dropped, approximated or by design. Scan
 * notes and purely informational lines (port publication, env hints) are left out.
 */
export function importCoverage(importerStdout: string): ImportCoverage {
  const coverage: ImportCoverage = { dropped: [], approximated: [], byDesign: [] };
  const seen = new Set<string>();
  const add = (category: CoverageCategory, label: string, anchor: string): void => {
    const key = `${category}|${label}`;
    if (seen.has(key)) return;
    seen.add(key);
    coverage[category].push({ label, anchor });
  };
  let service = "";
  let inSkips = false;
  for (const rawLine of importerStdout.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      inSkips = false;
      continue;
    }
    const header = SERVICE_HEADER.exec(line);
    if (header) {
      service = header[1];
      continue;
    }
    if (SKIPPED_HEADER.test(line)) {
      inSkips = true;
      continue;
    }
    if (SCAN_NOTES_HEADER.test(line)) {
      inSkips = false;
      continue;
    }
    const note = NOTE_LINE.exec(line);
    if (note) {
      const category = categoryOf(note[1]);
      if (category) {
        add(category, service ? `${service}: ${note[1]}` : note[1], anchorFor(note[1]));
      }
      continue;
    }
    const rejected = REJECTED_LINE.exec(line);
    if (rejected) {
      add("dropped", `service "${rejected[1]}" not written: ${rejected[2]}`, TABLE_ANCHOR);
      continue;
    }
    if (!inSkips || !SKIP_HEAD.test(line)) continue;
    // The tag the text belongs to is the last "[tag]:" on the line, which is what the greedy
    // ".*\[" the old expression used picked out as well.
    let tag: RegExpExecArray | null = null;
    for (const m of line.matchAll(SKIP_TAG)) {
      if (m.index > 2) tag = m;
    }
    if (!tag) continue;
    const text = line.slice(tag.index + tag[0].length).trimStart();
    const category = categoryOf(text);
    if (category) add(category, text, anchorFor(text));
  }
  return coverage;
}

/** The files the importer says it read, from the plan's "Read only: a, b." line. */
export function importedFiles(importerStdout: string): string[] {
  const match = READ_ONLY_LINE.exec(importerStdout);
  return match ? match[1].split(/,\s*/).map((file) => file.trim()) : [];
}

// A `networks:` key and the entries directly under it; deeper keys (aliases, addresses)
// belong to the entry, not to the list, so only the first indent level below is read.
const NETWORKS_LINE = /^(\s*)networks\s*:(.*)$/;
const NETWORK_ENTRY = /^\s*-\s*([A-Za-z0-9_.-]+)\s*$|^\s*([A-Za-z0-9_.-]+)\s*:/;

function stripYamlComment(line: string): string {
  if (/^\s*#/.test(line)) return "";
  // The comment starts at the first '#' directly behind whitespace; trimEnd drops the run of
  // whitespace in front of it, matching what the old \s+#.*$ replace did (typescript:S8786).
  const comment = line.search(/\s#/);
  return comment < 0 ? line : line.slice(0, comment).trimEnd();
}

/**
 * The custom networks a Compose file declares: children of the top-level `networks:` map and
 * the names a service `networks:` entry gives. `default` is Compose's own, so it never counts.
 * The importer collapses these to the one Flisk network without a note, so the summary reads
 * the file itself (#3108).
 */
export function customNetworkNames(composeText: string): string[] {
  const names = new Set<string>();
  const lines = composeText.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = stripYamlComment(lines[i]);
    const match = NETWORKS_LINE.exec(line);
    if (!match) continue;
    const inline = match[2].trim();
    if (inline.startsWith("[")) {
      for (const name of inline.replace(/[[\]]/g, "").split(",")) {
        if (name.trim()) names.add(name.trim());
      }
      continue;
    }
    if (inline && inline !== "{}") continue;
    const parentIndent = match[1].length;
    let entryIndent = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const child = stripYamlComment(lines[j]);
      if (!child.trim()) continue;
      const indent = child.length - child.trimStart().length;
      if (indent <= parentIndent) break;
      if (entryIndent === -1) entryIndent = indent;
      if (indent !== entryIndent) continue;
      const entry = NETWORK_ENTRY.exec(child);
      const name = entry?.[1] ?? entry?.[2];
      if (name) names.add(name);
    }
  }
  names.delete("default");
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** The `networks` approximation the importer leaves unreported, read from the Compose file. */
export function networksFinding(
  dir: string,
  files: string[],
  readFile: (path: string) => string | null = (path) =>
    existsSync(path) ? readFileSync(path, "utf-8") : null,
): CoverageFinding | null {
  for (const file of files) {
    const names = customNetworkNames(readFile(join(dir, file)) ?? "");
    if (names.length > 0) {
      return {
        label: `custom networks "${names.join('", "')}" run as the default Flisk network`,
        anchor: "cov-networks",
      };
    }
  }
  return null;
}

/**
 * The full summary: the plan's findings plus the `networks` approximation the importer does
 * not name. `dir` is the directory argument given to `flisk import`; without it (or when the
 * Compose files cannot be read) the summary reports the plan alone.
 */
export function importCoverageSummary(
  importerStdout: string,
  options: { dir?: string; readFile?: (path: string) => string | null } = {},
): ImportCoverage {
  const coverage = importCoverage(importerStdout);
  if (!options.dir) return coverage;
  const finding = networksFinding(options.dir, importedFiles(importerStdout), options.readFile);
  if (finding) coverage.approximated.unshift(finding);
  return coverage;
}

/**
 * The one block `flisk import` prints after the plan (#3108): each finding with the anchor of
 * its row in docs/project/ADOPTER-COVERAGE.md. Empty when nothing was dropped, approximated or
 * skipped by design.
 */
export function formatCoverageBlock(coverage: ImportCoverage): string {
  const groups: ReadonlyArray<readonly [CoverageCategory, string]> = [
    ["dropped", "dropped"],
    ["approximated", "approximated"],
    ["byDesign", "by design"],
  ];
  const lines: string[] = [];
  for (const [category, title] of groups) {
    const findings = coverage[category];
    if (findings.length === 0) continue;
    lines.push(`  ${title}:`);
    for (const finding of findings) {
      lines.push(`    - ${finding.label} (${COVERAGE_DOC}#${finding.anchor})`);
    }
  }
  if (lines.length === 0) return "";
  return [
    "Some Compose features did not translate exactly:",
    ...lines,
    `  coverage: ${COVERAGE_DOC_URL}#${TABLE_ANCHOR}`,
  ].join("\n");
}
