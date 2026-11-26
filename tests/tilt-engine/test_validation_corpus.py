# Copyright (c) 2026 Flisk Landscape contributors
# SPDX-License-Identifier: MIT
"""Service manifest corpus contract: every Starlark validator makes the decisions
tests/fixtures/service-manifest-corpus/decisions.json records (#4858).

One Tiltfile run evaluates each fixture manifest through:

- ``validate`` from runtime/discovery/validation.star
- ``validate_manifest`` from runtime/discovery/manifest/validation.star (the
  compatibility shim left over from the twin dedupe - it must decide identically)
- ``ManifestValidator`` from runtime/engine/topologies/tilt/manifest/validator.star
  (recorded only where it returns a verdict: it crashes on wrongly-typed fields)

It also exports ``SERVICE_MANIFEST_RULES`` from runtime/discovery/validation_rules.star
so the corpus pins the Starlark rule table itself. The TypeScript side of the same
corpus runs in cli/src/commands/__tests__/validation-corpus-contract.test.ts.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

pytestmark = [
    pytest.mark.generator,
    pytest.mark.skipif(shutil.which("tilt") is None, reason="tilt CLI not installed"),
]

REPO_ROOT = Path(__file__).resolve().parents[2]
CORPUS_DIR = REPO_ROOT / "tests" / "fixtures" / "service-manifest-corpus"
RESULT_MARKER = "Error in fail: RESULT"

# The engine validator indexes port/replicas/appName without a type guard, so it
# crashes on these fixtures instead of returning a verdict (see decisions.json notes).
def _engine_skip_names(decisions: dict) -> list[str]:
    return [
        name
        for name, fixture in decisions["fixtures"].items()
        if isinstance(fixture["expect"], dict) and "engine" not in fixture["expect"]
    ]


def _corpus_manifests(decisions: dict) -> dict:
    return {
        name: json.loads((CORPUS_DIR / fixture["manifest"]).read_text())
        for name, fixture in decisions["fixtures"].items()
    }


BODY = """
load('@DISCOVERY/validation.star', 'validate')
load('@DISCOVERY_MANIFEST/validation.star', 'validate_manifest')
load('@ENGINE_MANIFEST/validator.star', 'ManifestValidator')
load('@DISCOVERY/validation_rules.star', 'SERVICE_MANIFEST_RULES')

corpus = decode_json(@CORPUS@)
engine_skip = decode_json(@ENGINE_SKIP@)

decisions = {}
for name in sorted(corpus.keys()):
    m = corpus[name]
    entry = {
        'discovery': len(validate(m)) == 0,
        'discoveryManifest': len(validate_manifest(m)) == 0,
    }
    if name not in engine_skip:
        entry['engine'] = ManifestValidator.validate(m).valid
    decisions[name] = entry

rules = {
    'appName': {
        'minLength': SERVICE_MANIFEST_RULES.app_name_min_length,
        'maxLength': SERVICE_MANIFEST_RULES.app_name_max_length,
    },
    'appTypes': SERVICE_MANIFEST_RULES.valid_app_types,
    'portOptionalAppTypes': SERVICE_MANIFEST_RULES.port_optional_app_types,
    'port': {
        'standard': {
            'min': SERVICE_MANIFEST_RULES.standard_port_min,
            'max': SERVICE_MANIFEST_RULES.standard_port_max,
        },
        'bringYourOwn': {
            'min': SERVICE_MANIFEST_RULES.bring_your_own_port_min,
            'max': SERVICE_MANIFEST_RULES.bring_your_own_port_max,
        },
        'bands': SERVICE_MANIFEST_RULES.port_ranges,
    },
    'featuresEnabled': SERVICE_MANIFEST_RULES.valid_resource_features,
    'replicas': {
        'min': SERVICE_MANIFEST_RULES.replicas_min,
        'max': SERVICE_MANIFEST_RULES.replicas_max,
    },
}

RESULT = {'decisions': decisions, 'rules': rules}
"""


@pytest.fixture(scope="module")
def decisions_file() -> dict:
    return json.loads((CORPUS_DIR / "decisions.json").read_text())


@pytest.fixture(scope="module")
def result(tmp_path_factory, decisions_file) -> dict:
    corpus = _corpus_manifests(decisions_file)
    engine_skip = _engine_skip_names(decisions_file)
    root = tmp_path_factory.mktemp("validation-corpus")
    (root / ".flisk").mkdir()
    (root / ".flisk" / "project.json").write_text(json.dumps({"project": {"name": "starter"}}))

    body = (
        BODY.replace("@DISCOVERY_MANIFEST", (REPO_ROOT / "runtime" / "discovery" / "manifest").as_posix())
        .replace("@DISCOVERY", (REPO_ROOT / "runtime" / "discovery").as_posix())
        .replace("@ENGINE_MANIFEST", (REPO_ROOT / "runtime" / "engine" / "topologies" / "tilt" / "manifest").as_posix())
        .replace("@CORPUS@", json.dumps(json.dumps(corpus)))
        .replace("@ENGINE_SKIP@", json.dumps(json.dumps(engine_skip)))
    )
    tiltfile = root / "Tiltfile"
    tiltfile.write_text(body + "\nfail('RESULT' + encode_json(RESULT))\n")
    proc = subprocess.run(
        ["tilt", "alpha", "tiltfile-result", "-f", str(tiltfile)],
        capture_output=True,
        text=True,
        timeout=180,
        cwd=root,
        env={**os.environ, "FLISK_PROJECT_ROOT": str(root)},
    )
    output = proc.stdout + proc.stderr
    assert RESULT_MARKER in output, output[-3000:]
    return json.loads(output.split(RESULT_MARKER, 1)[1].strip())


def test_the_rule_table_matches_the_corpus(result, decisions_file):
    assert result["rules"] == decisions_file["rules"]


def test_every_fixture_makes_the_recorded_decision(result, decisions_file):
    mismatches = []
    for name, fixture in decisions_file["fixtures"].items():
        expected = fixture["expect"]
        if isinstance(expected, str):
            expected = {key: expected for key in decisions_file["implementations"]}
        actual = result["decisions"][name]
        for impl, verdict in expected.items():
            if impl == "note" or impl not in actual:
                continue
            got = "accept" if actual[impl] else "reject"
            if got != verdict:
                mismatches.append(f"{name}: {impl} {got}, expected {verdict}")
    assert mismatches == []


def test_the_two_discovery_entry_points_agree_on_everything(result, decisions_file):
    disagreements = [
        name
        for name, entry in result["decisions"].items()
        if entry["discovery"] != entry["discoveryManifest"]
    ]
    assert disagreements == []
