# Copyright (c) 2026 Flisk Landscape contributors
# SPDX-License-Identifier: MIT
# =============================================================================
# 🐳 TILT SDK - DOCKER NETWORK MANAGEMENT
# =============================================================================


def fix_docker_networks(platform_networks):
    """
    Generates a shell command that:
    1. Lists the existing Docker networks once (`docker network ls`), then per platform
       network: removes it if it exists with incorrect labels (created by compose),
       creates it if it is missing, and leaves it alone if it is already correct
    2. Fails with Docker's own error if a missing network cannot be created
    """
    commands = []
    commands.append('echo "Initializing Docker networks..."')

    if platform_networks:
        # One listing answers for every network; if it fails, _existing stays empty and
        # the loop degrades to plain creates, which keep the failure reporting below.
        commands.append('_existing="$(docker network ls --format \'{{.Name}} {{.Labels}}\' 2>/dev/null || true)"')

        loop = 'for _n in ' + ' '.join(platform_networks) + '; do '
        loop += '_line="$(printf \'%s\\n\' "$_existing" | awk -v n="$_n" \'$1 == n { print; exit }\')"; '
        loop += 'case "$_line" in '
        loop += '*com.docker.compose*) echo "Removing network $_n with incorrect labels..."; docker network rm "$_n" 2>/dev/null;; '
        loop += '?*) continue;; '
        loop += 'esac; '
        # A failed create is an error unless the network exists afterwards (already
        # there, or another process created it first). Docker's own message is printed
        # and the command exits non-zero, so Tilt marks init-networks failed.
        loop += 'if _out=$(docker network create "$_n" 2>&1); then echo "Created network $_n"; '
        loop += 'elif docker network inspect "$_n" >/dev/null 2>&1; then :; '
        loop += 'else echo "Failed to create Docker network $_n: $_out" >&2; exit 1; fi; '
        loop += 'done'
        commands.append(loop)

    commands.append('echo "Docker networks initialized"')

    return ' && '.join(commands)


def cleanup_docker_networks(platform_networks):
    """
    Generates a shell command to forcefully remove all platform networks.
    WARNING: This will disconnect all containers from these networks first!
    """
    commands = []
    commands.append('echo "Cleaning up Docker networks..."')

    for network in platform_networks:
        disconnect_cmd = 'for c in $(docker network inspect ' + network + ' -f "{{range .Containers}}{{.Name}} {{end}}" 2>/dev/null); do '
        disconnect_cmd += 'docker network disconnect -f ' + network + ' "$c" 2>/dev/null || true; done'
        commands.append(disconnect_cmd)
        commands.append('docker network rm ' + network + ' 2>/dev/null || true')

    commands.append('echo "Docker networks cleaned up"')

    return ' && '.join(commands)
