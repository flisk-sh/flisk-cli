# Copyright (c) 2026 Flisk Landscape contributors
# SPDX-License-Identifier: MIT
"""cleanup-networks must disconnect every container before removing each network.

The command string comes from ``cleanup_docker_networks`` (evaluated by Tilt)
and is run with ``sh -c`` against a fake ``docker`` placed first on PATH, so no
real network is touched. The fake answers ``network inspect`` with a seeded
container list and logs every call, so the tests can assert the order the
generated command drives Docker in.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from docker_nets import run_with_fake_docker, tilt_result  # noqa: E402

pytestmark = [pytest.mark.fast, pytest.mark.generator]

FAKE_DOCKER = r"""#!/bin/sh
# Fake docker. State: $FAKE_DIR/<net>.exists, $FAKE_DIR/<net>.containers
echo "docker $*" >> "$FAKE_DIR/calls.log"
sub="$1 $2"
case "$sub" in
  "network inspect")
    net="$3"
    if [ -f "$FAKE_DIR/$net.exists" ]; then
      if [ -f "$FAKE_DIR/$net.containers" ]; then cat "$FAKE_DIR/$net.containers"; fi
      exit 0
    fi
    echo "Error response from daemon: network $net not found" >&2; exit 1 ;;
  "network disconnect")
    # docker network disconnect -f <net> <container>
    case "$FAKE_SCENARIO" in disconnect_fail) exit 1 ;; *) exit 0 ;; esac ;;
  "network rm")
    net="$3"
    case "$FAKE_SCENARIO" in rm_fail) exit 1 ;; esac
    rm -f "$FAKE_DIR/$net.exists"
    exit 0 ;;
esac
exit 0
"""


def _command(tmp_path: Path, networks) -> str:
    return tilt_result(tmp_path, "cleanup_docker_networks", list(networks))


def _run(
    tmp_path: Path,
    scenario: str = "ok",
    networks=("net_a",),
    existing=(),
    containers=None,
):
    """Generate the cleanup command and run it with the fake docker on PATH.

    ``existing`` marks which networks ``network inspect`` reports; ``containers``
    maps a network to the container names inspect returns for it.
    """
    cmd = _command(tmp_path, networks)
    state = tmp_path / "state"
    state.mkdir()
    for net in existing:
        (state / f"{net}.exists").touch()
        names = (containers or {}).get(net)
        if names:
            (state / f"{net}.containers").write_text(" ".join(names) + " ")
    proc, _, calls = run_with_fake_docker(
        tmp_path, cmd, FAKE_DOCKER, {"FAKE_SCENARIO": scenario}
    )
    return proc, calls


def _assert_order(calls: str, *steps: str) -> None:
    """Every step appears in the calls log in the given order."""
    positions = []
    for step in steps:
        assert step in calls, f"{step!r} missing from:\n{calls}"
        positions.append(calls.index(step))
    assert positions == sorted(positions), f"steps out of order in:\n{calls}"


def test_cleanup_disconnects_each_container_before_removing_the_network(tmp_path):
    proc, calls = _run(
        tmp_path,
        existing=["net_a"],
        containers={"net_a": ["web", "api"]},
    )
    assert proc.returncode == 0, proc.stderr
    assert "Cleaning up Docker networks" in proc.stdout
    assert "Docker networks cleaned up" in proc.stdout
    _assert_order(
        calls,
        "network inspect net_a",
        "network disconnect -f net_a web",
        "network disconnect -f net_a api",
        "network rm net_a",
    )


def test_cleanup_handles_each_requested_network_in_order(tmp_path):
    proc, calls = _run(
        tmp_path,
        networks=("net_a", "net_b", "net_c"),
        existing=["net_a", "net_b", "net_c"],
        containers={"net_a": ["one"], "net_b": ["two", "three"], "net_c": ["four"]},
    )
    assert proc.returncode == 0, proc.stderr
    for net in ("net_a", "net_b", "net_c"):
        assert f"network rm {net}" in calls
    _assert_order(
        calls,
        "network disconnect -f net_a one",
        "network rm net_a",
        "network disconnect -f net_b two",
        "network disconnect -f net_b three",
        "network rm net_b",
        "network disconnect -f net_c four",
        "network rm net_c",
    )


def test_cleanup_removes_a_network_with_no_containers(tmp_path):
    proc, calls = _run(tmp_path, existing=["net_a"])
    assert proc.returncode == 0, proc.stderr
    assert "network disconnect" not in calls
    assert "network rm net_a" in calls


def test_cleanup_still_attempts_rm_for_a_missing_network(tmp_path):
    proc, calls = _run(tmp_path, networks=("ghost",))
    assert proc.returncode == 0, proc.stderr
    assert "network inspect ghost" in calls
    assert "network disconnect" not in calls
    # A network deleted between scan and cleanup still gets the removal attempt.
    assert "network rm ghost" in calls


def test_cleanup_survives_a_disconnect_failure_and_still_removes(tmp_path):
    proc, calls = _run(
        tmp_path,
        scenario="disconnect_fail",
        existing=["net_a"],
        containers={"net_a": ["web"]},
    )
    assert proc.returncode == 0, proc.stderr
    assert "network disconnect -f net_a web" in calls
    assert "network rm net_a" in calls
    assert "Docker networks cleaned up" in proc.stdout


def test_cleanup_survives_an_rm_failure_and_reports_done(tmp_path):
    proc, calls = _run(tmp_path, scenario="rm_fail", existing=["net_a"])
    assert proc.returncode == 0, proc.stderr
    assert "network rm net_a" in calls
    assert "Docker networks cleaned up" in proc.stdout


def test_cleanup_with_no_networks_calls_no_docker_commands(tmp_path):
    proc, calls = _run(tmp_path, networks=())
    assert proc.returncode == 0, proc.stderr
    assert "Docker networks cleaned up" in proc.stdout
    assert calls.strip() == ""


def test_generated_command_disconnects_then_removes_each_network(tmp_path):
    """The builder's structure holds for several names without running Docker."""
    cmd = _command(tmp_path, ["n1", "n2"])
    _assert_order(
        cmd,
        "docker network inspect n1",
        "docker network disconnect -f n1",
        "docker network rm n1",
        "docker network inspect n2",
        "docker network disconnect -f n2",
        "docker network rm n2",
    )
    assert cmd.startswith('echo "Cleaning up Docker networks..."')
    assert cmd.endswith('echo "Docker networks cleaned up"')
