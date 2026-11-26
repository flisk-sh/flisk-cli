#!/usr/bin/env python3
# Copyright (c) 2026 Flisk Landscape contributors
# SPDX-License-Identifier: MIT
"""
HTML rendering helpers for the Config Inspector.

Builds the sidebar config tree, the multi-pane comparison view and the
header controls. All functions return HTML strings; the handler decides
where they go on the page.
"""

import json
import socket
import sys
import urllib.parse
from pathlib import Path

# Add shared modules
sys.path.insert(0, str(Path(__file__).parent.parent / 'shared'))
from http_utils import escape_html

from configs import read_file_content

# MIME types for files served from the static directories
STATIC_CONTENT_TYPES = {
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.html': 'text/html',
}


def serve_static(handler, request_path: str):
    """Serve a file from this component's static/ dir, else shared/static/"""
    rel = urllib.parse.unquote(request_path)[len('/static/'):]
    static_dirs = [
        Path(__file__).parent / 'static',
        Path(__file__).parent.parent / 'shared' / 'static',
    ]
    for static_dir in static_dirs:
        candidate = static_dir / rel
        try:
            candidate.resolve().relative_to(static_dir.resolve())
        except ValueError:
            continue
        if candidate.is_file():
            content_type = STATIC_CONTENT_TYPES.get(candidate.suffix.lower(), 'text/plain')
            body = candidate.read_text(encoding='utf-8')
            handler.send_response(200)
            handler.send_header('Content-Type', content_type)
            handler.end_headers()
            handler.wfile.write(body.encode())
            return
    handler.send_error_response(404, 'Not found')


def check_resource_status() -> dict:
    """Check if the other IDE services the page links to are running"""
    services = {
        'files': {'host': 'localhost', 'port': 9765},
        'viewer': {'host': 'localhost', 'port': 9766},
        'terminal': {'host': 'localhost', 'port': 9768},
    }
    status = {}
    for name, info in services.items():
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(0.5)
            result = sock.connect_ex(('127.0.0.1', info['port']))
            sock.close()
            status[name] = result == 0
        except Exception:
            status[name] = False
    return status


def render_empty_state(icon: str, message: str) -> str:
    """Render an empty/error state block"""
    return f'<div class="empty-state"><div class="empty-state-icon">{icon}</div><p>{message}</p></div>'


def _render_tree_item(cfg: dict, selected_paths: list) -> str:
    """Render a single config tree entry with multi-select support"""
    is_selected = cfg['path'] in selected_paths
    selection_order = ''
    if is_selected:
        order = selected_paths.index(cfg['path']) + 1
        selection_order = f'<span class="selection-order">{order}</span>'

    active_class = 'active' if is_selected else ''
    encoded_path = urllib.parse.quote(cfg['path'])
    current_count = len(selected_paths) if selected_paths else 0

    return f'''
        <li class="tree-item {active_class}" onclick="handleConfigClick(event, '{encoded_path}', {current_count})">
            <span>⭐</span>
            <span>{cfg['name']}</span>
            {selection_order}
        </li>
    '''


def render_config_tree(configs: list, selected_paths: list = None) -> str:
    """Render config tree navigation with multi-select support."""
    if selected_paths is None:
        selected_paths = []

    current_category = None
    html = ['<ul class="config-tree">']

    for cfg in configs:
        # Category header
        if cfg['category'] != current_category:
            if current_category:
                html.append('</ul></li>')
            current_category = cfg['category']
            html.append(f'<li class="config-category"><strong class="config-category-title">{current_category}</strong><ul class="config-category-items">')

        html.append(_render_tree_item(cfg, selected_paths))

    if current_category:
        html.append('</ul></li>')

    html.append('</ul>')
    return ''.join(html)


def _render_pane(path: str, index: int, num_panes: int, edit_mode: bool, pane_data: list) -> str:
    """Render one comparison pane and record its data for the front-end"""
    content, content_hash = read_file_content(path)
    pane_data.append({
        'path': path,
        'content': content,
        'hash': content_hash,
        'index': index
    })

    # Determine unsaved status (will be tracked client-side)
    unsaved_indicator = '<span class="unsaved-indicator hidden">●</span>'

    # Render content based on edit mode
    if edit_mode:
        # Editable textarea with HTML-escaped content
        escaped_content = escape_html(content)
        content_html = f'''
            <textarea class="config-editor"
                      data-path="{escape_html(path)}"
                      data-hash="{content_hash or ''}"
                      data-pane="{index}"
                      spellcheck="false">{escaped_content}</textarea>
        '''
    else:
        # Read-only pre/code view
        content_html = f'<pre class="config-viewer" data-pane="{index}"><code>{escape_html(content)}</code></pre>'

    return f'''
        <div class="panel pane-{index}" data-pane="{index}">
            <div class="panel-header">
                <div class="panel-header-left">
                    <span class="panel-title">⭐ Master Config {index}/{num_panes}</span>
                    <span class="text-muted panel-path">{path}</span>
                    {unsaved_indicator}
                </div>
                {f'<button class="save-pane-btn hidden" data-pane="{index}" onclick="savePane({index})">💾 Save</button>' if edit_mode else ''}
            </div>
            <div class="panel-content" data-pane="{index}">
                {content_html}
            </div>
        </div>
    '''


def render_multi_pane_view(master_paths: list, edit_mode: bool, sync_scroll: bool, csrf_token: str) -> str:
    """Render multi-pane view for 1-3 master configs."""
    num_panes = len(master_paths)
    if num_panes == 0:
        return render_empty_state('⚙️', 'No master configs selected')

    # Determine grid layout class
    if num_panes == 1:
        grid_class = 'single-pane'
    elif num_panes == 2:
        grid_class = 'dual-pane'
    else:
        grid_class = 'triple-pane'

    # Build panes
    panes_html = []
    pane_data = []

    for i, path in enumerate(master_paths, 1):
        panes_html.append(_render_pane(path, i, num_panes, edit_mode, pane_data))

    # Generate pane data for JavaScript
    pane_data_json = json.dumps(pane_data)

    # Build the multi-pane container
    content_html = f'''
        <div class="multi-pane-view {grid_class}" id="multiPaneView" data-sync="{str(sync_scroll).lower()}">
            {''.join(panes_html)}
        </div>

        <script>
            // Store pane data for JavaScript
            window.PANE_DATA = {pane_data_json};
            window.EDIT_MODE = {'true' if edit_mode else 'false'};
            window.SYNC_SCROLL = {'true' if sync_scroll else 'false'};
            window.CSRF_TOKEN = '{csrf_token}';
        </script>
    '''

    return content_html


def render_header_controls(edit_mode: bool, sync_scroll: bool, has_selection: bool) -> str:
    """Render the header control buttons (sync scroll, edit mode, save all, clear)"""
    edit_toggle_class = 'active' if edit_mode else ''
    sync_checked = 'checked' if sync_scroll else ''
    clear_button = '<button class="clear-selection-btn" onclick="clearSelection()">❌ Clear</button>' if has_selection else ''

    return f'''
        <div class="header-controls">
            <label class="sync-scroll-label">
                <input type="checkbox" id="syncScrollCheckbox" {sync_checked} onchange="toggleSyncScroll()">
                <span>🔗 Sync Scroll</span>
            </label>
            <button class="edit-mode-btn {edit_toggle_class}" id="editModeBtn" onclick="toggleEditMode()" title="Ctrl+E">
                ✏️ Edit Mode
            </button>
            <button class="save-all-btn hidden" id="saveAllBtn" onclick="saveAllPanes()" title="Ctrl+Shift+S">
                💾 Save All
            </button>
            {clear_button}
        </div>
    '''
