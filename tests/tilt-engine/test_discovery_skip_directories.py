# Copyright (c) 2026 Flisk Landscape contributors
# SPDX-License-Identifier: MIT
"""Tilt discovery skips build-output folders just like the CLI walk.

A service.json under target/, vendor/, venv/ etc. used to be loaded by Tilt
while the CLI walk (and therefore generator validation) ignored it. These
tests run the scanner through Tilt's interpreter so both the POSIX and the
portable filesystem paths are checked.
"""

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

pytestmark = pytest.mark.skipif(shutil.which("tilt") is None, reason="tilt CLI not installed")

DISCOVERY = Path(__file__).resolve().parents[2] / "runtime" / "discovery"

SKIP_NAMES = [
    "target", "vendor", "__pycache__", "venv", "env", "bin", "out", "obj",
    "node_modules", "dist", "build", "coverage",
]

BODY = """
load('@DISCOVERY/json_manifest_scanner.star', 'discover_json_manifests')
load('@DISCOVERY/skip_directories.star', 'filter_skipped_paths', 'SKIP_DIRECTORIES')
r = {
    'found': discover_json_manifests('.'),
    'filtered': filter_skipped_paths([
        'services/product/backend/api/service.json',
        'services/product/backend/target/debug/service.json',
        'vendor/billing/service.json',
        'services/product/target/worker/service.json',
    ]),
    'skip_names': SKIP_DIRECTORIES,
}
"""


def _write_config(project: Path, paths: list) -> None:
    (project / ".flisk" / ".flisk-out").mkdir(parents=True, exist_ok=True)
    (project / ".flisk" / "project.json").write_text(
        json.dumps({"project": {"name": "skip-test"}, "discovery": {"paths": paths}})
    )
    (project / ".flisk" / ".flisk-out" / "spec.master").write_text(
        "RESOURCE_PATTERNS = " + repr(paths).replace("'", '"') + "\n"
    )


def _manifest(project: Path, *parts: str) -> str:
    directory = project.joinpath(*parts)
    directory.mkdir(parents=True, exist_ok=True)
    manifest = directory / "service.json"
    manifest.write_text("{}")
    return "/".join(parts + ("service.json",))


def _run(project: Path, portable: bool) -> dict:
    tiltfile = project / "Tiltfile"
    tiltfile.write_text(
        BODY.replace("@DISCOVERY", str(DISCOVERY).replace("\\", "/"))
        + "\nfail('RESULT' + encode_json(r))\n"
    )
    child_env = dict(os.environ, FLISK_PROJECT_ROOT=str(project))
    child_env["FLISK_DISCOVERY_PORTABLE"] = "1" if portable else "0"
    completed = subprocess.run(
        ["tilt", "alpha", "tiltfile-result", "-f", str(tiltfile)],
        cwd=project,
        env=child_env,
        text=True,
        capture_output=True,
        timeout=180,
    )
    combined = completed.stdout + completed.stderr
    marker = "Error in fail: RESULT"
    assert marker in combined, combined[-3000:]
    return json.loads(combined.split(marker, 1)[1].strip())


def _relative(paths) -> list:
    return sorted(
        p.replace("\\", "/").removeprefix("./") for p in paths
    )


@pytest.mark.parametrize("portable", [False, True])
def test_default_skip_folders_are_not_discovered(tmp_path, portable):
    project = tmp_path / "proj"
    _write_config(project, ["services/*/*"])
    normal = _manifest(project, "services", "product", "backend", "api")
    for name in SKIP_NAMES:
        _manifest(project, name, "debug")
        _manifest(project, "services", "product", "backend", name, "debug")

    result = _run(project, portable)

    assert set(SKIP_NAMES).issubset(set(result["skip_names"]))
    assert _relative(result["found"]) == [normal]
    assert _relative(result["filtered"]) == [
        "services/product/backend/api/service.json"
    ]


@pytest.mark.parametrize("portable", [False, True])
def test_literal_discovery_paths_reopen_a_skipped_folder(tmp_path, portable):
    project = tmp_path / "proj"
    paths = [
        "services/*/*",
        "vendor/*",
        "services/product/target/*",
        "services/product/backend/target/*",
    ]
    _write_config(project, paths)
    normal = _manifest(project, "services", "product", "backend", "api")
    vendored = _manifest(project, "vendor", "billing")
    stack_target = _manifest(project, "services", "product", "target", "worker")
    service_target = _manifest(project, "services", "product", "backend", "target", "debug")
    # Inside an opted-in folder, another skipped folder is still skipped.
    _manifest(project, "vendor", "billing", "target", "debug")

    result = _run(project, portable)

    assert _relative(result["found"]) == sorted([normal, vendored, stack_target, service_target])
    assert _relative(result["filtered"]) == sorted([
        normal,
        vendored,
        stack_target,
        service_target,
    ])


@pytest.mark.parametrize("portable", [False, True])
def test_a_wildcard_does_not_reopen_a_skipped_folder(tmp_path, portable):
    project = tmp_path / "proj"
    _write_config(project, ["*/*"])
    normal = _manifest(project, "services", "product", "backend", "api")
    _manifest(project, "services", "product", "backend", "target", "debug")
    _manifest(project, "vendor", "billing")

    result = _run(project, portable)

    assert _relative(result["found"]) == [normal]
