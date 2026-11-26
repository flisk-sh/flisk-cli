#!/usr/bin/env python3
# Copyright (c) 2026 Flisk Landscape contributors
# SPDX-License-Identifier: MIT
"""
Save request handling for the Config Inspector.

read_post_body validates Content-Length and decodes the JSON body.
Each save function takes the decoded body and returns a
(payload, http_status) pair; the handler sends the response.
"""

import json
import sys
from pathlib import Path
from typing import Optional, Tuple

# Add shared modules
sys.path.insert(0, str(Path(__file__).parent.parent / 'shared'))
from config_service import ConfigService

from configs import validate_url_path


def read_post_body(handler) -> Tuple[Optional[dict], Optional[Tuple[dict, int]]]:
    """
    Read and validate a POST body: Content-Length, then JSON.

    Returns (data, None) on success or (None, (payload, status)) when the
    request should be rejected with that response.
    """
    # Validate Content-Length header for DoS prevention
    content_length = handler.headers.get('Content-Length')
    is_valid, msg = ConfigService.validate_request_content_length(content_length)
    if not is_valid:
        return None, ({'success': False, 'message': f'Invalid request: {msg}'}, 400)

    # Read request body
    body = handler.rfile.read(int(content_length)).decode('utf-8')

    try:
        return json.loads(body), None
    except json.JSONDecodeError:
        return None, ({'success': False, 'message': 'Invalid JSON in request body'}, 400)


def save_single(data: dict) -> Tuple[dict, int]:
    """Handle a single file save"""
    file_path = data.get('path', '')
    content = data.get('content', '')
    original_hash = data.get('original_hash', '')

    # Validate path
    is_valid, msg = validate_url_path(file_path)
    if not is_valid:
        return {'success': False, 'message': f'Invalid path: {msg}'}, 400

    # Validate file type
    is_valid, msg = ConfigService.validate_file_type(file_path)
    if not is_valid:
        return {'success': False, 'message': msg}, 400

    # Resolve path
    resolved = ConfigService.validate_write_path(file_path)
    if not resolved:
        return {'success': False, 'message': 'Path validation failed'}, 400

    # Perform atomic write
    result = ConfigService.atomic_write(resolved, content, original_hash, create_backup=True)

    # Compute new hash if successful
    new_hash = None
    if result.success:
        new_hash = ConfigService.compute_content_hash(content)

    payload = {
        'success': result.success,
        'message': result.message,
        'new_hash': new_hash,
        'backup_path': str(result.backup_path) if result.backup_path else None
    }
    return payload, 200 if result.success else 409


def _save_one(file_data: dict) -> dict:
    """Validate and save one file entry; returns its result record"""
    file_path = file_data.get('path', '')
    content = file_data.get('content', '')
    original_hash = file_data.get('original_hash', '')

    is_valid, msg = validate_url_path(file_path)
    if not is_valid:
        return {'path': file_path, 'success': False, 'message': f'Invalid path: {msg}'}

    is_valid, msg = ConfigService.validate_file_type(file_path)
    if not is_valid:
        return {'path': file_path, 'success': False, 'message': msg}

    resolved = ConfigService.validate_write_path(file_path)
    if not resolved:
        return {'path': file_path, 'success': False, 'message': 'Path validation failed'}

    result = ConfigService.atomic_write(resolved, content, original_hash, create_backup=True)
    return {
        'path': file_path,
        'success': result.success,
        'message': result.message,
        'new_hash': ConfigService.compute_content_hash(content) if result.success else None
    }


def save_all(data: dict) -> Tuple[dict, int]:
    """Handle a batch save of multiple files"""
    files = data.get('files', [])

    if not isinstance(files, list):
        return {'success': False, 'message': 'Invalid request: files must be an array'}, 400

    results = [_save_one(file_data) for file_data in files]
    all_success = all(r['success'] for r in results)

    payload = {
        'success': all_success,
        'message': f'{sum(1 for r in results if r["success"])}/{len(results)} files saved',
        'results': results
    }
    return payload, 200 if all_success else 207  # 207 Multi-Status for partial success
