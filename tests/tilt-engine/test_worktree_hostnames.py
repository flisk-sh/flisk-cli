# Copyright (c) 2026 Flisk Landscape contributors
# SPDX-License-Identifier: MIT
"""Traefik host rules for a linked worktree use the checkout domain exported by `flisk up` (#4697)."""

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
DOCKER_DIR = REPO_ROOT / "runtime" / "engine" / "topologies" / "platform" / "docker"
CONSTANTS = DOCKER_DIR / "constants.star"
HELPERS = DOCKER_DIR / "networking" / "traefik_helpers.star"
RESULT_MARKER = "Error in fail: RESULT"
PROJECT_NAME = "worktree-host-test"


def evaluate_hosts(tmp_path: Path, checkout_domain: str) -> dict[str, str]:
    project_root = tmp_path / PROJECT_NAME
    (project_root / ".flisk").mkdir(parents=True, exist_ok=True)
    (project_root / ".flisk" / "project.json").write_text(
        json.dumps({"project": {"name": PROJECT_NAME}})
    )
    tiltfile = project_root / "Tiltfile"
    tiltfile.write_text(
        f"""
load({str(CONSTANTS)!r}, "PlatformDockerConstants")
load({str(HELPERS)!r}, "frontend_rule", "project_backend_rule", "byo_ui_host")
r = {{
    "appHost": PlatformDockerConstants.APP_LOCAL_DOMAIN,
    "apiHost": PlatformDockerConstants.API_LOCAL_DOMAIN,
    "frontend": frontend_rule("dashboard", "/", "dashboard.local"),
    "backend": project_backend_rule({{"appName": "orders-api", "appType": "backend"}}, "orders-api"),
    "byoUi": byo_ui_host("admin-ui"),
}}
fail('RESULT' + encode_json(r))
"""
    )
    proc = subprocess.run(
        ["tilt", "alpha", "tiltfile-result", "-f", str(tiltfile)],
        capture_output=True,
        text=True,
        timeout=180,
        cwd=project_root,
        env={
            **os.environ,
            "FLISK_PROJECT_ROOT": str(project_root),
            "FLISK_CHECKOUT_DOMAIN": checkout_domain,
            "FLISK_CHECKOUT_NAME": "",
            "FLISK_CHECKOUT_HOST": "",
        },
    )
    output = proc.stdout + proc.stderr
    assert RESULT_MARKER in output, output[-3000:]
    return json.loads(output.split(RESULT_MARKER, 1)[1].strip())


def test_main_checkout_rules_are_unchanged(tmp_path: Path):
    hosts = evaluate_hosts(tmp_path, "")

    assert hosts["appHost"] == f"app.{PROJECT_NAME}.localhost"
    assert hosts["apiHost"] == f"api.{PROJECT_NAME}.localhost"
    assert f"(Host(`app.{PROJECT_NAME}.localhost`) && PathPrefix(`/`))" in hosts["frontend"]
    assert f"Host(`api.{PROJECT_NAME}.localhost`)" in hosts["backend"]
    assert hosts["byoUi"] == f"admin-ui.{PROJECT_NAME}.localhost"


def test_worktree_rules_use_the_exported_checkout_domain(tmp_path: Path):
    checkout = "feature-login.flisk-project.localhost"
    hosts = evaluate_hosts(tmp_path, checkout)

    assert hosts["appHost"] == f"app.{checkout}"
    assert hosts["apiHost"] == f"api.{checkout}"
    assert f"(Host(`app.{checkout}`) && PathPrefix(`/`))" in hosts["frontend"]
    assert f"Host(`api.{checkout}`)" in hosts["backend"]
    assert hosts["byoUi"] == f"admin-ui.{checkout}"
