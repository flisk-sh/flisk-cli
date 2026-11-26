// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";

import * as facade from "../../services.js";
import * as discover from "../discover.js";
import * as metadata from "../metadata.js";
import * as stacks from "../stacks.js";
import * as warnings from "../warnings.js";

const EXPECTED_EXPORTS: Array<[Record<string, unknown>, string[]]> = [
  [
    discover as Record<string, unknown>,
    [
      "clearDiscoveryResultCache",
      "discoverResources",
      "discoverResourcesFromRoot",
      "discoverResourcesStrict",
      "discoverResourcesWithProblems",
      "discoverServiceManifestPaths",
      "InvalidServiceJsonError",
    ],
  ],
  [
    metadata as Record<string, unknown>,
    ["clearMetadataCache", "getResourceMetadata", "getStackMetadata"],
  ],
  [
    stacks as Record<string, unknown>,
    ["discoverStackNames", "discoverStacks", "getAllStacks", "getResourcesForStack", "stackExists"],
  ],
  [
    warnings as Record<string, unknown>,
    ["resetPrintedServiceWarnings", "skippedServiceFiles", "warnAboutSkippedFiles"],
  ],
];

describe("services.js facade", () => {
  it("re-exports exactly the names of the four concept modules", () => {
    const expected = EXPECTED_EXPORTS.flatMap(([, names]) => names).sort();
    expect(Object.keys(facade).sort()).toEqual(expected);
  });

  it("re-exports the same bindings as the concept modules", () => {
    const facadeRecord = facade as unknown as Record<string, unknown>;
    for (const [mod, names] of EXPECTED_EXPORTS) {
      for (const name of names) {
        expect(facadeRecord[name], name).toBe(mod[name]);
      }
    }
  });
});
