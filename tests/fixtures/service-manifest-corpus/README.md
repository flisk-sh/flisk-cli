# service.json validation corpus

One directory of fixture `service.json` manifests plus `decisions.json`, the
accept/reject decision every validator must make for each. This is the contract
that replaced the "five validators kept in sync by hand" problem
(flisk-sh/flisk#4858).

## Layout

- `manifests/` — fixture manifests: valid shapes, each invalid field, and the
  port boundaries the issue calls out (2999/3000/9999/10000 for the standard
  band, 80/65535/65536 for `bring-your-own`).
- `decisions.json` — for every fixture, the expected decision per
  implementation, and `rules`: the rule table pinned across languages.

## Implementations under contract

| Key | Implementation | Decision |
| --- | --- | --- |
| `discovery` | `runtime/discovery/validation.star` `validate()` | `issues == []` |
| `discoveryManifest` | `runtime/discovery/manifest/validation.star` `validate_manifest()` (compatibility shim over the same validator) | `issues == []` |
| `engine` | `runtime/engine/topologies/tilt/manifest/validator.star` `ManifestValidator.validate()` | `.valid` |
| `schema` | `runtime/engine/schemas/service-schema.json` | Ajv `validate()` |
| `cli` | `cli/src/utils/service-manifest.ts` `validateServiceManifest()` | `errors.length === 0` |

`"expect": "accept"` is shorthand for the same decision in every implementation
that has a recorded verdict. `"expect"` as an object pins each implementation
separately and explains the split in `note` — those fixtures are the
documented drift this corpus exists to expose. `engine` is absent where the
engine validator crashes on a wrongly-typed field instead of returning a
verdict (it indexes `port`/`replicas`/`appName` without a type guard).

## Runners

- `tests/tilt-engine/test_validation_corpus.py` — runs the two Starlark
  validators and the engine validator under `tilt alpha tiltfile-result` and
  compares every decision plus the Starlark rule table
  (`runtime/discovery/validation_rules.star`). Skipped without `tilt` unless
  `FLISK_REQUIRE_TILT=1`.
- `cli/src/commands/__tests__/validation-corpus-contract.test.ts` — runs
  `validateServiceManifest` and the JSON schema over the same corpus in Vitest,
  pins the TypeScript rule table
  (`cli/src/utils/service-manifest-rules.ts`) to `decisions.json.rules`, and
  when Tilt is available asserts the Starlark decisions too.

## Changing a rule

1. Change the named source (`runtime/discovery/validation_rules.star`,
   `cli/src/utils/service-manifest-rules.ts`, or the schema).
2. Update `decisions.json` — the `rules` table and any fixture expectation
   whose decision the rule now flips.
3. Both runners must stay green. A red corpus means the implementations
   drifted again: fix the implementation, not the corpus.
