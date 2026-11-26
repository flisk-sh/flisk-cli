# Copyright (c) 2026 Flisk Landscape contributors
# SPDX-License-Identifier: MIT
"""
A resource with `"appType": "migrator"` is a one-shot job in the stack's Compose file.

It used to get the backend service: `restart: unless-stopped`, PORT, an HTTP health check and a Traefik route. The
migrator ran its migrations, exited 0, and Docker restarted it forever with its health check failing, so `flisk up`
never became ready for a project with a migrator.

Runs the real Compose generators through Tilt's interpreter (`tilt alpha tiltfile-result`), like
test_agent_resource.py. The asserts are on what Compose receives, not on the Starlark text.
"""

from __future__ import annotations

import shutil

import pytest

from tilt_project import run_project_tilt

pytestmark = [pytest.mark.generator]
TILT_REQUIRED = pytest.mark.skipif(shutil.which("tilt") is None, reason="tilt CLI not installed")

# The flisk-stack layout: a backend api, and a migrator in the same stack that the api depends on.
COMPOSE_BODY = """
load('@ENGINE/topologies/platform/docker/compose/compose.star', 'generate_backend_compose_entry', 'generate_app_compose_from_entries')
load('@ENGINE/topologies/tilt/resources/orchestrator/apply_compose_resource_registration.star', 'count_routable_backends_by_stack')

stack = 'app'
migrator_manifest = {'appType': 'migrator', 'stack': stack, 'featuresEnabled': ['prisma'], 'dependsOn': ['postgres']}
api_manifest = {'appType': 'backend', 'stack': stack, 'port': 4000, 'healthCheckPath': '/health', 'dependsOn': ['migrations']}

migrator_entry = generate_backend_compose_entry('services/app', stack, {'name': 'migrations'}, migrator_manifest)
api_entry = generate_backend_compose_entry('services/app', stack, {'name': 'api'}, api_manifest)
r = {
    'migrator': migrator_entry,
    'api': api_entry,
    'yaml': generate_app_compose_from_entries('services/app', [api_entry, migrator_entry]),
    'routable': count_routable_backends_by_stack(
        {'resources': [{'name': 'api'}, {'name': 'migrations'}]},
        {'api': api_manifest, 'migrations': migrator_manifest},
        stack,
    ),
}
"""


@pytest.fixture(scope="module")
def result(tmp_path_factory) -> dict:
    if shutil.which("tilt") is None:
        pytest.skip("tilt CLI not installed")
    return run_project_tilt(tmp_path_factory.mktemp("migrator"), "migrator-project", COMPOSE_BODY)


@TILT_REQUIRED
def test_a_migrator_is_not_restarted_after_it_exits(result):
    entry = result["migrator"]

    assert '    restart: "no"\n' in entry
    assert "unless-stopped" not in entry


@TILT_REQUIRED
def test_a_migrator_has_no_http_health_check_port_or_route(result):
    entry = result["migrator"]

    # The image's own HEALTHCHECK is switched off too, not just left out.
    assert "    healthcheck:\n      disable: true\n" in entry
    assert "curl" not in entry
    assert "PORT=" not in entry
    assert "FLISK_HEALTH_PATH" not in entry
    assert '      - "traefik.enable=false"' in entry
    assert "traefik.http." not in entry
    assert "/api/migrations" not in entry


@TILT_REQUIRED
def test_a_migrator_says_it_is_a_migrator_and_gets_the_stack_database(result):
    entry = result["migrator"]

    assert "      - FLISK_RESOURCE_TYPE=migrator\n" in entry
    assert "FLISK_RESOURCE_TYPE=backend" not in entry
    # The generated DATABASE_URL is a plain PostgreSQL URL: no Prisma-only ?schema= parameter (#3659).
    assert "?schema=" not in entry
    assert "/migrator_project_app" in entry
    assert "      - DATABASE_URL=postgresql://migrator_project:" in entry


@TILT_REQUIRED
def test_the_backend_next_to_a_migrator_is_unchanged(result):
    entry = result["api"]

    assert "    restart: unless-stopped\n" in entry
    assert "      - PORT=4000\n" in entry
    assert "      - FLISK_HEALTH_PATH=/health\n" in entry
    assert "      - FLISK_RESOURCE_TYPE=backend\n" in entry
    assert 'test: ["CMD", "curl", "-f", "--max-time", "5", "http://localhost:4000/health"]' in entry
    assert '      - "traefik.enable=true"' in entry
    # Traefik load-balances on the literal port; nothing references a port anchor (#476).
    assert 'loadbalancer.server.port=4000"' in entry
    assert "loadbalancer.server.port=*" not in entry


@TILT_REQUIRED
def test_the_stack_compose_file_has_no_dead_port_anchors(result):
    # #476: the x-*-port anchors nothing referenced are gone; the memory anchors services merge stay.
    yaml_text = result["yaml"]

    assert "x-backend-port" not in yaml_text
    assert "x-frontend-port" not in yaml_text
    assert "x-sdk-port" not in yaml_text
    assert "&backend-port" not in yaml_text
    assert "*backend-port" not in yaml_text
    assert "PORT DEFINITIONS" not in yaml_text
    assert "x-frontend-memory-limit: &frontend-memory-limit" in yaml_text
    assert "\n  migrations:\n" in yaml_text
    assert "\n  api:\n" in yaml_text


@TILT_REQUIRED
def test_a_migrator_does_not_count_as_a_routable_backend_of_its_stack(result):
    # With the migrator counted, the api looked like one of two backends sharing the stack and lost its stack routes.
    assert result["routable"] == {"app": 1}
