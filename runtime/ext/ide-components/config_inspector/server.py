#!/usr/bin/env python3
# Copyright (c) 2026 Flisk Landscape contributors
# SPDX-License-Identifier: MIT
"""
Tilt IDE Config Inspector
Compare master configs and auto-generated outputs at http://localhost:9767

Features:
- Multi-pane comparison (1-3 configs side-by-side)
- Edit mode with safe file saving
- Sync scroll support
- Keyboard shortcuts (Ctrl+S, Ctrl+Shift+S, Ctrl+E)

The handler only routes. Config discovery lives in configs.py, HTML
rendering in views.py and save handling in save.py. The front-end is
served from static/inspector.js and static/inspector.css.
"""

import secrets
import sys
import urllib.parse
from pathlib import Path

# Add shared modules
sys.path.insert(0, str(Path(__file__).parent.parent / 'shared'))
from config_service import ConfigService
from http_utils import BaseIDEHandler, run_server

import configs
import save
import views

PORT = 9767

INSPECTOR_CSS_LINK = '  <link rel="stylesheet" href="/static/inspector.css">\n</head>'


class ConfigInspectorHandler(BaseIDEHandler):
    """HTTP request handler for config inspector"""

    # CSRF token storage (in-memory, per-server-instance)
    csrf_tokens = set()

    # GET routes: URL path -> handler method name
    GET_ROUTES = {
        '/health': '_handle_health',
        '/api/masters': '_handle_masters',
        '/api/config': '_handle_config',
    }

    # POST routes: URL path -> save function returning (payload, status)
    POST_ROUTES = {
        '/save': save.save_single,
        '/save-all': save.save_all,
    }

    def generate_csrf_token(self) -> str:
        """Generate and store a new CSRF token"""
        token = secrets.token_urlsafe(32)
        self.csrf_tokens.add(token)
        # Keep token set from growing too large
        if len(self.csrf_tokens) > 1000:
            self.csrf_tokens.clear()
        return token

    def validate_csrf_token(self, token: str) -> bool:
        """Validate a CSRF token"""
        if not token:
            return False
        referer = self.headers.get('Referer', '')
        origin = self.headers.get('Origin', '')
        is_valid, _ = ConfigService.validate_csrf_token(token, referer, origin)
        return is_valid

    def _get_template_path(self) -> Path:
        """Override to use shared template"""
        return Path(__file__).parent.parent / 'shared' / 'templates' / 'base.html'

    def do_GET(self):
        """Handle GET requests"""
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)

        route_name = self.GET_ROUTES.get(parsed.path)
        if route_name:
            getattr(self, route_name)(query)
            return

        # Static files
        if parsed.path.startswith('/static/'):
            views.serve_static(self, parsed.path)
            return

        # Main page or compare view
        if parsed.path in ('/', '/compare'):
            self._handle_main_page(query)
            return

        self._handle_not_found()

    def do_POST(self):
        """Handle POST requests for save operations"""
        parsed = urllib.parse.urlparse(self.path)

        data, error = save.read_post_body(self)
        if error is not None:
            self.send_json_response(*error)
            return

        # Validate CSRF token
        csrf_token = data.get('csrf_token', '')
        if not self.validate_csrf_token(csrf_token):
            self.send_json_response({'success': False, 'message': 'Invalid CSRF token'}, 403)
            return

        # Dispatch to the matching save handler
        save_handler = self.POST_ROUTES.get(parsed.path)
        if save_handler is None:
            self.send_json_response({'success': False, 'message': 'Unknown endpoint'}, 404)
            return

        self.send_json_response(*save_handler(data))

    def _handle_health(self, query: dict):
        """GET /health: service health check"""
        self.handle_health_check('config-inspector', ['multi-pane', 'edit-mode', 'sync-scroll'])

    def _handle_masters(self, query: dict):
        """GET /api/masters: list all master configs"""
        master_configs = configs.discover_master_configs()
        self.send_json_response({
            'status': 'ok',
            'count': len(master_configs),
            'configs': master_configs
        })

    def _handle_config(self, query: dict):
        """GET /api/config?path=...: return a single config's content"""
        config_path = query.get('path', [''])[0]
        if not config_path:
            self.send_json_response({'status': 'error', 'message': 'Missing path parameter'}, 400)
            return

        content, content_hash = configs.read_file_content(config_path)
        if content is None:
            self.send_json_response({'status': 'error', 'message': f'Config not found: {config_path}'}, 404)
            return

        self.send_json_response({
            'status': 'ok',
            'path': config_path,
            'content': content,
            'hash': content_hash
        })

    def _handle_main_page(self, query: dict):
        """GET / or /compare: render the inspector page"""
        master_configs = configs.discover_master_configs()

        # Parse multi-master parameters
        selected_paths, error_msg = configs.parse_multi_master_params(query)

        if error_msg:
            self._send_param_error(master_configs, error_msg)
            return

        # Get edit and sync params
        edit_mode = query.get('edit', ['false'])[0].lower() == 'true'
        sync_scroll = query.get('sync', ['false'])[0].lower() == 'true'

        # If no selection, use first config as default
        if not selected_paths and master_configs:
            # Prefer Project Root configs first
            root_configs = [c for c in master_configs if c['category'] == 'Project Root']
            selected_paths = [(root_configs or master_configs)[0]['path']]

        # Build page sections
        sidebar = views.render_config_tree(master_configs, selected_paths)
        csrf_token = self.generate_csrf_token()
        header_controls = views.render_header_controls(edit_mode, sync_scroll, bool(selected_paths))

        if selected_paths:
            content_html = views.render_multi_pane_view(
                selected_paths, edit_mode, sync_scroll, csrf_token
            )
        else:
            content_html = views.render_empty_state('⚙️', 'No master configs found')

        # Check service status for other IDE components
        resource_status = views.check_resource_status()

        # Build the complete page (front-end loads from static/)
        page = self.render_page(
            'Config Inspector',
            content_html,
            icon='⚙️',
            sidebar=sidebar,
            controls=header_controls,
            scripts='<script src="/static/inspector.js"></script>'
        )

        # Add resource status placeholders if they exist in template
        for name in ('files', 'viewer', 'terminal'):
            page = page.replace(
                f'{{{name}_available}}',
                'true' if resource_status.get(name) else 'false'
            )

        # Only the template's real </head> may be replaced (count=1): pane
        # content can contain the literal string inside window.PANE_DATA
        page = page.replace('</head>', INSPECTOR_CSS_LINK, 1)

        self.send_html_response(page)

    def _send_param_error(self, master_configs: list, error_msg: str):
        """Render the main page showing a parameter validation error"""
        sidebar = views.render_config_tree(master_configs)
        error_html = views.render_empty_state('❌', self.escape_html(error_msg))
        csrf_token = self.generate_csrf_token()
        page = self.render_page(
            'Config Inspector',
            error_html,
            icon='⚙️',
            sidebar=sidebar,
            scripts=f'<script>window.CSRF_TOKEN = "{csrf_token}";</script>'
        )
        self.send_html_response(page.replace('</head>', INSPECTOR_CSS_LINK, 1))

    def _handle_not_found(self):
        """Render the 404 page"""
        self.send_html_response(self.render_page(
            'Not Found',
            '<div class="empty-state"><div class="empty-state-icon">❓</div>Page not found</div>',
            icon='❓'
        ), 404)


def main():
    """Run the config inspector server"""
    run_server(
        ConfigInspectorHandler,
        PORT,
        '⚙️  Tilt IDE Config Inspector',
        '🔍 Compare master .star configs with auto-generated outputs\n   ✏️  Multi-pane editing with Ctrl+S, Ctrl+Shift+S, Ctrl+E'
    )


if __name__ == '__main__':
    main()
