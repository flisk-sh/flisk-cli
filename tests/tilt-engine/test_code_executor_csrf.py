# Copyright (c) 2026 Flisk Landscape contributors
# SPDX-License-Identifier: MIT
"""The code executor must refuse requests a web page on another origin can send (CSRF / DNS rebinding)."""

import http.client
import json
import sys
import threading
from http.server import HTTPServer
from pathlib import Path

import pytest

IDE = Path(__file__).resolve().parents[2] / "runtime" / "ext" / "ide-components"
sys.path.insert(0, str(IDE / "shared"))
sys.path.insert(0, str(IDE / "code_executor"))

import server as executor  # noqa: E402
from http_utils import SESSION_TOKEN, TOKEN_HEADER  # noqa: E402

BODY = json.dumps({"command": "pwd"})


@pytest.fixture()
def port():
    srv = HTTPServer(("127.0.0.1", 0), executor.CodeExecutorHandler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield srv.server_address[1]
    srv.shutdown()
    srv.server_close()


def post(port, headers, body=BODY):
    c = http.client.HTTPConnection("127.0.0.1", port)
    c.request("POST", "/execute", body, headers)
    r = c.getresponse()
    return r.status, r.getheader("Access-Control-Allow-Origin"), r.read()


def good(port):
    return {
        "Content-Type": "application/json",
        TOKEN_HEADER: SESSION_TOKEN,
        "Origin": f"http://127.0.0.1:{port}",
    }


def test_simple_text_plain_post_is_refused(port):
    status, acao, _ = post(port, {"Content-Type": "text/plain", "Origin": "https://evil.example"})
    assert status in (403, 415)
    assert acao is None


def test_json_without_token_is_refused(port):
    assert post(port, {"Content-Type": "application/json"})[0] == 403


def test_cross_origin_with_token_is_refused(port):
    h = good(port) | {"Origin": "https://evil.example"}
    assert post(port, h)[0] == 403


def test_non_json_content_type_is_refused(port):
    assert post(port, good(port) | {"Content-Type": "text/plain"})[0] == 415


def test_rebound_host_is_refused(port):
    assert post(port, good(port) | {"Host": "evil.example"})[0] == 403


def test_same_origin_with_token_runs(port):
    status, acao, out = post(port, good(port))
    assert status == 200 and acao is None
    assert json.loads(out)["success"] is True


def test_cwd_outside_project_is_refused(port):
    status, _, out = post(port, good(port), json.dumps({"command": "pwd", "cwd": "/"}))
    assert json.loads(out)["success"] is False


def test_page_embeds_token_and_sends_no_cors_header(port):
    c = http.client.HTTPConnection("127.0.0.1", port)
    c.request("GET", "/terminal")
    r = c.getresponse()
    html = r.read().decode()
    assert r.getheader("Access-Control-Allow-Origin") is None
    assert SESSION_TOKEN in html
