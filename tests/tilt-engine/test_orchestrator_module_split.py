# Copyright (c) 2026 Flisk Landscape contributors
# SPDX-License-Identifier: MIT
"""Characterisation coverage for the modules `apply_compose_resource_registration.star` split into (#4959).

Every test loads a name straight from the submodule that owns it now, so each extracted module's own
surface (and the behaviour behind it) is pinned, not just the re-exports the main file kept.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest
from test_dependson_platform_postgres import (
    ORCHESTRATOR_DIR,
    RESULT_MARKER,
    TILT_REQUIRED,
    _make_should_enable,
    run_starlark,
)

pytestmark = [pytest.mark.fast, pytest.mark.generator]

DEPENDENCY_GRAPH = ORCHESTRATOR_DIR / "dependency_graph.star"
STACK_DECISIONS = ORCHESTRATOR_DIR / "stack_decisions.star"
LIVE_UPDATE = ORCHESTRATOR_DIR / "live_update.star"
IMAGE_BUILD = ORCHESTRATOR_DIR / "image_build.star"
COMPANION = ORCHESTRATOR_DIR / "companion_resources.star"
PYTHON_TEST_RES = ORCHESTRATOR_DIR / "python_test_resource.star"
SINGLE_RES = ORCHESTRATOR_DIR / "single_resource.star"


def _run_tiltfile_output(tmp_path: Path, body: str) -> str:
    """Run `body` in a Tiltfile and return combined output, without expecting a RESULT marker (for fail() paths)."""
    tiltfile = tmp_path / "Tiltfile"
    tiltfile.write_text(body.replace("@ORCHESTRATOR", str(ORCHESTRATOR_DIR)))
    proc = subprocess.run(
        ["tilt", "alpha", "tiltfile-result", "-f", str(tiltfile)],
        capture_output=True,
        text=True,
        timeout=180,
    )
    return proc.stdout + proc.stderr


# --- dependency_graph.star ---------------------------------------------------


@TILT_REQUIRED
def test_dependency_graph_resolves_shared_postgres_before_yaml_fallthrough(tmp_path):
    result = run_starlark(
        tmp_path,
        f"load('{DEPENDENCY_GRAPH}', 'resolve_dependency_to_resource')\n"
        "r = {'pg': resolve_dependency_to_resource('postgres', {}), "
        "'dm': resolve_dependency_to_resource('database-management', {}), "
        "'unknown': resolve_dependency_to_resource('typo-name', {})}\n",
    )
    assert result == {"pg": "postgres", "dm": "postgres", "unknown": "typo-name-yaml"}


@TILT_REQUIRED
def test_dependency_graph_resolve_prefers_backend_over_frontend(tmp_path):
    result = run_starlark(
        tmp_path,
        f"load('{DEPENDENCY_GRAPH}', 'resolve_dependency_to_resource')\n"
        "services = {'svc-x': {'stack': 'stk', 'resources': ["
        "{'name': 'svc-x-frontend', 'frontend': True}, "
        "{'name': 'svc-x-backend', 'frontend': False}]}}\n"
        "r = {'resolved': resolve_dependency_to_resource('stk', services)}\n",
    )
    assert result["resolved"] == "svc-x-backend-yaml"


@TILT_REQUIRED
def test_dependency_graph_build_resource_deps_postgres_edge(tmp_path):
    result = run_starlark(
        tmp_path,
        f"load('{DEPENDENCY_GRAPH}', 'build_resource_deps')\n"
        "res = {'name': 'svc-api'}\n"
        "manifest = {'dependsOn': ['postgres']}\n"
        "r = {'deps': build_resource_deps(res, 'svc-api', manifest, {}, [], {}, {}, None, {})}\n",
    )
    assert result["deps"] == ["postgres", "postgres-healthy"]


@TILT_REQUIRED
def test_dependency_graph_build_infra_dependencies_golden(tmp_path):
    result = run_starlark(
        tmp_path,
        f"load('{DEPENDENCY_GRAPH}', 'build_infra_dependencies')\n"
        + _make_should_enable({"golden-image"})
        + "should_enable = make_should_enable(set(['golden-image']))\n"
        "ctx = {'golden_image_resource': 'golden-layers-build'}\n"
        "r = {'deps': build_infra_dependencies('svc', should_enable, ctx, False, True)}\n",
    )
    assert result["deps"] == ["golden-layers-build"]


@TILT_REQUIRED
def test_dependency_graph_build_infra_dependencies_verdaccio(tmp_path):
    (tmp_path / "docker-compose.verdaccio.yml").write_text("services:\n  verdaccio: {}\n")
    result = run_starlark(
        tmp_path,
        f"load('{DEPENDENCY_GRAPH}', 'build_infra_dependencies')\n"
        + _make_should_enable({"verdaccio"})
        + "should_enable = make_should_enable(set(['verdaccio']))\n"
        "ctx = {'project_root': '" + str(tmp_path) + "'}\n"
        "r = {'deps': build_infra_dependencies('svc', should_enable, ctx, False, False)}\n",
    )
    assert result["deps"] == ["verdaccio"]


@TILT_REQUIRED
def test_dependency_graph_companion_resource_names(tmp_path):
    result = run_starlark(
        tmp_path,
        f"load('{DEPENDENCY_GRAPH}', 'job_healthy_resource_name', 'job_done_resource_name')\n"
        "r = {'healthy': job_healthy_resource_name('svc-api'), 'done': job_done_resource_name('svc-migrate')}\n",
    )
    assert result == {"healthy": "svc-api-healthy", "done": "svc-migrate-done"}


@TILT_REQUIRED
def test_dependency_graph_database_resource_names(tmp_path):
    result = run_starlark(
        tmp_path,
        f"load('{DEPENDENCY_GRAPH}', 'database_resource_names')\n"
        "services = {'pg-svc': {'resources': [{'name': 'postgres', '_manifest': {'appType': 'database'}}]}, "
        "'app': {'resources': [{'name': 'api', '_manifest': {'appType': 'backend'}}]}}\n"
        "r = {'names': database_resource_names(services)}\n",
    )
    assert result["names"] == ["postgres"]


@TILT_REQUIRED
def test_dependency_graph_defers_start_stays_off_without_license(tmp_path):
    """deferStart needs the licensed sablier overlay; the free stub keeps it off (#4959 characterisation)."""
    result = run_starlark(
        tmp_path,
        f"load('{DEPENDENCY_GRAPH}', 'resource_defers_start')\n"
        "r = {'defers': resource_defers_start({'sablier': {'enable': True, 'deferStart': True}})}\n",
    )
    assert result["defers"] == False


@TILT_REQUIRED
def test_dependency_graph_cycle_guard_names_the_cycle(tmp_path):
    services = (
        "{'a': {'name': 'svc-a', 'resources': [{'name': 'a', '_manifest': {'dependsOn': ['b']}}]}, "
        "'b': {'name': 'svc-b', 'resources': [{'name': 'b', '_manifest': {'dependsOn': ['a']}}]}}"
    )
    output = _run_tiltfile_output(
        tmp_path,
        f"load('{DEPENDENCY_GRAPH}', 'fail_on_dependency_cycle')\n"
        f"fail_on_dependency_cycle({services})\n",
    )
    assert "CIRCULAR dependsOn" in output
    assert "a -> b -> a" in output or "b -> a -> b" in output


@TILT_REQUIRED
def test_dependency_graph_no_cycle_passes(tmp_path):
    result = run_starlark(
        tmp_path,
        f"load('{DEPENDENCY_GRAPH}', 'fail_on_dependency_cycle')\n"
        "fail_on_dependency_cycle({'a': {'name': 'svc-a', 'resources': [{'name': 'a', '_manifest': {'dependsOn': ['b']}}]}, "
        "'b': {'name': 'svc-b', 'resources': [{'name': 'b', '_manifest': {}}]}})\n"
        "r = {'ok': True}\n",
    )
    assert result["ok"] == True


# --- stack_decisions.star ----------------------------------------------------


@TILT_REQUIRED
def test_stack_decisions_golden_image_use(tmp_path):
    result = run_starlark(
        tmp_path,
        f"load('{STACK_DECISIONS}', 'stack_uses_golden_image', 'stack_waits_for_golden_step')\n"
        "rc = {'resources': [{'name': 'a'}]}\n"
        "r = {'golden': stack_uses_golden_image(rc, {'a': {'appType': 'backend', 'language': 'bun'}}), "
        "'byo': stack_uses_golden_image(rc, {'a': {'appType': 'bring-your-own'}}), "
        "'waits': stack_waits_for_golden_step(rc, {'a': {'appType': 'backend', 'language': 'bun'}}, {}), "
        "'waits_byo': stack_waits_for_golden_step(rc, {'a': {'appType': 'bring-your-own'}}, {})}\n",
    )
    assert result == {"golden": True, "byo": False, "waits": True, "waits_byo": False}


@TILT_REQUIRED
def test_stack_decisions_own_postgres_container(tmp_path):
    result = run_starlark(
        tmp_path,
        f"load('{STACK_DECISIONS}', 'stack_has_own_postgres_container', 'project_imports_own_postgres_container')\n"
        "own = {'resources': [{'name': 'postgres'}]}\n"
        "r = {'own': stack_has_own_postgres_container(own, {'postgres': {'appType': 'bring-your-own'}}), "
        "'shared': stack_has_own_postgres_container(own, {'postgres': {'appType': 'database'}}), "
        "'none': stack_has_own_postgres_container({'resources': [{'name': 'api'}]}, {}), "
        "'proj_own': project_imports_own_postgres_container({'x': {'resources': [{'name': 'postgres', '_manifest': {'appType': 'bring-your-own'}}]}}), "
        "'proj_shared': project_imports_own_postgres_container({'x': {'resources': [{'name': 'postgres', '_manifest': {'appType': 'database'}}]}})}\n",
    )
    assert result == {"own": True, "shared": False, "none": False, "proj_own": True, "proj_shared": False}


@TILT_REQUIRED
def test_stack_decisions_selected_and_force_start_guard(tmp_path):
    result = run_starlark(
        tmp_path,
        f"load('{STACK_DECISIONS}', 'selected_for_shared_platform_postgres', 'force_start_shared_platform_postgres_once')\n"
        "ctx = {'_shared_platform_postgres_force_started': True}\n"
        "focus = {'focus_mode': True, 'focus_enabled_resources': ['a']}\n"
        "r = {'forced': force_start_shared_platform_postgres_once(ctx, lambda x: False, 'a'), "
        "'no_focus': selected_for_shared_platform_postgres('b', {}), "
        "'focus_in': selected_for_shared_platform_postgres('a', focus), "
        "'focus_out': selected_for_shared_platform_postgres('b', focus)}\n",
    )
    # An already-started guard skips the force-start (False), and with focus mode only the selected resource passes.
    assert result == {"forced": False, "no_focus": True, "focus_in": True, "focus_out": False}


@TILT_REQUIRED
@pytest.mark.skipif(shutil.which("docker-compose") is None and shutil.which("docker") is None, reason="docker compose not installed")
def test_stack_decisions_docker_compose_app_registers(tmp_path):
    (tmp_path / "docker-compose.yml").write_text("services:\n  svc-a:\n    image: busybox\n")
    result = run_starlark(
        tmp_path,
        f"load('{STACK_DECISIONS}', 'docker_compose_app')\n"
        "docker_compose_app(['docker-compose.yml'], 'proj', 'missing-env-file.env')\n"
        "r = {'ok': True}\n",
    )
    assert result["ok"] == True


# --- live_update.star --------------------------------------------------------


@TILT_REQUIRED
def test_live_update_compiled_languages_get_no_rules(tmp_path):
    result = run_starlark(
        tmp_path,
        f"load('{LIVE_UPDATE}', 'build_live_update_rules')\n"
        "r = {'rust': len(build_live_update_rules('svc/x', 'svc/x', ['src'], language='rust')), "
        "'go': len(build_live_update_rules('svc/x', 'svc/x', ['src'], language='go', go_live_reload=False))}\n",
    )
    assert result == {"rust": 0, "go": 0}


@TILT_REQUIRED
def test_live_update_bun_syncs_and_falls_back(tmp_path):
    result = run_starlark(
        tmp_path,
        f"load('{LIVE_UPDATE}', 'build_live_update_rules')\n"
        "r = {'bun': len(build_live_update_rules('svc/x', 'svc/x', ['src', 'bunfig.docker.autogenerated.toml'], language='bun')), "
        "'bun_entry': len(build_live_update_rules('svc/x', 'svc/x', ['src'], language='bun', bun_backend_entry='index')), "
        "'python': len(build_live_update_rules('svc/x', 'svc/x', ['src', 'bunfig.docker.autogenerated.toml'], language='python')), "
        "'go_reload': len(build_live_update_rules('svc/x', 'svc/x', ['src'], language='go', go_live_reload=True))}\n",
    )
    # bun: fall_back_on + one sync per sync path; a compiled entry adds the rebuild run + restart_container
    # python: the Bun-only generated config sync is skipped; Go liveReload gets fall_back_on + one sync
    assert result == {"bun": 3, "bun_entry": 4, "python": 2, "go_reload": 2}


@TILT_REQUIRED
def test_live_update_bun_entry_exclusions(tmp_path):
    result = run_starlark(
        tmp_path,
        f"load('{LIVE_UPDATE}', 'bun_backend_entry')\n"
        "r = {'frontend': bun_backend_entry({'manifest': {'appType': 'frontend'}, 'res_path': 'svc/x'}), "
        "'python': bun_backend_entry({'manifest': {'language': 'python'}, 'res_path': 'svc/x'}), "
        "'job': bun_backend_entry({'manifest': {'oneShotJob': True}, 'res_path': 'svc/x'})}\n",
    )
    assert result == {"frontend": None, "python": None, "job": None}


# --- image_build.star --------------------------------------------------------


@TILT_REQUIRED
def test_image_build_target_selection(tmp_path):
    result = run_starlark(
        tmp_path,
        f"load('{IMAGE_BUILD}', 'image_target')\n"
        "r = {'plain': image_target({'manifest': {}, 'res_path': 'svc/x'}), "
        "'go_dev': image_target({'manifest': {'language': 'go', 'dev': {'liveReload': True}}, 'res_path': 'svc/x'})}\n",
    )
    assert result == {"plain": "production", "go_dev": "development"}


@TILT_REQUIRED
def test_image_build_prebuild_deps(tmp_path):
    result = run_starlark(
        tmp_path,
        f"load('{IMAGE_BUILD}', 'image_prebuild_deps', 'needs_image_prebuild')\n"
        "r = {'deps': image_prebuild_deps(['svc-config-gen', 'peer', 'postgres']), "
        "'all_input': needs_image_prebuild(['svc-config-gen']), "
        "'peer': needs_image_prebuild(['svc-config-gen', 'peer'])}\n",
    )
    # the prebuild waits only on what the build itself reads plus postgres ordering; a peer dep makes it worth doing
    assert result == {"deps": ["svc-config-gen", "postgres"], "all_input": False, "peer": True}


# --- companion_resources.star ------------------------------------------------


@TILT_REQUIRED
def test_companion_healthy_and_done_script_content(tmp_path):
    result = run_starlark(
        tmp_path,
        f"load('{COMPANION}', 'HEALTHY_SCRIPT', 'JOB_DONE_SCRIPT')\n"
        "r = {'grace': 'grace=120' in HEALTHY_SCRIPT, 'inspect': 'docker inspect' in HEALTHY_SCRIPT, "
        "'wait': 'docker wait' in JOB_DONE_SCRIPT, 'cp': 'docker cp \"$id\":/tmp/flisk-output.env' in JOB_DONE_SCRIPT}\n",
    )
    assert result == {"grace": True, "inspect": True, "wait": True, "cp": True}


@TILT_REQUIRED
def test_companion_registers_local_resources(tmp_path):
    result = run_starlark(
        tmp_path,
        f"load('{COMPANION}', 'register_healthy_resource', 'register_job_done_resource', 'register_run_only_resource', 'register_replicas', 'register_frontend_typecheck')\n"
        "config = {'res_name': 'job', 'labels': ['app.job'], 'res_deps': [], 'manifest': {'appType': 'worker'}}\n"
        "register_job_done_resource(config, 'svc', 'proj', True)\n"
        "register_healthy_resource({'res_name': 'h', 'labels': ['app.h'], 'res_deps': [], 'manifest': {}}, 'svc', 'proj', True)\n"
        "register_run_only_resource({'res_name': 'ro', 'labels': ['app.ro'], 'res_deps': [], 'manifest': {}}, 'svc', 'proj', True)\n"
        "register_replicas({'res_name': 'r1', 'labels': ['app.r1'], 'res_deps': [], 'replicas': 1}, True)\n"
        "register_frontend_typecheck({'name': 'fe', 'res_name': 'fe'}, '" + str(tmp_path) + "', 'bunx tsc --noEmit')\n"
        "r = {'ok': True}\n",
    )
    assert result["ok"] == True


# --- python_test_resource.star ------------------------------------------------


@TILT_REQUIRED
def test_python_test_resource_noops_without_pytest(tmp_path):
    """A manifest that opts out of pytest-on-save registers nothing and returns early."""
    def registered(manifest: dict) -> str:
        # Evaluate the Tiltfile for real and read back the resources it registered: both the early return and the
        # local_resource() path return None, so the return value alone cannot tell them apart.
        output = _run_tiltfile_output(
            tmp_path,
            f"load('{PYTHON_TEST_RES}', 'register_python_test_resource')\n"
            f"config = {{'manifest': {manifest!r}, 'res_name': 'x', 'res_path': 'svc/x', 'labels': ['app.x'], 'res_deps': []}}\n"
            "register_python_test_resource(config, 'svc', 'proj', True)\n",
        )
        # `tilt alpha tiltfile-result` prints a JSON document; a Tiltfile error shows up in its "Error" field.
        result = json.loads(output[output.index("{"):])
        assert not result.get("Error"), result["Error"]
        return " ".join(m["Name"] for m in result.get("Manifests") or [])

    # Control: an opted-in Python service registers x-test, so the opt-out assertion below can fail.
    assert "x-test" in registered({"language": "python", "dev": {"testOnSave": True}})
    for opted_out in ({}, {"language": "python", "dev": {"testOnSave": False}}):
        output = registered(opted_out)
        assert "x-test" not in output and "x-pytest" not in output


# --- single_resource.star ----------------------------------------------------


@TILT_REQUIRED
def test_single_resource_registers_byo_dc_resource(tmp_path):
    """A bring-your-own resource skips docker_build and registers dc + companion resources."""
    (tmp_path / "docker-compose.yml").write_text("services:\n  byo:\n    image: alpine\n")
    result = run_starlark(
        tmp_path,
        f"load('{SINGLE_RES}', 'register_dc_resources')\n"
        "docker_compose('docker-compose.yml')\n"
        "byo = {'res_name': 'byo', 'labels': ['app.byo'], 'res_deps': [], 'manifest': {'appType': 'bring-your-own'}, "
        "'syncs': [], 'replicas': 1, 'app_type': 'bring-your-own', 'env': {}, 'res_path': 'svc/byo', 'resource_name': 'svc'}\n"
        "register_dc_resources([byo], 'svc', 'proj', True)\n"
        "r = {'ok': True}\n",
    )
    assert result["ok"] == True
