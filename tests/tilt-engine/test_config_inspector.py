# Copyright (c) 2026 Flisk Landscape contributors
# SPDX-License-Identifier: MIT
"""
Tests for the Config Inspector server (runtime/ext/ide-components/config_inspector).

Starts the real request handler on a free port against a temporary project
root and exercises the page, the static assets, CSRF rejection and the
save path.
"""

import json
import re
import sys
import threading
import urllib.error
import urllib.request
from http.server import HTTPServer
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
COMPONENT_DIR = REPO_ROOT / 'runtime' / 'ext' / 'ide-components' / 'config_inspector'
SHARED_DIR = COMPONENT_DIR.parent / 'shared'

sys.path.insert(0, str(COMPONENT_DIR))
sys.path.insert(0, str(SHARED_DIR))

# NOTE: configs/save/views are generic top-level names that stay resident in
# sys.modules for the whole pytest session; no same-named module exists in the
# repo today, but a future one would shadow or be shadowed by these.
import configs  # noqa: E402
import config_service  # noqa: E402
import file_utils  # noqa: E402


def _load_server_module():
    """Load config_inspector/server.py under a private module name"""
    spec = spec_from_file_location('config_inspector_server', COMPONENT_DIR / 'server.py')
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


inspector_server = _load_server_module()


class _Client:
    """Tiny HTTP helper bound to one server instance"""

    def __init__(self, port):
        self.base = f'http://127.0.0.1:{port}'

    def get(self, path):
        return urllib.request.urlopen(self.base + path, timeout=10)

    def post(self, path, payload, headers=None):
        request = urllib.request.Request(
            self.base + path,
            data=json.dumps(payload).encode('utf-8'),
            headers={'Content-Type': 'application/json', **(headers or {})},
        )
        return urllib.request.urlopen(request, timeout=10)


@pytest.fixture
def inspector(tmp_path, monkeypatch):
    """Run ConfigInspectorHandler on a free port against a temp project root"""
    (tmp_path / 'spec.master').write_text('spec_version = "1"\n')

    discovered = tmp_path / 'runtime' / 'engine' / 'topologies' / 'tilt'
    discovered.mkdir(parents=True)
    (discovered / 'demo.star').write_text('load("demo", "demo")\n')

    writable = tmp_path / 'engine' / 'topologies' / 'tilt'
    writable.mkdir(parents=True)
    (writable / 'editable.star').write_text('# original\n')
    (tmp_path / 'engine' / 'spec.master').write_text('engine_spec = "2"\n')

    for module in (file_utils, config_service, configs):
        monkeypatch.setattr(module, 'PROJECT_ROOT', tmp_path)

    httpd = HTTPServer(('127.0.0.1', 0), inspector_server.ConfigInspectorHandler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()

    yield _Client(httpd.server_port), tmp_path

    httpd.shutdown()
    httpd.server_close()
    thread.join(timeout=5)


def _csrf_token(client):
    """Fetch the main page and pull the CSRF token out of the markup"""
    body = client.get('/').read().decode('utf-8')
    match = re.search(r"window\.CSRF_TOKEN = '([^']+)'", body)
    assert match, 'main page did not embed a CSRF token'
    return match.group(1)


@pytest.mark.ide
class TestConfigInspector:
    def test_get_root_returns_200(self, inspector):
        client, _ = inspector
        response = client.get('/')
        body = response.read().decode('utf-8')

        assert response.status == 200
        assert 'Config Inspector' in body
        assert 'spec.master' in body
        assert '/static/inspector.js' in body
        assert '/static/inspector.css' in body

    def test_compare_two_panes(self, inspector):
        client, _ = inspector

        response = client.get('/compare?master1=spec.master&master2=engine/spec.master')
        body = response.read().decode('utf-8')

        assert response.status == 200
        assert 'dual-pane' in body
        assert 'Master Config 1/2' in body
        assert 'Master Config 2/2' in body
        assert 'spec_version' in body
        assert 'engine_spec' in body

    def test_static_assets_served(self, inspector):
        client, _ = inspector

        js = client.get('/static/inspector.js')
        assert js.status == 200
        assert 'javascript' in js.headers['Content-Type']
        assert 'handleConfigClick' in js.read().decode('utf-8')

        css = client.get('/static/styles.css')
        assert css.status == 200
        assert css.headers['Content-Type'] == 'text/css'

    def test_api_masters_lists_configs(self, inspector):
        client, _ = inspector

        data = json.loads(client.get('/api/masters').read().decode('utf-8'))
        paths = [c['path'] for c in data['configs']]

        assert data['status'] == 'ok'
        assert 'spec.master' in paths
        assert any(p.endswith('demo.star') for p in paths)

    def test_post_without_csrf_rejected(self, inspector):
        client, _ = inspector

        with pytest.raises(urllib.error.HTTPError) as exc:
            client.post('/save', {
                'path': 'engine/topologies/tilt/editable.star',
                'content': 'x',
            })

        assert exc.value.code == 403

    def test_save_writes_inside_project(self, inspector):
        client, tmp_path = inspector
        target = tmp_path / 'engine' / 'topologies' / 'tilt' / 'editable.star'

        response = client.post(
            '/save',
            {
                'path': 'engine/topologies/tilt/editable.star',
                'content': '# updated\n',
                'original_hash': '',
                'csrf_token': _csrf_token(client),
            },
            headers={'Referer': client.base + '/'},
        )
        payload = json.loads(response.read().decode('utf-8'))

        assert response.status == 200
        assert payload['success'] is True
        assert target.read_text() == '# updated\n'

    def test_save_outside_project_refused(self, inspector):
        client, tmp_path = inspector
        token = _csrf_token(client)
        headers = {'Referer': client.base + '/'}

        # Path traversal is rejected and nothing is written
        with pytest.raises(urllib.error.HTTPError) as exc:
            client.post('/save', {
                'path': '../escape.star',
                'content': 'x',
                'original_hash': '',
                'csrf_token': token,
            }, headers=headers)
        assert exc.value.code == 400
        assert not (tmp_path.parent / 'escape.star').exists()

        # A path inside the project but outside the allowed locations is refused
        with pytest.raises(urllib.error.HTTPError) as exc:
            client.post('/save', {
                'path': 'docs/notes.star',
                'content': 'x',
                'original_hash': '',
                'csrf_token': token,
            }, headers=headers)
        assert exc.value.code == 400
        assert not (tmp_path / 'docs' / 'notes.star').exists()
