# Copyright (c) 2026 Flisk Landscape contributors
# SPDX-License-Identifier: MIT
load("./native_windows.star", "IS_NATIVE_WINDOWS", "is_abs_path")
load("../engine/topologies/tilt/manifest/parser.star", "build_resource", "canonicalize_resource_path")
load("../engine/topologies/tilt/manifest/loader.star", "ManifestLoader")
load("./manifest/loading.star", "get_default_syncs_for_type")

# Out of scope stacks - defined locally for unified repo
OUT_OF_SCOPE_STACKS = ["warehouse", "logistics", "accounting"]

load("./manifest/constants.star", "MANIFEST_FILENAME", "MANIFEST_FILENAME_YAML")

# Phase 1: Use json_manifest_scanner for manifest discovery (enables Phase 2 multi-source discovery)
load("./json_manifest_scanner.star", "discover_json_manifests")
load("./constants.star", 
     "RESOURCES_ROOT",
     "DISCOVERY_SCAN_ROOTS",
     "SCAN_ROOT_PATTERNS",
     "MAX_SCAN_TIMEOUT_MS",
     "MAX_MANIFESTS_PER_ROOT")

# Phase 1.5: Validation integration for stability
load("./validation.star", "validate")

# Phase 2: Root overlap validation (prevents duplicate scanning from misconfiguration)
def _validate_scan_roots(roots):
    """Ensure no root is a subdirectory of another."""
    sorted_roots = sorted(roots, key=len)
    for i, root in enumerate(sorted_roots):
        for other in sorted_roots[i+1:]:
            root_normalized = root.rstrip("/") + "/"
            other_normalized = other.rstrip("/") + "/"
            if other_normalized.startswith(root_normalized):
                print("⚠️  Warning: {} is subdirectory of {}".format(other, root))

def _to_project_relative_path(path, project_root):
    """Return path relative to project_root (supports ../ out-of-tree siblings).

    Absolute find() results used to be "normalized" by stripping a leading '/',
    which turned `/private/var/.../platform/verdaccio` into a fake in-repo path
    `private/var/.../platform/verdaccio` and broke Docker COPY checksums.
    """
    if not path:
        return path
    root = project_root if project_root else os.environ.get("FLISK_PROJECT_ROOT", ".")
    # Already project-relative (including ../sibling/...)
    has_drive = IS_NATIVE_WINDOWS and len(path) > 1 and path[1] == ":"
    if not path.startswith("/") and not has_drive:
        return path
    if IS_NATIVE_WINDOWS:
        return os.path.relpath(path, root).replace("\\", "/")
    cmd = [
        "python3",
        "-c",
        "import os, sys; print(os.path.relpath(os.path.realpath(sys.argv[1]), os.path.realpath(sys.argv[2])))",
        path,
        root,
    ]
    relative = str(local(cmd, quiet=True, echo_off=True)).strip()
    if relative:
        return relative
    # Fallback: strip project_root prefix if present
    root_prefix = root.rstrip("/") + "/"
    if path.startswith(root_prefix):
        return path[len(root_prefix):]
    return path.lstrip("/")

# Built-in functions available in Tilt (no load needed)
# read_json, local are built-in

def normalize_manifest(manifest, resource_path):
    """
    Normalize manifest to discovery resource format.
    Phase 5: Works with both legacy and new manifest system normalized manifests.

    Thin wrapper kept for external callers; every resource dict goes through
    build_resource() so the dockerfile/syncs/stack fields cannot drift.
    """
    return build_resource(manifest, resource_path, get_default_syncs_for_type)


def _get_stack_path(stack):
    return "services/product/" + stack


def initialize_discovery(cache):
    """
    Initialize discovery cache by scanning for manifest files.

    Args:
        cache: Dictionary to populate with discovery data
    """
    if cache.get("initialized"):
        return

    # Scan for resources from JSON manifests (source of truth)
    # YAML files are only for Tilt resource tracking, not data parsing
    print("  1.1 Scanning service manifests...")

    resources = _scan_resources()
    
    # Build dependency graph and aliases
    dependencies = {}
    aliases = {}
    path_map = {}
    
    for resource in resources:
        name = resource.get("name", "")
        path = resource.get("path", "")
        
        # Map name to path
        if name:
            aliases[name] = path
            path_map[path] = name
            
            # Extract dependencies from manifest
            manifest = resource.get("_manifest", {})
            deps = manifest.get("dependsOn", [])
            if deps:
                dependencies[name] = deps
    
    # Populate cache
    cache["app_resources"] = resources
    cache["resource_dependencies"] = dependencies
    cache["resource_aliases"] = aliases
    cache["resource_path_map"] = path_map
    cache["stack_configs"] = {}
    cache["initialized"] = True


def _scan_resources():
    """
    FIRST PASS: Scan for all resources with JSON manifest files from multiple roots.
    Phase 2: Multi-root discovery with validation, deduplication, and explicit stack extraction.
    Returns list of resource dictionaries.
    """
    resources = []
    
    # Phase 1.5: Track validation stats and skipped stacks for discovery summary
    validation_stats = {
        "total_manifests": 0,
        "valid_manifests": 0,
        "manifests_with_warnings": 0,
        "total_warnings": 0,
    }
    skipped_stacks = {}  # Track skipped stacks for summary
    
    # Phase 2: Validate scan roots don't overlap (prevents duplicate scanning)
    _validate_scan_roots(DISCOVERY_SCAN_ROOTS)
    
    # Phase 2: Scan all root directories and collect manifest paths
    all_manifest_paths = []  # Collect from all roots
    
    # Scan all root directories (quiet unless verbose)
    total_roots = len(DISCOVERY_SCAN_ROOTS)
    
    for root in DISCOVERY_SCAN_ROOTS:
        # Use json_manifest_scanner.discover_json_manifests() to find all manifest files
        paths = discover_json_manifests(root)
        
        if paths:
            # Phase 2: Performance guardrails - warn if root is too large
            if len(paths) > MAX_MANIFESTS_PER_ROOT:
                print("  ⚠️  Large root: {} has {} manifests (max: {})".format(
                    root, len(paths), MAX_MANIFESTS_PER_ROOT))
            
            # Only show in verbose mode
            if os.environ.get('TILT_LOG_LEVEL') == 'verbose':
                print("  📁 Scanned {} manifests from {}".format(len(paths), root))
            all_manifest_paths.extend(paths)
    
    # Phase 2: Deduplicate by path (in case of overlaps between roots)
    seen_paths = {}
    manifest_paths = []
    for path in all_manifest_paths:
        if path not in seen_paths:
            seen_paths[path] = True
            manifest_paths.append(path)

    # CRITICAL FIX: Filter out flisk-cli internal paths to prevent self-scanning
    # This prevents flisk-cli from discovering its own internal test stubs
    def _is_flisk_cli_internal_path(path):
        """Check if path is within flisk-cli's own directory structure."""
        internal_markers = [
            "flisk-cli/discovery/services/",
            "flisk-cli/discovery/identity-",
        ]
        for marker in internal_markers:
            if marker in path:
                return True
        return False

    filtered_manifest_paths = []
    for path in manifest_paths:
        if _is_flisk_cli_internal_path(path):
            print("⚠️  Skipping flisk-cli internal stub: {}".format(path))
            continue
        filtered_manifest_paths.append(path)

    manifest_paths = filtered_manifest_paths

    if not manifest_paths:
        return resources
    
    project_root = os.environ.get("FLISK_PROJECT_ROOT", ".")

    for manifest_path in manifest_paths:
        # manifest_path may be absolute (legacy find) or project-relative.
        # Always rewrite to a path relative to the Flisk project root first.
        manifest_path = _to_project_relative_path(manifest_path, project_root)
        
        # Parse manifest using proper loader (handles JSON and YAML)
        # First, extract service path from manifest path
        full_resource_path = manifest_path.rsplit("/", 1)[0]
        
        # Use the loader which handles both JSON and YAML and normalizes format
        # Loader needs a filesystem path: keep absolute for reads when needed.
        load_path = manifest_path
        if not is_abs_path(load_path):
            load_path = project_root.rstrip("/") + "/" + load_path
        load_result = ManifestLoader.load_from_file(load_path)
        if load_result.error:
            print("Error loading manifest: " + load_result.error)
            continue
        
        manifest = load_result.manifest
        if not manifest:
            continue
        
        # Phase 1.5: Validate manifest structure and content
        validation_stats["total_manifests"] += 1
        validation_issues = validate(manifest)
        if validation_issues:
            validation_stats["manifests_with_warnings"] += 1
            validation_stats["total_warnings"] += len(validation_issues)
            # Log all validation issues with file path for context
            for issue in validation_issues:
                print("⚠️  Validation: " + manifest_path + ": " + issue)
            # Lenient mode: log warnings but continue discovery
            # (Strict mode could fail here with: continue)
        else:
            validation_stats["valid_manifests"] += 1
        
        # Skip out-of-scope stacks for alpha (defined in spec.master)
        stack = manifest.get("stack", "")
        if stack in OUT_OF_SCOPE_STACKS:
            # Track skipped stack for summary instead of printing immediately
            if stack not in skipped_stacks:
                skipped_stacks[stack] = 0
            skipped_stacks[stack] += 1
            continue
        
        # Convert relative path to project-root-relative path
        # manifest_path is like: ../../../../services/product/{domain}/{service}/manifest.json
        # We want: services/product/{domain}/{service}
        if manifest_path.startswith("../../../../"):
            project_relative_path = manifest_path[12:]  # Remove "../../../../" prefix
        else:
            project_relative_path = manifest_path
        
        # Extract service info from the project-relative path
        # Format: services/product/{domain}/{service}/" + MANIFEST_FILENAME, 
        path_parts = project_relative_path.split("/")
        if len(path_parts) < 2:
            continue
        
        # Phase 2: Use explicit stack extraction patterns
        # Determine which root this manifest came from
        matching_root = None
        for root in DISCOVERY_SCAN_ROOTS:
            if manifest_path.startswith(root):
                matching_root = root
                break
        
        # Use configured pattern or default to parent folder
        pattern = SCAN_ROOT_PATTERNS.get(matching_root, {"stack_depth": -2})
        depth = pattern["stack_depth"]
        
        # Extract stack based on configured depth
        if abs(depth) <= len(path_parts):
            stack_dir = path_parts[depth]
        else:
            stack_dir = path_parts[-2] if len(path_parts) >= 2 else ""  # Fallback to parent
        
        # Build paths relative to project root (for use by other modules)
        # Handle both nested paths (services/product/stack/service) and flat paths (identity-*)
        if len(path_parts) >= 3:
            base_path = "/".join(path_parts[:-2])  # e.g., "services/product/users"
        elif len(path_parts) == 2:
            base_path = path_parts[0]  # e.g., "identity-management-backend"
        else:
            base_path = path_parts[0] if path_parts else ""
        resource_path = base_path  # This is the DOMAIN path
        full_resource_path = _to_project_relative_path(
            project_relative_path.rsplit("/", 1)[0],
            project_root,
        )  # Full path to service

        # Worktree and generated-output paths collapse to the project-relative
        # path (one rule, shared with manifest/normalize.star via parser.star).
        full_resource_path = canonicalize_resource_path(full_resource_path)
        resource_path = canonicalize_resource_path(resource_path)

        resource = build_resource(
            manifest,
            full_resource_path,
            get_default_syncs_for_type,
            fallback_stack = stack_dir,
        )
        app_name = resource["name"]
        app_type = manifest.get("appType", "backend")
        stack = resource["stack"]

        # Build resource entry
        resource_key = stack if stack else app_name.replace("-" + app_type, "")
        
        # Check if app resource already exists (merge resources for same stack)
        existing_app_resource = None
        for app_res in resources:
            if app_res["name"] == resource_key:
                existing_app_resource = app_res
                break
        
        if existing_app_resource:
            # Check if resource with same name already exists (prevent duplicates from multiple scan roots)
            resource_exists = False
            for existing_res in existing_app_resource["resources"]:
                if existing_res.get("name") == resource["name"]:
                    resource_exists = True
                    print("   ⚠️  Skipping duplicate resource: " + app_name + " (from " + resource_path + ")")
                    break
            
            if not resource_exists:
                # Add resource to existing app resource
                existing_app_resource["resources"].append(resource)
                existing_app_resource["labels"].append("app." + app_name)
        else:
            # Create new app resource entry
            # Use resource_path (domain path) for the app_resource - docker-compose goes here
            # Individual resources have _resource_path for their specific paths
            app_resource = {
                "name": resource_key,
                "appName": resource_key,
                "path": resource_path,
                "labels": ["app." + app_name] if app_name else [],
                "resources": [resource],
            }
            resources.append(app_resource)
    
    # Phase 1.5: Print consolidated discovery summary
    if validation_stats["total_manifests"] > 0:
        # Calculate total skipped manually (sum() not available in Starlark)
        total_skipped = 0
        for count in skipped_stacks.values():
            total_skipped += count
        print("✅ {} resources loaded ({} valid, {} skipped)".format(
            validation_stats["total_manifests"],
            validation_stats["valid_manifests"],
            total_skipped))
        
        if validation_stats["manifests_with_warnings"] > 0:
            print("  ⚠️  {} manifest(s) with {} validation warning(s)".format(
                validation_stats["manifests_with_warnings"], 
                validation_stats["total_warnings"]))
        
        if skipped_stacks and os.environ.get('TILT_LOG_LEVEL') == 'verbose':
            skipped_list = ", ".join(["{} ({})".format(d, c) for d, c in skipped_stacks.items()])
            print("  📋 Focus mode skipped: {}".format(skipped_list))
    
    
    return resources
