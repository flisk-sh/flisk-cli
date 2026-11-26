# Copyright (c) 2026 Flisk Landscape contributors
# SPDX-License-Identifier: MIT
"""Tests for the service.json change-detection hashes."""

import hashlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path("runtime/discovery").resolve()))
from resource_snapshot import compute_resource_hash, compute_services_hash


def test_resource_hash_is_truncated_sha256(tmp_path):
    manifest = tmp_path / "service.json"
    manifest.write_bytes(b'{"appName": "api"}')
    assert compute_resource_hash(str(manifest)) == hashlib.sha256(b'{"appName": "api"}').hexdigest()[:16]


def test_resource_hash_changes_with_content(tmp_path):
    manifest = tmp_path / "service.json"
    manifest.write_text('{"port": 1}')
    before = compute_resource_hash(str(manifest))
    manifest.write_text('{"port": 2}')
    assert compute_resource_hash(str(manifest)) != before


def test_resource_hash_missing_file_is_none(tmp_path):
    assert compute_resource_hash(str(tmp_path / "missing.json")) is None


def test_services_hash_is_16_hex_chars(tmp_path):
    manifest = tmp_path / "service.json"
    manifest.write_text("{}")
    assert len(compute_services_hash([str(manifest)])) == 16
