// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import { evaluateStarlark, tiltAvailable } from "../../test-support/starlark.js";
import { RESOURCE_CONFIG_APP_TYPES } from "../../types/index.js";
import { validateServiceManifest } from "../../utils/service-manifest.js";
import {
  ALLOCATION_PORT_BANDS,
  PORT_RANGES,
  SERVICE_MANIFEST_RULES,
  VALID_APP_TYPES,
} from "../../utils/service-manifest-rules.js";

// The TypeScript side of the service-manifest corpus contract (#4858): every fixture in
// tests/fixtures/service-manifest-corpus is validated by the CLI's validateServiceManifest and by the
// JSON schema, and decisions.json records the accept/reject verdict each implementation must give -
// including where the implementations legitimately disagree (each split has a "note"). The Starlark
// side (the two discovery validators and the engine validator, plus the Starlark rule table) runs in
// tests/tilt-engine/test_validation_corpus.py, and this suite also asserts it end-to-end when Tilt is
// installed.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const corpusDir = join(repoRoot, "tests", "fixtures", "service-manifest-corpus");

interface DecisionFile {
  implementations: Record<string, string>;
  rules: {
    appName: { minLength: number; maxLength: number };
    appTypes: string[];
    portOptionalAppTypes: string[];
    port: {
      standard: { min: number; max: number };
      bringYourOwn: { min: number; max: number };
      bands: Record<string, { min: number; max: number }>;
    };
    featuresEnabled: string[];
    replicas: { min: number; max: number };
  };
  fixtures: Record<
    string,
    { manifest: string; expect: string | (Record<string, string> & { note?: string }) }
  >;
}

const corpus = JSON.parse(readFileSync(join(corpusDir, "decisions.json"), "utf-8")) as DecisionFile;

const fixtures = Object.entries(corpus.fixtures).map(([name, fixture]) => ({
  name,
  fixture,
  manifest: JSON.parse(readFileSync(join(corpusDir, fixture.manifest), "utf-8")) as Record<
    string,
    unknown
  >,
}));

/** The expected verdict for one implementation: "accept" | "reject" | undefined when unrecorded. */
function expectedVerdict(
  expect: DecisionFile["fixtures"][string]["expect"],
  impl: string,
): string | undefined {
  if (typeof expect === "string") return expect;
  return expect[impl];
}

const schema = JSON.parse(
  readFileSync(join(repoRoot, "runtime", "engine", "schemas", "service-schema.json"), "utf-8"),
);
const validateService = new Ajv({ strict: false }).compile(schema);

describe("the TypeScript rule table", () => {
  it("mirrors the corpus rule table exactly", () => {
    expect(SERVICE_MANIFEST_RULES.appName).toEqual(corpus.rules.appName);
    expect([...SERVICE_MANIFEST_RULES.appTypes]).toEqual(corpus.rules.appTypes);
    expect([...SERVICE_MANIFEST_RULES.portOptionalAppTypes]).toEqual(
      corpus.rules.portOptionalAppTypes,
    );
    expect(SERVICE_MANIFEST_RULES.port.standard).toEqual(corpus.rules.port.standard);
    expect(SERVICE_MANIFEST_RULES.port.bringYourOwn).toEqual(corpus.rules.port.bringYourOwn);
    expect(SERVICE_MANIFEST_RULES.port.bands).toEqual(corpus.rules.port.bands);
    expect([...SERVICE_MANIFEST_RULES.featuresEnabled]).toEqual(corpus.rules.featuresEnabled);
    expect(SERVICE_MANIFEST_RULES.replicas).toEqual(corpus.rules.replicas);
  });

  it("covers the schema's appType enum plus the internal infra type", () => {
    expect([...VALID_APP_TYPES]).toEqual(
      expect.arrayContaining([...schema.properties.appType.enum, "infra"]),
    );
    expect(VALID_APP_TYPES).toHaveLength(schema.properties.appType.enum.length + 1);
    // The CLI's own resource-config enum is the same set minus "infra".
    expect(VALID_APP_TYPES.filter((type) => type !== "infra")).toEqual(
      expect.arrayContaining([...RESOURCE_CONFIG_APP_TYPES]),
    );
    expect(RESOURCE_CONFIG_APP_TYPES).toHaveLength(VALID_APP_TYPES.length - 1);
  });

  it("keeps every allocation band inside the matching validation band", () => {
    // The bands flisk resource allocates from are a (necessarily narrower) projection of the
    // bands validators accept - an allocated port must never fail validation.
    for (const [type, allocation] of Object.entries(ALLOCATION_PORT_BANDS)) {
      const band = (PORT_RANGES as Record<string, { min: number; max: number }>)[type];
      if (band === undefined) continue;
      expect(allocation.min, `${type} allocation floor`).toBeGreaterThanOrEqual(band.min);
      expect(allocation.max, `${type} allocation ceiling`).toBeLessThanOrEqual(band.max);
    }
  });
});

describe("service-manifest corpus contract", () => {
  for (const { name, fixture, manifest } of fixtures) {
    it(`${name}: the CLI and the schema make the recorded decisions`, () => {
      const cliAccepted = validateServiceManifest(manifest, fixture.manifest).errors.length === 0;
      const schemaAccepted = validateService(manifest) === true;
      expect(cliAccepted, `cli (${expectedVerdict(fixture["expect"], "cli")})`).toBe(
        expectedVerdict(fixture["expect"], "cli") === "accept",
      );
      expect(schemaAccepted, `schema (${expectedVerdict(fixture["expect"], "schema")})`).toBe(
        expectedVerdict(fixture["expect"], "schema") === "accept",
      );
    });
  }

  it("records a decision for every implementation the corpus names, or explains the gap", () => {
    for (const { name, fixture } of fixtures) {
      if (typeof fixture["expect"] === "string") continue;
      for (const impl of ["discovery", "discoveryManifest", "schema", "cli"]) {
        expect(fixture["expect"][impl], `${name} must record a ${impl} decision`).toMatch(
          /^(accept|reject)$/,
        );
      }
      // engine is allowed to be absent (it crashes on wrongly-typed fields); if a fixture drops any
      // implementation it must carry a note explaining why.
      for (const impl of ["engine"]) {
        if (fixture["expect"][impl] === undefined) {
          expect(
            fixture["expect"].note,
            `${name} needs a note for the missing ${impl}`,
          ).toBeTruthy();
        }
      }
    }
  });
});

const hasTilt = tiltAvailable();
const discoveryDir = join(repoRoot, "runtime", "discovery");
const manifestDir = join(discoveryDir, "manifest");
const engineManifestDir = join(repoRoot, "runtime", "engine", "topologies", "tilt", "manifest");

/** Fixture names where the corpus records no engine verdict (it crashes on wrongly-typed fields). */
const engineSkip = fixtures
  .filter(({ fixture }) => expectedVerdict(fixture["expect"], "engine") === undefined)
  .map(({ name }) => name);

const corpusJson = Object.fromEntries(fixtures.map(({ name, manifest }) => [name, manifest]));

// One Tiltfile evaluates every fixture through both discovery validators and the engine validator,
// and exports the Starlark rule table - the same shape the pytest runner in
// tests/tilt-engine/test_validation_corpus.py uses.
const tiltfileBody = `
load(${JSON.stringify(join(discoveryDir, "validation.star"))}, "validate")
load(${JSON.stringify(join(manifestDir, "validation.star"))}, "validate_manifest")
load(${JSON.stringify(join(engineManifestDir, "validator.star"))}, "ManifestValidator")
load(${JSON.stringify(join(discoveryDir, "validation_rules.star"))}, "SERVICE_MANIFEST_RULES")

corpus = decode_json(${JSON.stringify(JSON.stringify(corpusJson))})
engine_skip = decode_json(${JSON.stringify(JSON.stringify(engineSkip))})

decisions = {}
for name in sorted(corpus.keys()):
    m = corpus[name]
    entry = {
        "discovery": len(validate(m)) == 0,
        "discoveryManifest": len(validate_manifest(m)) == 0,
    }
    if name not in engine_skip:
        entry["engine"] = ManifestValidator.validate(m).valid
    decisions[name] = entry

rules = {
    "appName": {
        "minLength": SERVICE_MANIFEST_RULES.app_name_min_length,
        "maxLength": SERVICE_MANIFEST_RULES.app_name_max_length,
    },
    "appTypes": SERVICE_MANIFEST_RULES.valid_app_types,
    "portOptionalAppTypes": SERVICE_MANIFEST_RULES.port_optional_app_types,
    "port": {
        "standard": {
            "min": SERVICE_MANIFEST_RULES.standard_port_min,
            "max": SERVICE_MANIFEST_RULES.standard_port_max,
        },
        "bringYourOwn": {
            "min": SERVICE_MANIFEST_RULES.bring_your_own_port_min,
            "max": SERVICE_MANIFEST_RULES.bring_your_own_port_max,
        },
        "bands": SERVICE_MANIFEST_RULES.port_ranges,
    },
    "featuresEnabled": SERVICE_MANIFEST_RULES.valid_resource_features,
    "replicas": {
        "min": SERVICE_MANIFEST_RULES.replicas_min,
        "max": SERVICE_MANIFEST_RULES.replicas_max,
    },
}

RESULT = {"decisions": decisions, "rules": rules}
`;

describe.skipIf(!hasTilt)("service-manifest corpus contract under Tilt", () => {
  function runCorpus(): {
    decisions: Record<string, Record<string, boolean>>;
    rules: DecisionFile["rules"];
  } {
    const file = join(discoveryDir, "validation.star");
    const result = evaluateStarlark(file, {
      args: `${tiltfileBody}\nlocal('cat > out.json', quiet = True, stdin = encode_json(RESULT))\n`,
    });
    if (result.status !== 0) throw new Error(`tilt failed: ${result.stderr || result.stdout}`);
    return JSON.parse(readFileSync(join(result.dir, "out.json"), "utf-8"));
  }

  it("matches the corpus decisions for the discovery validators and the engine", () => {
    const { decisions, rules } = runCorpus();
    for (const { name, fixture } of fixtures) {
      const expected = fixture["expect"];
      for (const impl of ["discovery", "discoveryManifest", "engine"] as const) {
        const verdict = expectedVerdict(expected, impl);
        if (verdict === undefined) continue;
        expect(decisions[name]?.[impl], `${name}: ${impl}`).toBe(verdict === "accept");
      }
      // The deduplicated twins must decide identically on every fixture.
      expect(decisions[name]?.discovery, `${name}: twins agree`).toBe(
        decisions[name]?.discoveryManifest,
      );
    }
    expect(rules).toEqual(corpus.rules);
  });

  it("keeps the Starlark and TypeScript rule tables identical", () => {
    const { rules } = runCorpus();
    expect(rules).toEqual({
      appName: SERVICE_MANIFEST_RULES.appName,
      appTypes: [...SERVICE_MANIFEST_RULES.appTypes],
      portOptionalAppTypes: [...SERVICE_MANIFEST_RULES.portOptionalAppTypes],
      port: {
        standard: SERVICE_MANIFEST_RULES.port.standard,
        bringYourOwn: SERVICE_MANIFEST_RULES.port.bringYourOwn,
        bands: SERVICE_MANIFEST_RULES.port.bands,
      },
      featuresEnabled: [...SERVICE_MANIFEST_RULES.featuresEnabled],
      replicas: SERVICE_MANIFEST_RULES.replicas,
    });
  });
});
