# Copyright (c) 2026 Flisk Landscape contributors
# SPDX-License-Identifier: MIT
"""Shared harness for ``utils_docker_networks.star`` tests.

``tilt_result`` evaluates one function of the module inside a throwaway Tiltfile
(the same evaluation Tilt performs) and returns the JSON it reports through
``fail``. ``run_with_fake_docker`` executes the generated command with ``sh -c``
against a fake ``docker`` placed first on PATH, so no real network is touched.
"""

from __future__ import annotations

import json
import os
import shutil
import stat
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
NETWORKS_STAR = (
    REPO_ROOT / "runtime" / "engine" / "topologies" / "tilt" / "common" / "utils_docker_networks.star"
)
RESULT_MARKER = "Error in fail: RESULT"


def tilt_result(tmp_path: Path, func: str, args, star: Path = NETWORKS_STAR) -> str:
    """Return the JSON string ``func(args)`` produces when Tilt evaluates it."""
    shutil.copy(star, tmp_path / "nets.star")
    tiltfile = tmp_path / "Tiltfile"
    tiltfile.write_text(
        "load('./nets.star', '%s')\n"
        "r = %s(%s)\n"
        "fail('RESULT' + encode_json(r))\n" % (func, func, json.dumps(args))
    )
    proc = subprocess.run(
        ["tilt", "alpha", "tiltfile-result", "-f", str(tiltfile)],
        capture_output=True,
        text=True,
        timeout=180,
    )
    out = proc.stdout + proc.stderr
    assert RESULT_MARKER in out, out[-3000:]
    return json.loads(out.split(RESULT_MARKER, 1)[1].strip())


def run_with_fake_docker(
    tmp_path: Path,
    cmd: str,
    fake_script: str,
    env_extra: dict | None = None,
) -> tuple[subprocess.CompletedProcess, Path, str]:
    """Run ``cmd`` under ``sh -c`` with the fake ``docker`` first on PATH.

    Returns the completed process, the state directory (for per-network state
    files the fake reads, such as ``<net>.exists``), and the fake's calls log.
    """
    fake = tmp_path / "fakebin"
    fake.mkdir()
    docker = fake / "docker"
    docker.write_text(fake_script)
    docker.chmod(docker.stat().st_mode | stat.S_IEXEC)
    # exist_ok so callers can seed <net>.exists / <net>.containers beforehand.
    state = tmp_path / "state"
    state.mkdir(exist_ok=True)
    env = {
        **os.environ,
        "PATH": f"{fake}{os.pathsep}{os.environ['PATH']}",
        "FAKE_DIR": str(state),
        **(env_extra or {}),
    }
    proc = subprocess.run(["sh", "-c", cmd], capture_output=True, text=True, env=env, timeout=30)
    log = state / "calls.log"
    return proc, state, log.read_text() if log.exists() else ""
