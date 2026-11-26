// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
// The remote downloads below must refuse a redirect to plain http (SonarCloud S6506): the curl that fetches each
// of them carries --proto '=https' --tlsv1.2.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const DOWNLOADS = [
  ["install.sh", '"$OFFICIAL_INSTALLER" -o "$installer_tmp"'],
  ["runtime/engine/assets/docker/wake-gateway/Dockerfile", "tilt-dev/tilt/releases/download"],
  [".github/workflows-disabled/publish-mcp-registry.yml", '"$base_url/$archive"'],
  [".github/workflows-disabled/publish-mcp-registry.yml", '"$base_url/$archive.sigstore.json"'],
  [".github/workflows-disabled/oss-score-gate.yml", "api.securityscorecards.dev"],
  [".github/workflows-disabled/byo-template-e2e.yml", "tilt-dev/tilt/releases/download"],
  [".github/workflows-disabled/e2e-resource-types.yml", "benchmarks-data/stack-timings/latest.json"],
];

for (const [file, marker] of DOWNLOADS) {
  test(`${file}: ${marker} is fetched over HTTPS only`, () => {
    const line = readFileSync(new URL(`../${file}`, import.meta.url), "utf8")
      .split("\n")
      .find((l) => /\bcurl\b/.test(l) && l.includes(marker));
    assert.ok(line, `${file}: no curl line for ${marker}`);
    assert.match(line, /--proto '=https'/);
    assert.match(line, /--tlsv1\.2/);
  });
}
