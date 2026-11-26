# Copyright (c) 2026 Flisk Landscape contributors
# SPDX-License-Identifier: MIT
import os


def _confined(path, suffixes):
    """Resolve path and require it to be an existing file with an allowed suffix inside the working directory or FLISK_PROJECT_ROOT."""
    if "\0" in path:
        return None
    resolved = os.path.realpath(path)
    roots = [os.path.realpath(os.getcwd())]
    if os.environ.get("FLISK_PROJECT_ROOT"):
        roots.append(os.path.realpath(os.environ["FLISK_PROJECT_ROOT"]))
    inside = any(os.path.commonpath([root, resolved]) == root for root in roots)
    if not inside or not resolved.lower().endswith(suffixes) or not os.path.isfile(resolved):
        return None
    return resolved
