# Copyright (c) 2026 Flisk Landscape contributors
# SPDX-License-Identifier: MIT
"""
The golden-layers "up to date" check asks Docker once for all golden images (flisk#3855).

`golden-layers-build` is the first image resource of every `flisk up`: it used to run one
`docker image inspect` per image (8 calls, about 0.4 s on a VM-backed engine) to learn that
nothing needs building. The check now passes every image to a single inspect, which prints
the hash label once per existing image and exits non-zero when any is missing; a stale or
missing image must still fall through to the reuse, pull and build path. The generated
command is run with `sh -c` against a fake `docker` placed first on PATH, so no real Docker
is needed.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
from pathlib import Path

import pytest

from test_dependson_platform_postgres import TILT_REQUIRED

pytestmark = [pytest.mark.generator]

REPO_ROOT = Path(__file__).resolve().parents[2]
GOLDEN_BUILD = REPO_ROOT / "runtime/engine/topologies/platform/docker/build/golden_image_build.star"
WINDOWS_SCRIPTS = REPO_ROOT / "runtime/engine/topologies/tilt/common/windows_scripts.star"
DOCKERFILE_REL = ".flisk/.flisk-out/golden-layers.Dockerfile"

LAYER_KEYS = [
    "l1", "l2", "l3-backend", "l3-backend-prisma", "l3-frontend",
    "l4-backend", "l4-backend-node", "l4-frontend", "l4-migrator",
]
IMAGES = [f"proj-{key}:latest" for key in LAYER_KEYS]
LABEL_FMT = '{{index .Config.Labels "flisk.golden.hash"}}'
FRESH_CALL = ["image", "inspect", "-f", LABEL_FMT, *IMAGES]

# State model: FAKE_DOCKER_DIR/<keyed name> holds the image's flisk.golden.hash label;
# no file means no such image. `build` creates a state file per -t tag with the --label value.
FAKE_DOCKER_PY = """import json
import os
import sys

args = sys.argv[1:]
with open(os.environ['FAKE_DOCKER_LOG'], 'a', encoding='utf-8') as log:
    log.write(json.dumps(args) + '\\n')


def key(name):
    return name.replace('/', '_').replace(':', '_')


def label_of(name):
    path = os.path.join(os.environ['FAKE_DOCKER_DIR'], key(name))
    if not os.path.exists(path):
        return None
    with open(path, encoding='utf-8') as handle:
        return handle.read().strip()


if args[:2] == ['image', 'inspect']:
    fmt = ''
    names = []
    index = 2
    while index < len(args):
        if args[index] == '-f':
            index += 1
            fmt = args[index]
        else:
            names.append(args[index])
        index += 1
    missing = [name for name in names if label_of(name) is None]
    if missing:
        print('Error response from daemon: no such image ' + missing[0], file=sys.stderr)
        sys.exit(1)
    for name in names:
        label = label_of(name)
        print((label or '<no value>') if 'Labels' in fmt else 'sha256:' + key(name)[:32])
    sys.exit(0)

if args[:2] == ['image', 'rm']:
    path = os.path.join(os.environ['FAKE_DOCKER_DIR'], key(args[2] if len(args) > 2 else ''))
    if os.path.exists(path):
        os.remove(path)
        sys.exit(0)
    sys.exit(1)

if args[:2] in (['image', 'ls'], ['image', 'prune']):
    sys.exit(0)

if args and args[0] == 'pull':
    sys.exit(1)  # the test machine is offline for the registry

if args and args[0] == 'tag':
    sys.exit(0)

if args and args[0] == 'build':
    label = ''
    tags = []
    index = 0
    while index < len(args):
        if args[index] == '--label':
            index += 1
            label = args[index].split('=', 1)[1]
        elif args[index] == '-t':
            index += 1
            tags.append(args[index])
        index += 1
    for tag in tags:
        with open(os.path.join(os.environ['FAKE_DOCKER_DIR'], key(tag)), 'w', encoding='utf-8') as handle:
            handle.write(label)
    sys.exit(0)

sys.exit(0)
"""

FAKE_DOCKER = """#!/bin/sh
exec python "$(dirname "$0")/docker.py" "$@"
"""

# Tilt chooses powershell on native Windows, where PATHEXT resolution needs .cmd.
FAKE_DOCKER_CMD = '@echo off\r\npython "%~dp0docker.py" %*\r\n'


def _spec(tmp_path: Path):
    """Register golden-layers-build for project 'proj' and return (its UpdateCmdSpec, project dir)."""
    project = tmp_path / "proj"
    out_dir = project / ".flisk" / ".flisk-out"
    out_dir.mkdir(parents=True)
    (project / ".flisk" / "project.json").write_text(json.dumps({"project": {"name": "proj"}}))
    (out_dir / "golden-layers.Dockerfile").write_text("FROM scratch\n")
    (project / "Tiltfile").write_text(
        f"load('{GOLDEN_BUILD.as_posix()}', 'build_golden_layers')\n"
        "build_golden_layers()\n"
    )
    proc = subprocess.run(
        ["tilt", "alpha", "tiltfile-result", "-f", str(project / "Tiltfile")],
        capture_output=True, text=True, timeout=180, cwd=project,
        env={**os.environ, "FLISK_PROJECT_ROOT": str(project)},
    )
    assert proc.returncode == 0, proc.stdout[-3000:] + proc.stderr[-3000:]
    manifests = {m["Name"]: m for m in json.loads(proc.stdout)["Manifests"]}
    return manifests["golden-layers-build"]["DeployTarget"]["UpdateCmdSpec"], project


def _dockerfile_hash(project: Path) -> str:
    return hashlib.sha256((project / DOCKERFILE_REL).read_bytes()).hexdigest()


def _run(tmp_path: Path, project: Path, spec: dict, present: dict[str, str], **env):
    """Run the generated command; `present` maps image name to the hash label it carries."""
    binary = tmp_path / "bin"
    binary.mkdir(exist_ok=True)
    (binary / "docker.py").write_text(FAKE_DOCKER_PY)
    (binary / "docker").write_text(FAKE_DOCKER)
    (binary / "docker").chmod(0o755)
    (binary / "docker.cmd").write_text(FAKE_DOCKER_CMD)
    state = tmp_path / "state"
    state.mkdir(exist_ok=True)
    for name, label in present.items():
        (state / name.replace("/", "_").replace(":", "_")).write_text(label)
    log = tmp_path / "docker.log"
    log.write_text("")
    spec_env = dict(item.split("=", 1) for item in (spec.get("env") or []))
    proc = subprocess.run(
        spec["args"], cwd=project, capture_output=True, text=True, timeout=60,
        env={
            **os.environ, **spec_env,
            "PATH": f"{binary}{os.pathsep}{os.environ['PATH']}",
            "FAKE_DOCKER_LOG": str(log), "FAKE_DOCKER_DIR": str(state),
            **env,
        },
    )
    calls = [json.loads(line) for line in log.read_text().splitlines()]
    return proc, calls


def _builds(calls: list[list[str]]) -> list[list[str]]:
    return [call for call in calls if call[0] == "build"]


def _batched_fresh_checks(calls: list[list[str]]) -> list[list[str]]:
    """Inspect calls that ask about more than one image at once (the up-to-date check)."""
    return [call for call in calls if call[:2] == ["image", "inspect"] and len(call) > 5]


@TILT_REQUIRED
def test_fresh_images_are_found_with_one_inspect_call(tmp_path):
    spec, project = _spec(tmp_path)
    proc, calls = _run(tmp_path, project, spec, {name: _dockerfile_hash(project) for name in IMAGES})
    assert proc.returncode == 0, proc.stderr
    assert "up to date" in proc.stdout
    # The whole "up to date" answer is this one call; nothing else reaches Docker.
    assert calls == [FRESH_CALL]


@TILT_REQUIRED
@pytest.mark.parametrize("stale_image", ["proj-l3-backend:latest", "proj-l3-backend-prisma:latest"])
def test_a_stale_golden_image_still_triggers_the_build(tmp_path, stale_image):
    spec, project = _spec(tmp_path)
    labels = {name: _dockerfile_hash(project) for name in IMAGES}
    labels[stale_image] = "an-older-hash"
    proc, calls = _run(
        tmp_path, project, spec, labels,
        DOCKER_BUILDKIT="0", FLISK_GOLDEN_REGISTRY="off",
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "up to date" not in proc.stdout
    assert "Building golden layered images" in proc.stdout
    assert "Golden layers built" in proc.stdout
    assert _batched_fresh_checks(calls) == [FRESH_CALL]
    assert len(_builds(calls)) == len(IMAGES)


@TILT_REQUIRED
@pytest.mark.parametrize("missing_image", ["proj-l2:latest", "proj-l3-backend-prisma:latest"])
def test_a_missing_golden_image_still_triggers_pull_then_build(tmp_path, missing_image):
    spec, project = _spec(tmp_path)
    labels = {name: _dockerfile_hash(project) for name in IMAGES if name != missing_image}
    proc, calls = _run(tmp_path, project, spec, labels, DOCKER_BUILDKIT="0")
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "up to date" not in proc.stdout
    # The registry pull is still tried before falling back to the local build.
    assert [call[0] for call in calls].count("pull") == 1
    assert _batched_fresh_checks(calls) == [FRESH_CALL]
    assert len(_builds(calls)) == len(IMAGES)
    assert "Golden layers built" in proc.stdout


@TILT_REQUIRED
def test_forced_rebuild_skips_the_freshness_check_entirely(tmp_path):
    spec, project = _spec(tmp_path)
    proc, calls = _run(
        tmp_path, project, spec,
        {name: _dockerfile_hash(project) for name in IMAGES},
        DOCKER_BUILDKIT="0", FLISK_GOLDEN_REGISTRY="off", FLISK_GOLDEN_REBUILD="1",
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "up to date" not in proc.stdout
    assert _batched_fresh_checks(calls) == []
    assert len(_builds(calls)) == len(IMAGES)


def test_the_freshness_check_is_a_single_batched_inspect_in_both_scripts():
    """No per-image loop may come back; the POSIX and PowerShell twins stay in sync."""
    build_src = GOLDEN_BUILD.read_text(encoding="utf-8")
    check = build_src.split("fresh=0", 1)[1].split("@@REUSE_SHARED@@", 1)[0]
    assert "for img in" not in check
    assert "docker image inspect -f '{{index .Config.Labels \"@@HASH_LABEL@@\"}}' $IMAGES" in build_src
    assert 'grep -cx "$HASH")" = "@@COUNT@@"' in build_src

    win_src = WINDOWS_SCRIPTS.read_text(encoding="utf-8")
    fresh = win_src.split("def golden_build_script", 1)[1].split("skipping build", 1)[0]
    assert "foreach ($img in $images)" not in fresh
    assert "@images" in fresh
    assert "Where-Object { $_ -eq $hash }" in fresh
