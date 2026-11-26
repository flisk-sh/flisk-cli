# Copyright (c) 2026 Flisk Landscape contributors
# SPDX-License-Identifier: MIT
"""Environment validation must require real variables, not Docker-only Verdaccio keys (#3711).

A local project that did not opt into Verdaccio has no VERDACCIO_URL_DOCKER in its
.env, so the pre-flight validator must not fail it. Manifest-declared variables and
TILT_ENV are still enforced, and an opted-in Verdaccio project still needs its URL.
"""

from __future__ import annotations

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
VALIDATORS_STAR = (
    REPO_ROOT
    / "runtime"
    / "engine"
    / "topologies"
    / "tilt"
    / "generators"
    / "validators.star"
)

TILTFILE = """load('{validators}', 'run_all_validations', 'validate_environment_variables', 'generate_env_validation_report')

manifest = {{'appName': 'demo', 'requiredEnvVars': ['FLISK_TEST_REQUIRED']}}
base_required = ['FLISK_TEST_BASE', 'FLISK_TEST_PRESENT']

result = validate_environment_variables('{resource}', manifest, base_required)
print('MISSING=' + str(sorted(result.missing_vars)))

report = generate_env_validation_report('{resource}', manifest, base_required)
print('ENV_STATUS=' + report['status'])
print('ENV_MISSING=' + str(sorted(report['missing_variables'])))

plain = {{'appName': 'demo'}}
global_free = {{'verdaccio_enabled': False, 'verdaccio_url_local': 'http://localhost:4873', 'database': {{}}}}
global_paid = {{'verdaccio_enabled': True, 'verdaccio_url_local': 'http://localhost:4873', 'database': {{}}}}
free = run_all_validations('{resource}', plain, [], global_free)
paid = run_all_validations('{resource}', plain, [], global_paid)
print('FREE_STATUS=' + free['reports']['environment']['status'])
print('PAID_MISSING=' + str(sorted(paid['reports']['environment'].get('missing_variables', []))))
fail('DONE')
"""


def _run_validation(tmp_path: Path) -> str:
    resource = tmp_path / "services" / "product" / "demo"
    resource.mkdir(parents=True)

    tiltfile = tmp_path / "Tiltfile"
    tiltfile.write_text(
        TILTFILE.format(
            validators=VALIDATORS_STAR.as_posix(), resource=resource.as_posix()
        ),
        encoding="utf-8",
    )

    env = dict(os.environ)
    env.update(
        FLISK_PROJECT_ROOT=str(tmp_path),
        TILT_ENV="dev",
        FLISK_TEST_PRESENT="1",
    )
    for key in ("FLISK_TEST_BASE", "FLISK_TEST_REQUIRED", "VERDACCIO_URL_DOCKER"):
        env.pop(key, None)

    result = subprocess.run(
        ["tilt", "alpha", "tiltfile-result", "-f", str(tiltfile)],
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=180,
        cwd=tmp_path,
        env=env,
    )
    return result.stdout + result.stderr


def test_required_variables_are_reported_but_verdaccio_is_opt_in(
    tmp_path: Path,
) -> None:
    output = _run_validation(tmp_path)

    # Both a required-var entry and a manifest-declared var are still reported; a set var is not.
    assert 'MISSING=["FLISK_TEST_BASE", "FLISK_TEST_REQUIRED"]' in output, output[
        -3000:
    ]
    assert "ENV_STATUS=FAILED" in output, output[-3000:]
    assert 'ENV_MISSING=["FLISK_TEST_BASE", "FLISK_TEST_REQUIRED"]' in output, output[
        -3000:
    ]

    # A local project without the paid loader passes; an opted-in project still needs the URL.
    assert "FREE_STATUS=PASSED" in output, output[-3000:]
    assert 'PAID_MISSING=["VERDACCIO_URL_DOCKER"]' in output, output[-3000:]
