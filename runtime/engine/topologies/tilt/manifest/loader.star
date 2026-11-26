# Copyright (c) 2026 Flisk Landscape contributors
# SPDX-License-Identifier: MIT
# =============================================================================
# 📋 MANIFEST MODULE - MINIMAL LOADER
# =============================================================================
# Loads JSON manifests (developer-defined) - source of truth
# YAML is generated for Tilt resource tracking only, not for data parsing
# =============================================================================

# === INLINED CONSTANTS for pure extension loading ===
BASE_PORT_FRONTEND = 3000
BASE_PORT_BACKEND = 4000

# Inlined for pure extension loading
def get_synthesis_config():
    return {}

HEALTH_CHECK_PATH = "/health"
DEFAULTS = {}

# === END INLINED CONSTANTS ===


load('../../../../discovery/native_windows.star', 'is_abs_path')
load("./parser.star", "generated_string_error", "normalize_depends_on")
load("./constants.star",
    "MANIFEST_FILENAME",
    "MANIFEST_DEFAULTS",
    "VALID_APP_TYPES",
    "DEFAULT_SYNCS",
)



def load_from_file(path):
    """Load a manifest file.
    
    JSON files are the source of truth (developer-defined).
    YAML files are generated from JSON for Tilt resource tracking only.
    """
    # Prepend project root to relative paths for correct resolution
    project_root = os.environ.get('FLISK_PROJECT_ROOT', '')
    if project_root and not is_abs_path(path):
        full_path = project_root + '/' + path
    else:
        full_path = path
    
    content_raw = read_file(full_path, default="")
    content = str(content_raw)  # Convert blob to string
    if not content:
        return struct(manifest=None, error="File not found: " + path)
    
    manifest = None
    
    # JSON files: parse directly (source of truth)
    if path.endswith('.json'):
        manifest = decode_json(content)
        if manifest == None:
            return struct(manifest=None, error="Failed to parse JSON: " + path)
    elif path.endswith('.yaml') or path.endswith('.yml'):
        # YAML files should not be parsed for data - they are for Tilt resource tracking only
        # Return error to indicate JSON should be used instead
        return struct(manifest=None, error="YAML files are for Tilt resource tracking only. Use JSON for data: " + path.replace('.yaml', '.json').replace('.yml', '.json'))
    else:
        # Try JSON parsing
        manifest = decode_json(content)
    
    if manifest == None:
        return struct(manifest=None, error="Invalid manifest: " + path)

    # Refuse service.json values that would add keys to generated config (GHSA-phgf-pww4-7jxc). Every Tilt discovery path loads service.json here.
    if type(manifest) == "dict":
        unsafe_field_error = generated_string_error(manifest, path)
        if unsafe_field_error:
            fail(unsafe_field_error)
        normalize_depends_on(manifest, path)
    
    # An `mcp` resource is a Model Context Protocol server: an HTTP service on Bun that is built, routed and health-checked
    # exactly like a backend. Every backend code path keys off appType == 'backend', so normalise here, once, at the single
    # place a service.json becomes a manifest, and keep a flag so the original type is not lost.
    if type(manifest) == "dict" and manifest.get("appType") == "mcp":
        manifest["appType"] = "backend"
        manifest["mcp"] = True

    # An `agent` resource is a long-running AI agent: a Bun HTTP service (/health, /ready, SIGTERM drain) that is built, routed
    # and health-checked as a backend, so it reuses the backend code paths and boots health-gated. Its settings are kept under
    # manifest["agent"] for the generators (state volume, AGENT_* environment), with durability defaulting to files.
    if type(manifest) == "dict" and manifest.get("appType") == "agent":
        agent = dict(manifest.get("agent") or {})
        agent["durability"] = agent.get("durability") or "files"
        manifest["appType"] = "backend"
        manifest["agent"] = agent
    
    return struct(manifest=manifest, error=None)

def _synthesize_manifest(resource_path, stack, app_type):
    """
    Synthesize a manifest from directory structure.
    
    Used when no manifest file exists. Extracts configuration from:
    - Stack: extracted from path (services/product/{stack}/...)
    - App type: extracted from resource name suffix (-backend, -frontend, etc.)
    
    Ports are computed from master config per appType - Traefik handles routing.
    """
    # Get resource name from path
    path_parts = resource_path.split("/")
    resource_name = path_parts[-1] if path_parts else "unknown"
    
    # Get synthesis config from master config
    synthesis_config = get_synthesis_config()
    
    # Determine port based on app type from synthesis defaults
    port_defaults = synthesis_config.get("synthesis_port_defaults", {})
    port = port_defaults.get(app_type, BASE_PORT_BACKEND)  # default to backend port
    
    # Build synthesized manifest
    manifest = {
        "appName": resource_name,
        "appType": app_type,
        "stack": stack,
        "port": port,
        "_synthesized": True,  # Mark as synthesized
        "_synthesized_from": resource_path,
    }
    
    # Add backendName for frontends using master config pattern
    if app_type == "frontend":
        backend_pattern = synthesis_config.get("backend_name_pattern", "{stack}-management-backend")
        manifest["backendName"] = backend_pattern.format(stack=stack)
    
    return manifest

def _get_manifest_filename(resource_path):
    """
    Determine if manifest exists for resource path.
    
    Returns: filename if exists, None otherwise (triggers synthesis)
    """
    # Prepend project root to relative paths for correct resolution
    project_root = os.environ.get('FLISK_PROJECT_ROOT', '')
    if project_root and not is_abs_path(resource_path):
        base_path = project_root + '/' + resource_path
    else:
        base_path = resource_path
    
    # Check for manifest file
    manifest_path = base_path + "/" + MANIFEST_FILENAME
    content = read_file(manifest_path, default="")
    if content:
        return MANIFEST_FILENAME
    
    # No manifest file - will trigger synthesis
    return None

def load_from_path(resource_path):
    """
    Load manifest from resource directory with synthesis fallback.
    
    Priority:
    1. Load service.json if it exists
    2. Synthesize from directory structure if no manifest exists
    
    Args:
        resource_path: Path to resource directory
    
    Returns:
        struct with manifest and error fields
    """
    # Determine if manifest exists
    manifest_filename = _get_manifest_filename(resource_path)
    
    if manifest_filename:
        # Load existing manifest
        json_path = resource_path + "/" + manifest_filename
        result = load_from_file(json_path)
        
        if result.error:
            return result
        
        return result
    else:
        # No manifest file - synthesize from directory structure
        # Extract stack from path (services/product/{stack}/...)
        path_parts = resource_path.split("/")
        stack = "unknown"
        for i, part in enumerate(path_parts):
            if part == "product" and i + 1 < len(path_parts):
                stack = path_parts[i + 1]
                break
            elif part == "platform" and i + 1 < len(path_parts):
                stack = "platform"
                break
        
        # Extract app type from resource name
        resource_name = path_parts[-1] if path_parts else "unknown"
        app_type = "backend"  # default
        if resource_name.endswith("-frontend"):
            app_type = "frontend"
        elif resource_name.endswith("-sdk"):
            app_type = "sdk"
        elif resource_name.endswith("-migrator"):
            app_type = "migrator"
        elif resource_name.endswith("-worker"):
            app_type = "worker"
        elif resource_name.endswith("-library"):
            app_type = "library"
        
        # Synthesize manifest
        manifest = _synthesize_manifest(resource_path, stack, app_type)
        
        print("📝 Synthesized manifest for: " + resource_name)
        print("   Stack: " + stack + ", Type: " + app_type + ", Port: " + str(manifest["port"]))
        
        return struct(manifest=manifest, error=None)

def get_manifest_filename():
    """
    Get the manifest filename.

    Returns:
        String: "service.json"
    """
    return MANIFEST_FILENAME

def get_manifest_search_order():
    """
    Get the priority order for manifest discovery.

    Returns:
        List of filenames in search order (currently only service.json)
    """
    return [MANIFEST_FILENAME]

def get_manifest_path(resource_path):
    """
    Get the manifest file path for a resource directory.

    Args:
        resource_path: Path to the resource directory

    Returns:
        String: "<resource_path>/service.json"
    """
    return resource_path.rstrip("/") + "/" + MANIFEST_FILENAME

# Cache of manifests loaded by load_all(), keyed by resolved file path.
_MANIFEST_CACHE = {}

def _cache_key(path):
    project_root = os.environ.get('FLISK_PROJECT_ROOT', '')
    if project_root and not is_abs_path(path):
        return project_root + '/' + path
    return path

def is_cached(path):
    """True if a manifest file path is in the load_all cache."""
    return _cache_key(path) in _MANIFEST_CACHE

def clear_cache():
    """Drop every manifest cached by load_all."""
    _MANIFEST_CACHE.clear()

def get_cache_stats():
    """Return cache statistics (entries: number of cached manifests)."""
    return {"entries": len(_MANIFEST_CACHE)}

def _matches_filters(manifest, filters):
    """Every key/value in filters must match; 'features' must all be present."""
    if not filters:
        return True
    for key, want in filters.items():
        if key == "features":
            have = manifest.get("features", [])
            if type(have) != "list" or len([f for f in want if f not in have]):
                return False
        elif manifest.get(key) != want:
            return False
    return True

def load_all(services_root, filters=None):
    """
    Scan a directory tree for service.json manifests and load each one.

    Args:
        services_root: Root directory to scan recursively
        filters: Optional dict of manifest fields to match (e.g. appType,
            stack); "features" requires every listed feature

    Returns:
        struct(
            manifests=[],  # List of loaded manifest dicts (each with _resource_path)
            errors=[],     # List of load error strings
            stats={},      # Loading statistics
        )
    """
    manifests = []
    errors = []
    project_root = os.environ.get('FLISK_PROJECT_ROOT', '')
    if project_root and not is_abs_path(services_root):
        full_root = project_root + '/' + services_root
    else:
        full_root = services_root
    root = services_root.rstrip('/')
    for path in sorted(listdir(full_root, recursive=True)):
        if not path.endswith('/' + MANIFEST_FILENAME):
            continue
        rel = path[len(full_root.rstrip('/')):].lstrip('/')
        if rel == MANIFEST_FILENAME:
            sub = ''
        else:
            sub = rel[:-len('/' + MANIFEST_FILENAME)]
        result = load_from_file(path)
        if result.error:
            errors.append(result.error)
            continue
        manifest = result.manifest
        if type(manifest) != "dict":
            errors.append("Invalid manifest type: " + path)
            continue
        manifest['_resource_path'] = root + '/' + sub if sub else root
        _MANIFEST_CACHE[_cache_key(path)] = result
        if _matches_filters(manifest, filters):
            manifests.append(manifest)
    return struct(
        manifests=manifests,
        errors=errors,
        stats={"loaded": len(manifests), "errors": len(errors)},
    )

# Enhanced loader with synthesis support
ManifestLoader = struct(
    load_from_file=load_from_file,
    load_from_path=load_from_path,
    load_all=load_all,
    get_filename=get_manifest_filename,
    get_search_order=get_manifest_search_order,
    get_manifest_path=get_manifest_path,
    is_cached=is_cached,
    clear_cache=clear_cache,
    get_cache_stats=get_cache_stats,
)