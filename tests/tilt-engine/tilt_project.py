# Copyright (c) 2026 Flisk Landscape contributors
# SPDX-License-Identifier: MIT
"""
Run a Tiltfile through `tilt alpha tiltfile-result` inside a minimal flisk project.

Generator tests that need a project root used to keep a copy of this helper each; it lives here once. It
writes `.flisk/project.json` for `project_name`, runs `tilt alpha tiltfile-result -f Tiltfile` from the
project root with `FLISK_PROJECT_ROOT` set, and parses the `fail('RESULT' + encode_json(r))` line the body
must end on. The body may use `@ENGINE` and `@DISCOVERY` as `load()` prefixes; they resolve to
`runtime/engine` and `runtime/discovery`.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
ENGINE_ROOT = REPO_ROOT / "runtime" / "engine"
DISCOVERY_ROOT = REPO_ROOT / "runtime" / "discovery"
RESULT_MARKER = "Error in fail: RESULT"


def run_project_tilt(tmp_path: Path, project_name: str, body: str) -> dict:
    project_root = tmp_path / project_name
    (project_root / ".flisk").mkdir(parents=True, exist_ok=True)
    (project_root / ".flisk" / "project.json").write_text(json.dumps({"project": {"name": project_name}}))
    tiltfile = project_root / "Tiltfile"
    tiltfile.write_text(
        body.replace("@ENGINE", str(ENGINE_ROOT)).replace("@DISCOVERY", str(DISCOVERY_ROOT))
        + "\nfail('RESULT' + encode_json(r))\n"
    )
    command = ["tilt", "alpha", "tiltfile-result", "-f", str(tiltfile)]
    env = {**os.environ, "FLISK_PROJECT_ROOT": str(project_root)}
    proc = subprocess.run(command, capture_output=True, text=True, timeout=180, cwd=project_root, env=env)
    output = proc.stdout + proc.stderr
    assert RESULT_MARKER in output, output[-3000:]
    return json.loads(output.split(RESULT_MARKER, 1)[1].strip())
