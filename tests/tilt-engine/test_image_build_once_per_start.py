# Copyright (c) 2026 Flisk Landscape contributors
# SPDX-License-Identifier: MIT
"""
flisk#4237, fix cycle 2: one `docker build` per image per start at most — none when nothing changed.

A service that waits for other services registers two build-capable Tilt resources: `<name>-image`,
which builds the image as soon as its inputs exist without waiting for the service's dependencies,
and the service's own image build (a custom_build that re-tags the `<name>-image` product the way
Tilt expects, or builds when that image is missing or stale). The stamp the first build leaves
(`<Dockerfile>.prebuild.built`, taken before the build read the files) lets both steps see that a
restart changed nothing: the `-image` step skips its cached rebuild and the service build only
re-tags, so no image build command runs a second time for the same service in one start.
"""

from __future__ import annotations

import pytest

from test_dependson_platform_postgres import TILT_REQUIRED
from test_image_prebuild_deps import _commands, _run

pytestmark = [pytest.mark.generator]


@TILT_REQUIRED
def test_a_restart_with_nothing_changed_schedules_no_second_build(tmp_path):
    """The cycle-2 acceptance test: the image builds at most once per start — here, not even once."""
    prebuild, build = _commands(tmp_path)
    (tmp_path / "svc" / "api" / "src").mkdir()
    (tmp_path / "svc" / "api" / "src" / "main.ts").write_text("1")

    # First start: the `-image` step builds the image; the service's own build only re-tags it.
    proc, calls = _run(tmp_path, prebuild)
    assert proc.returncode == 0, proc.stderr
    assert [c.split()[0] for c in calls] == ["build"]
    proc, calls = _run(tmp_path, build)
    assert calls == ["tag flisk_project_api_api:dev flisk_project_api_api:tilt-build-1"]

    # Restart, nothing changed: no `docker build` runs anywhere — the stamp is fresh and the image
    # is still there, so `-image` skips and the service build re-tags the same image.
    proc, calls = _run(tmp_path, prebuild)
    assert proc.returncode == 0, proc.stderr
    assert calls == ["image inspect flisk_project_api_api:dev"], calls
    assert "nothing changed since flisk_project_api_api:dev was built" in proc.stdout
    proc, calls = _run(tmp_path, build)
    assert calls == ["tag flisk_project_api_api:dev flisk_project_api_api:tilt-build-1"]


@TILT_REQUIRED
def test_a_restart_with_a_change_builds_the_image_exactly_once(tmp_path):
    prebuild, build = _commands(tmp_path)
    source = tmp_path / "svc" / "api" / "src" / "main.ts"
    source.parent.mkdir()
    source.write_text("1")
    _run(tmp_path, prebuild)

    # The edit between the two starts: newer than the old stamp, older than the new one the
    # `-image` step is about to make — so it does the one build of this start, and the service
    # build that follows only re-tags what it made.
    source.write_text("2")
    proc, calls = _run(tmp_path, prebuild)
    assert proc.returncode == 0, proc.stderr
    assert [c.split()[0] for c in calls] == ["image", "build"], calls
    proc, calls = _run(tmp_path, build)
    assert calls == ["tag flisk_project_api_api:dev flisk_project_api_api:tilt-build-1"]


@TILT_REQUIRED
def test_a_fresh_stamp_does_not_vouch_for_a_pruned_image(tmp_path):
    prebuild, build = _commands(tmp_path)
    (tmp_path / "svc" / "api" / "src").mkdir()
    (tmp_path / "svc" / "api" / "src" / "main.ts").write_text("1")
    _run(tmp_path, prebuild)

    # `docker image prune` removed the image although `.built` stayed. A deferStart service has no
    # later build to catch that, so the `-image` step inspects the image itself instead of trusting
    # the stamp alone — and rebuilds.
    proc, calls = _run(tmp_path, prebuild, FAKE_INSPECT_MISSING="1")
    assert proc.returncode == 0, proc.stderr
    assert [c.split()[0] for c in calls] == ["image", "build"], calls


@TILT_REQUIRED
def test_the_image_step_scans_the_same_paths_the_build_watches(tmp_path):
    """The skip sees every path custom_build watches, or a real change could look like 'nothing changed'."""
    prebuild, _build = _commands(tmp_path)
    # argv: ['sh', '-c', SCRIPT, 'sh', <6 _prebuild_args fields>, <watched paths>...]
    watched = prebuild["args"][4 + 6:]
    assert watched, "the -image step must get the watched paths after its fixed args"
    assert "svc/api" in watched, watched
    assert "package.json" in watched, watched
