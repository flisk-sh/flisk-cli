# Copyright (c) 2026 Flisk Landscape contributors
# SPDX-License-Identifier: MIT
"""init-networks asks Docker once for all networks and still fails with Docker's own
message when a missing network cannot be created (#3856).

The command string comes from ``fix_docker_networks`` (evaluated by Tilt) and is run with
``sh -c`` against a fake ``docker`` placed first on PATH, so no real network is touched.
The fake logs every invocation, so the tests also pin how many Docker calls a warm start
makes: one ``docker network ls``, nothing else.
"""

import json
import os
import shutil
import stat
import subprocess
from pathlib import Path

import pytest

pytestmark = [pytest.mark.fast, pytest.mark.generator]

REPO_ROOT = Path(__file__).resolve().parents[2]
STAR = REPO_ROOT / "runtime" / "engine" / "topologies" / "tilt" / "common" / "utils_docker_networks.star"
RESULT_MARKER = "Error in fail: RESULT"
POOL_MSG = (
    "Error response from daemon: all predefined address pools have been fully subnetted"
)

FAKE_DOCKER = r"""#!/bin/sh
# Fake docker. State: $FAKE_DIR/<net>.exists ; scenario: $FAKE_SCENARIO
echo "docker $*" >> "$FAKE_DIR/calls.log"
sub="$1 $2"; net="$3"
case "$sub" in
  "network ls")
    for f in "$FAKE_DIR"/*.exists; do
      [ -e "$f" ] || continue
      n=${f##*/}; n=${n%.exists}
      case "$FAKE_SCENARIO" in
        compose_labels) echo "$n map[com.docker.compose.network:x]";;
        other_labels) echo "$n map[other.label:1]";;
        *) echo "$n map[]";;
      esac
    done
    exit 0 ;;
  "network inspect")
    if [ -f "$FAKE_DIR/$net.exists" ]; then
      case "$FAKE_SCENARIO" in compose_labels) echo "map[com.docker.compose.network:x]";; *) echo "map[]";; esac
      exit 0
    fi
    echo "Error response from daemon: network $net not found" >&2; exit 1 ;;
  "network rm") rm -f "$FAKE_DIR/$net.exists"; exit 0 ;;
  "network create")
    case "$FAKE_SCENARIO" in
      pool) echo "$FAKE_POOL_MSG" >&2; exit 1 ;;
      pool_mid)
        if [ "$net" = "net_b" ]; then echo "$FAKE_POOL_MSG" >&2; exit 1
        elif [ -f "$FAKE_DIR/$net.exists" ]; then
          echo "Error response from daemon: network with name $net already exists" >&2; exit 1
        fi
        touch "$FAKE_DIR/$net.exists"; echo "deadbeef"; exit 0 ;;
      race) touch "$FAKE_DIR/$net.exists"
            echo "Error response from daemon: network with name $net already exists" >&2; exit 1 ;;
      *) if [ -f "$FAKE_DIR/$net.exists" ]; then
           echo "Error response from daemon: network with name $net already exists" >&2; exit 1
         fi
         touch "$FAKE_DIR/$net.exists"; echo "deadbeef"; exit 0 ;;
    esac ;;
esac
exit 0
"""


def _command(tmp_path: Path, star: Path, networks) -> str:
    shutil.copy(star, tmp_path / "nets.star")
    tiltfile = tmp_path / "Tiltfile"
    tiltfile.write_text(
        "load('./nets.star', 'fix_docker_networks')\n"
        "r = fix_docker_networks(%s)\n"
        "fail('RESULT' + encode_json(r))\n" % json.dumps(networks)
    )
    proc = subprocess.run(
        ["tilt", "alpha", "tiltfile-result", "-f", str(tiltfile)],
        capture_output=True, text=True, timeout=180,
    )
    out = proc.stdout + proc.stderr
    assert RESULT_MARKER in out, out[-3000:]
    return json.loads(out.split(RESULT_MARKER, 1)[1].strip())


def _run(tmp_path: Path, scenario: str, existing=(), star: Path = STAR, networks=("net_a", "net_b")):
    cmd = _command(tmp_path, star, list(networks))
    fake = tmp_path / "fakebin"
    fake.mkdir()
    docker = fake / "docker"
    docker.write_text(FAKE_DOCKER)
    docker.chmod(docker.stat().st_mode | stat.S_IEXEC)
    state = tmp_path / "state"
    state.mkdir()
    for n in existing:
        (state / f"{n}.exists").touch()
    env = {
        **os.environ,
        "PATH": f"{fake}{os.pathsep}{os.environ['PATH']}",
        "FAKE_DIR": str(state),
        "FAKE_SCENARIO": scenario,
        "FAKE_POOL_MSG": POOL_MSG,
    }
    proc = subprocess.run(["sh", "-c", cmd], capture_output=True, text=True, env=env, timeout=30)
    calls = (state / "calls.log").read_text() if (state / "calls.log").exists() else ""
    return proc, calls


def test_created_networks_succeed(tmp_path):
    proc, _ = _run(tmp_path, "create_ok")
    assert proc.returncode == 0, proc.stderr
    assert "Created network net_a" in proc.stdout
    assert "Docker networks initialized" in proc.stdout


def test_existing_network_is_not_an_error(tmp_path):
    proc, _ = _run(tmp_path, "exists", existing=["net_a", "net_b"])
    assert proc.returncode == 0, proc.stderr
    assert "Docker networks initialized" in proc.stdout
    assert "Created network" not in proc.stdout


def test_warm_start_asks_docker_once(tmp_path):
    """Every network already up: one `docker network ls` is the only Docker call."""
    proc, calls = _run(tmp_path, "exists", existing=["net_a", "net_b"])
    assert proc.returncode == 0, proc.stderr
    assert calls == "docker network ls --format {{.Name}} {{.Labels}}\n"
    assert "Docker networks initialized" in proc.stdout


def test_network_with_unrelated_labels_is_kept(tmp_path):
    """A network with labels that are not compose's is already correct and untouched."""
    proc, calls = _run(tmp_path, "other_labels", existing=["net_a", "net_b"])
    assert proc.returncode == 0, proc.stderr
    assert calls == "docker network ls --format {{.Name}} {{.Labels}}\n"


def test_only_the_missing_network_is_created(tmp_path):
    proc, calls = _run(tmp_path, "exists", existing=["net_a"])
    assert proc.returncode == 0, proc.stderr
    assert "Created network net_b" in proc.stdout
    assert "Created network net_a" not in proc.stdout
    assert calls == (
        "docker network ls --format {{.Name}} {{.Labels}}\n"
        "docker network create net_b\n"
    )


def test_no_networks_is_a_noop(tmp_path):
    proc, calls = _run(tmp_path, "exists", networks=[])
    assert proc.returncode == 0, proc.stderr
    assert "Docker networks initialized" in proc.stdout
    assert calls == ""


def test_create_race_with_another_process_is_not_an_error(tmp_path):
    proc, _ = _run(tmp_path, "race")
    assert proc.returncode == 0, proc.stderr
    assert "Docker networks initialized" in proc.stdout


def test_failed_create_fails_with_dockers_message(tmp_path):
    proc, _ = _run(tmp_path, "pool")
    assert proc.returncode != 0
    assert POOL_MSG in proc.stderr
    assert "net_a" in proc.stderr
    assert "Docker networks initialized" not in proc.stdout


def test_failure_stops_before_later_networks(tmp_path):
    _, calls = _run(tmp_path, "pool")
    assert "network create net_a" in calls
    assert "net_b" not in calls


def test_network_with_compose_labels_is_removed_then_created(tmp_path):
    proc, calls = _run(tmp_path, "compose_labels", existing=["net_a"], networks=("net_a",))
    assert proc.returncode == 0, proc.stderr
    assert "docker network rm net_a" in calls
    assert calls.index("network rm net_a") < calls.index("network create net_a")
    assert "Created network net_a" in proc.stdout


def test_every_requested_network_is_checked_and_created(tmp_path):
    proc, calls = _run(tmp_path, "create_ok", networks=("net_a", "net_b", "net_c"))
    assert proc.returncode == 0, proc.stderr
    # One listing checks every network; no per-network inspect is needed while the creates succeed.
    assert calls.count("network ls") == 1
    for net in ("net_a", "net_b", "net_c"):
        assert f"network create {net}" in calls
        assert f"Created network {net}" in proc.stdout
    assert "Docker networks initialized" in proc.stdout


def test_mid_chain_failure_stops_before_later_networks(tmp_path):
    proc, calls = _run(tmp_path, "pool_mid", networks=("net_a", "net_b", "net_c"))
    assert proc.returncode != 0
    assert "network create net_a" in calls
    assert "network create net_b" in calls
    assert POOL_MSG in proc.stderr
    assert "net_c" not in calls
    assert "Docker networks initialized" not in proc.stdout
