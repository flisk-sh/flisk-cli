# Copyright (c) 2026 Flisk Landscape contributors
# SPDX-License-Identifier: MIT
"""Path canonicalization and stack extraction in the shared manifest parser (parser.star).

`canonicalize_resource_path` is the single `.worktrees/`/`.flisk-out` path-collapse rule the
discovery orchestrator and manifest normalizer both call, and `extract_stack_from_path` is the
one stack extractor the discovery loader now shares. The cases run the real Starlark through
Tilt's interpreter (`tilt alpha tiltfile-result`), like test_discovery_portable_fs.py.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

pytestmark = pytest.mark.skipif(shutil.which("tilt") is None, reason="tilt CLI not installed")

PARSER = Path(__file__).resolve().parents[2] / "runtime" / "engine" / "topologies" / "tilt" / "manifest" / "parser.star"

BODY = """
load('@PARSER', 'canonicalize_resource_path', 'extract_stack_from_path')
r = {
    'worktree': canonicalize_resource_path('.worktrees/task1-dry/services/platform/api'),
    'worktree_nested': canonicalize_resource_path('.worktrees/wt-name/services/product/orders/orders-backend'),
    'plain': canonicalize_resource_path('services/product/orders/orders-backend'),
    'short_worktree': canonicalize_resource_path('.worktrees/x'),
    'flisk_out': canonicalize_resource_path('.flisk/.flisk-out/../../services/product/a'),
    'stack_worktree': extract_stack_from_path('.worktrees/w/services/product/orders/orders-api'),
    'stack_prefix': extract_stack_from_path('../repo/services/product/identity/svc'),
    'stack_renamed': extract_stack_from_path('services/product/profile/svc'),
    'stack_fallback': extract_stack_from_path('libs/foo/my-lib', 'team-lib'),
    'stack_empty': extract_stack_from_path(''),
}
fail('RESULT' + encode_json(r))
"""


def _run(tmp_path: Path) -> dict:
    tiltfile = tmp_path / "Tiltfile"
    tiltfile.write_text(BODY.replace("@PARSER", str(PARSER)))
    proc = subprocess.run(
        ["tilt", "alpha", "tiltfile-result", "-f", str(tiltfile)],
        capture_output=True,
        text=True,
        timeout=180,
        cwd=tmp_path,
        env=os.environ,
    )
    output = proc.stdout + proc.stderr
    marker = "Error in fail: RESULT"
    assert marker in output, output[-3000:]
    return json.loads(output.split(marker, 1)[1].strip())


def test_canonicalize_collapses_worktree_and_flisk_out_prefixes(tmp_path):
    r = _run(tmp_path)
    assert r["worktree"] == "services/platform/api"
    assert r["worktree_nested"] == "services/product/orders/orders-backend"
    # a plain project-relative path and a worktree name with nothing below it pass through
    assert r["plain"] == "services/product/orders/orders-backend"
    assert r["short_worktree"] == ".worktrees/x"
    assert r["flisk_out"] == "services/product/a"


def test_extract_stack_sees_through_checkout_and_scan_root_prefixes(tmp_path):
    r = _run(tmp_path)
    assert r["stack_worktree"] == "orders"
    assert r["stack_prefix"] == "identity"
    # 'profile' was renamed to 'identity'
    assert r["stack_renamed"] == "identity"
    # no services/product layout: first '-' segment of the app name
    assert r["stack_fallback"] == "team"
    assert r["stack_empty"] == "unknown"
