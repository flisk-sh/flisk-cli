# Copyright (c) 2026 Flisk Landscape contributors
# SPDX-License-Identifier: MIT
# =============================================================================
# DISCOVERY SKIP LIST
# =============================================================================
# Keep the folder names in sync with SKIP_DIRECTORIES in
# cli/src/utils/constants.ts. Tilt discovery used to load a service.json from
# any of them, while the CLI walk and the generator validation ignored it;
# filtering every manifest scan here keeps the three views of the project the
# same. As in the CLI, a folder is still searched when discovery.paths names it
# with a literal segment (`vendor/*`, `services/target/*`): a wildcard segment
# does not count, so `services/*/*` or `*/*` never reopens the skipped folder.

load("./constants.star", "DISCOVERY_PATH_PATTERNS")
load("./native_windows.star", "file_exists")

SKIP_DIRECTORIES = [
    "node_modules",
    ".git",
    ".tilt",
    ".tilt-engine",
    "dist",
    "build",
    ".prisma",
    ".turbo",
    "coverage",
    "tmp",
    "temp",
    "__tests__",
    "test",
    "tests",
    ".github",
    ".vscode",
    "docs",
    "target",
    "vendor",
    "__pycache__",
    "venv",
    "env",
    "bin",
    "out",
    "obj",
]

PROJECT_ROOT = os.environ.get("FLISK_PROJECT_ROOT", ".")

def _project_json_patterns():
    """Raw discovery.paths when spec.master is absent (no config regeneration yet)."""
    if not PROJECT_ROOT:
        return []
    config_path = PROJECT_ROOT + "/.flisk/project.json"
    if not file_exists(config_path):
        return []
    config = read_json(config_path)
    if type(config) != "dict":
        return []
    discovery = config.get("discovery", {})
    if type(discovery) != "dict":
        return []
    paths = discovery.get("paths", [])
    if type(paths) != "list":
        return []
    result = []
    for path in paths:
        if type(path) == "string" and path:
            result.append(path)
    return result

DISCOVERY_PATTERNS = []
if DISCOVERY_PATH_PATTERNS:
    DISCOVERY_PATTERNS = DISCOVERY_PATH_PATTERNS
else:
    DISCOVERY_PATTERNS = _project_json_patterns()

def _segments(path):
    """Slash-separated segments relative to the project root, keeping leading `..`."""
    clean = path.replace("\\", "/")
    if clean.startswith("/") or (len(clean) > 1 and clean[1] == ":"):
        clean = os.path.relpath(clean, PROJECT_ROOT).replace("\\", "/")
    result = []
    for part in clean.split("/"):
        if part == "" or part == ".":
            continue
        if part == "..":
            if result and result[-1] != "..":
                result.pop()
            else:
                result.append(part)
        else:
            result.append(part)
    return result

def _star_closure(pattern, states):
    # A * may match nothing, so the state after it is reachable from the star too.
    out = dict(states)
    for _ in range(len(pattern) + 1):
        for i in list(out.keys()):
            if i < len(pattern) and pattern[i] == "*":
                out[i + 1] = True
    return out

def _segment_matches(pattern, text):
    """Shell-style match of one path segment: * matches any run, ? one character."""
    states = _star_closure(pattern, {0: True})
    for j in range(len(text)):
        c = text[j]
        nxt = {}
        for i in states.keys():
            if i >= len(pattern):
                continue
            if pattern[i] == "*":
                nxt[i] = True
            elif pattern[i] == "?" or pattern[i] == c:
                nxt[i + 1] = True
        states = _star_closure(pattern, nxt)
    return len(pattern) in states

def names_directory_literally(segments):
    """True when a discovery.paths pattern names the last segment literally."""
    last = len(segments) - 1
    if last < 0:
        return False
    for pattern in DISCOVERY_PATTERNS:
        pattern_segments = _segments(pattern)
        if len(pattern_segments) <= last or pattern_segments[last] != segments[last]:
            continue
        matches = True
        for i in range(last):
            if not _segment_matches(pattern_segments[i], segments[i]):
                matches = False
                break
        if matches:
            return True
    return False

def is_skipped_path(path):
    """True when any directory on the way to path is a default-skip folder."""
    segments = _segments(path)
    for i in range(len(segments)):
        if segments[i] in SKIP_DIRECTORIES and not names_directory_literally(segments[:i + 1]):
            return True
    return False

def filter_skipped_paths(paths):
    """Drop manifest paths that neither the CLI nor Tilt should discover."""
    result = []
    for path in paths:
        if not is_skipped_path(path):
            result.append(path)
    return result
