# Copyright (c) 2026 Flisk Landscape contributors
# SPDX-License-Identifier: MIT
# =============================================================================
# 📋 MANIFEST MODULE - INTEGRATION TESTS (Phase 2)
# =============================================================================
# Path: .tilt/topologies/tilt/manifest/tests/test_loader_parser.star
# Purpose: Integration tests for loader and parser modules
# Status: Phase 2 of manifest system refactoring
# =============================================================================

load("../__init__.star", "Manifest")
load("../loader.star", "ManifestLoader")
load("../parser.star", "ManifestParser")

# =============================================================================
# TEST FRAMEWORK
# =============================================================================

test_results = {
    'passed': 0,
    'failed': 0,
    'errors': [],
}

def assert_true(condition, message="Assertion failed"):
    """Assert that condition is true."""
    if not condition:
        test_results['failed'] += 1
        test_results['errors'].append("FAIL: " + message)
    else:
        test_results['passed'] += 1

def assert_equal(expected, actual, message="Values not equal"):
    """Assert that expected equals actual."""
    if expected != actual:
        test_results['failed'] += 1
        test_results['errors'].append(
            "FAIL: {} - expected '{}', got '{}'".format(message, expected, actual)
        )
    else:
        test_results['passed'] += 1

def assert_not_none(value, message="Value is None"):
    """Assert that value is not None."""
    if value == None:
        test_results['failed'] += 1
        test_results['errors'].append("FAIL: " + message)
    else:
        test_results['passed'] += 1

def assert_in(value, collection, message="Value not in collection"):
    """Assert that value is in collection."""
    found = False
    for item in collection:
        if item == value:
            found = True
            break
    
    if not found:
        test_results['failed'] += 1
        test_results['errors'].append(
            "FAIL: {} - '{}' not in collection".format(message, value)
        )
    else:
        test_results['passed'] += 1

# =============================================================================
# TEST SUITE: Loader Module
# =============================================================================

def _test_loader_functions():
    """Test loader functions."""
    print("🔍 Testing loader module...")
    
    # Test that loader functions are accessible via facade
    assert_not_none(Manifest.load_from_file, "load_from_file should be accessible")
    assert_not_none(Manifest.load_from_path, "load_from_path should be accessible")
    assert_not_none(Manifest.load_all, "load_all should be accessible")
    assert_not_none(Manifest.clear_cache, "clear_cache should be accessible")
    assert_not_none(Manifest.get_cache_stats, "get_cache_stats should be accessible")
    assert_not_none(Manifest.is_cached, "is_cached should be accessible")
    assert_not_none(Manifest.get_manifest_path, "get_manifest_path should be accessible")
    
    # Test get_manifest_path
    path = Manifest.get_manifest_path("services/product/user/user-management-backend")
    assert_true(
        path.endswith("service.json"),
        "get_manifest_path should include manifest filename"
    )
    
    # Test cache functions
    Manifest.clear_cache()
    stats = Manifest.get_cache_stats()
    assert_equal(0, stats['entries'], "Cache should be empty after clear")
    
    print("✅ Loader module tests complete\n")

# =============================================================================
# TEST SUITE: Parser Module
# =============================================================================

def _test_parser_functions():
    """Test parser functions."""
    print("🔍 Testing parser module...")
    
    # Test that parser functions are accessible via facade
    assert_not_none(Manifest.parse, "parse should be accessible")
    assert_not_none(Manifest.normalize, "normalize should be accessible")
    assert_not_none(Manifest.get_normalized, "get_normalized should be accessible")
    assert_not_none(Manifest.extract_resource_path, "extract_resource_path should be accessible")
    assert_not_none(Manifest.extract_stack, "extract_stack should be accessible")
    assert_not_none(Manifest.parse_traefik, "parse_traefik should be accessible")
    assert_not_none(Manifest.merge_manifests, "merge_manifests should be accessible")
    assert_not_none(Manifest.get_description, "get_description should be accessible")
    
    print("✅ Parser module tests complete\n")

# =============================================================================
# TEST SUITE: Parse and Normalize
# =============================================================================

def _test_parse_and_normalize():
    """Test parsing and normalization together."""
    print("🔍 Testing parse and normalize integration...")
    
    # Test valid JSON parsing
    valid_json = '''
    {
        "appName": "test-service",
        "appType": "backend",
        "stack": "user",
        "port": 4001,
        "traefik": {
            "pathPrefix": "/api/v1/test-service"
        }
    }
    '''
    
    result = Manifest.parse(valid_json)
    assert_not_none(result.manifest, "Should parse valid JSON")
    assert_equal(None, result.error, "Should have no error for valid JSON")
    
    # Test normalization
    normalized = Manifest.normalize(result.manifest, "services/product/user/test-service")
    assert_not_none(normalized, "Should normalize manifest")
    assert_equal("test-service", normalized['appName'], "Should preserve appName")
    assert_equal("backend", normalized['appType'], "Should preserve appType")
    assert_equal("user", normalized['stack'], "Should preserve stack")
    assert_equal(4001, normalized['port'], "Should preserve port")
    
    # Test defaults are applied
    assert_equal(1, normalized['replicas'], "Should apply default replicas")
    assert_equal(3000, normalized['internalPort'], "Should apply default internalPort")
    assert_equal("bun", normalized['runtime'], "Should apply default runtime")
    assert_not_none(normalized['syncs'], "Should compute default syncs")
    assert_not_none(normalized['traefik'], "Should create traefik config")
    
    # Test _normalized flag is set
    assert_equal(True, normalized.get('_normalized'), "Should set _normalized flag")
    
    print("✅ Parse and normalize tests complete\n")

# =============================================================================
# TEST SUITE: Domain Extraction
# =============================================================================

def _test_stack_extraction():
    """Test stack extraction from resource paths."""
    print("🔍 Testing stack extraction...")

    # Standard paths
    stack = Manifest.extract_stack("services/product/user/user-management-backend")
    assert_equal("user", stack, "Should extract user stack")

    stack = Manifest.extract_stack("services/product/order/order-management-backend")
    assert_equal("order", stack, "Should extract order stack")

    stack = Manifest.extract_stack("services/product/identity/identity-management-backend")
    assert_equal("identity", stack, "Should extract identity stack")

    # Special case: order-planner
    stack = Manifest.extract_stack("services/product/order-planner/order-planner-backend")
    assert_equal("order-planner", stack, "Should extract order-planner stack")

    # Special case: profile -> identity
    stack = Manifest.extract_stack("services/product/profile/profile-management-backend")
    assert_equal("identity", stack, "Should map profile to identity stack")

    # The merged implementation resolves the stack wherever the
    # services/product pair sits, so prefixed scan roots work too
    stack = Manifest.extract_stack("../../../../services/product/user/user-management-backend")
    assert_equal("user", stack, "Should extract stack past ../ scan-root prefixes")

    stack = Manifest.extract_stack(".worktrees/task-1/services/product/order/order-management-backend")
    assert_equal("order", stack, "Should extract stack inside a worktree checkout")

    stack = Manifest.extract_stack("/private/var/folders/xx/proj/services/product/booking/booking-api")
    assert_equal("booking", stack, "Should extract stack from an absolute macOS path")

    stack = Manifest.extract_stack("/private/var/folders/xx/proj/services/product/profile/profile-management-backend")
    assert_equal("identity", stack, "Should map profile to identity on absolute paths")

    # Flat layouts (services/platform/<service>) have no stack segment: the
    # fallback takes the first '-' part of the app name or last path segment
    stack = Manifest.extract_stack("services/platform/identity-management-backend", "identity-management-backend")
    assert_equal("identity", stack, "Should fall back to the app name prefix")

    stack = Manifest.extract_stack("services/platform/verdaccio")
    assert_equal("verdaccio", stack, "Should fall back to the service dir name")

    stack = Manifest.extract_stack("")
    assert_equal("unknown", stack, "Empty path returns 'unknown'")

    print("✅ Stack extraction tests complete\n")

# =============================================================================
# TEST SUITE: Resource Path Canonicalization
# =============================================================================

def _test_path_canonicalization():
    """Test .worktrees/ and .flisk/.flisk-out/../.. path canonicalization."""
    print("🔍 Testing resource path canonicalization...")

    cases = [
        # Parallel checkouts collapse to the project-relative path
        (".worktrees/task-1/services/platform/verdaccio", "services/platform/verdaccio"),
        (".worktrees/task-1/services/product/user/user-management-backend", "services/product/user/user-management-backend"),
        ("checkout/.worktrees/fix-123/services/product/order/order-backend", "services/product/order/order-backend"),
        ("/private/var/folders/xx/proj/.worktrees/task-2/services/product/identity/identity-backend", "services/product/identity/identity-backend"),
        # A worktree root with nothing after the name stays untouched
        (".worktrees/task-1", ".worktrees/task-1"),
        (".worktrees/", ".worktrees/"),
        # Generated-output paths resolve to the project root
        (".flisk/.flisk-out/../../services/product/user/user-backend", "services/product/user/user-backend"),
        ("/tmp/proj/.flisk/.flisk-out/../../services/platform/verdaccio", "services/platform/verdaccio"),
        (".flisk/.flisk-out/../..", ""),
        # Absolute macOS paths and plain paths pass through unchanged
        ("/private/var/folders/xx/proj/services/product/user/user-backend", "/private/var/folders/xx/proj/services/product/user/user-backend"),
        ("services/product/order/order-backend", "services/product/order/order-backend"),
        ("../../../../services/platform/verdaccio", "../../../../services/platform/verdaccio"),
        ("", ""),
    ]
    for raw, expected in cases:
        assert_equal(expected, ManifestParser.canonicalize_path(raw), "canonicalize_path " + raw)

    print("✅ Path canonicalization tests complete\n")

# =============================================================================
# TEST SUITE: Shared Resource Builder
# =============================================================================

def _test_build_resource():
    """One builder: every discovery path emits the same resource dict shape."""
    print("🔍 Testing build_resource...")

    # Backend: dockerfile stays relative to the resource's own directory
    res = ManifestParser.build_resource(
        {"appName": "order-backend", "appType": "backend", "stack": "order", "port": 4100},
        "services/product/order/order-backend",
    )
    assert_equal("order-backend", res["name"], "Should preserve name")
    assert_equal("order", res["stack"], "Should preserve stack")
    assert_equal(4100, res["port"], "Should preserve port")
    assert_equal(".autogenerated/Dockerfile.app.autogenerated", res["dockerfile"], "dockerfile is service-dir-relative, never name-prefixed")
    assert_equal("services/product/order/order-backend", res["_resource_path"], "Should keep resource path")
    assert_true("frontend" not in res or not res["frontend"], "Backend is not marked frontend")

    # A custom dockerfile is kept as written (no name prefix)
    res = ManifestParser.build_resource(
        {"appName": "web", "appType": "bring-your-own", "stack": "edge", "port": 8080, "dockerfile": "Dockerfile.custom"},
        "services/edge/web",
    )
    assert_equal("Dockerfile.custom", res["dockerfile"], "Custom dockerfile keeps service-dir-relative form")

    # Frontend fields
    res = ManifestParser.build_resource(
        {"appName": "user-management-frontend", "appType": "frontend", "stack": "user", "port": 3000},
        "services/product/user/user-management-frontend",
    )
    assert_true(res.get("frontend", False), "Frontend is marked")
    assert_equal("user-management-backend", res["backendName"], "Backend name is derived")

    # syncs: explicit manifest syncs win, otherwise syncs_fn supplies defaults
    res = ManifestParser.build_resource(
        {"appName": "api", "appType": "backend", "stack": "shop", "port": 4000, "syncs": ["src"]},
        "services/product/shop/api",
    )
    assert_equal(["src"], res["syncs"], "Manifest syncs win")
    res = ManifestParser.build_resource(
        {"appName": "api", "appType": "backend", "stack": "shop", "port": 4000},
        "services/product/shop/api",
        syncs_fn = lambda app_type, features: ["src", "package.json"],
    )
    assert_equal(["src", "package.json"], res["syncs"], "syncs_fn supplies defaults")

    # stack falls back to the caller hint, then to the path
    res = ManifestParser.build_resource(
        {"appName": "verdaccio", "appType": "backend", "port": 4000},
        "services/platform/verdaccio",
        fallback_stack = "platform",
    )
    assert_equal("platform", res["stack"], "fallback_stack wins over path extraction")
    res = ManifestParser.build_resource(
        {"appName": "api", "appType": "backend", "port": 4000},
        "services/product/shop/api",
    )
    assert_equal("shop", res["stack"], "Missing stack extracts from path")

    # Optional fields pass through
    res = ManifestParser.build_resource(
        {"appName": "api", "appType": "backend", "stack": "shop", "port": 4000, "start_command": "bun run dev", "registry_host": "verdaccio"},
        "services/product/shop/api",
    )
    assert_equal("bun run dev", res["start_command"], "start_command passes through")
    assert_equal("verdaccio", res["registry_host"], "registry_host passes through")

    print("✅ build_resource tests complete\n")

# =============================================================================
# TEST SUITE: Frontend Manifest Normalization
# =============================================================================

def _test_frontend_normalization():
    """Test normalization for frontend manifests."""
    print("🔍 Testing frontend normalization...")
    
    frontend_json = '''
    {
        "appName": "user-management-frontend",
        "appType": "frontend",
        "stack": "user",
        "port": 3000,
        "backendName": "user-management-backend",
        "traefik": {
            "pathPrefix": "/user"
        }
    }
    '''
    
    result = Manifest.parse(frontend_json)
    normalized = Manifest.normalize(result.manifest, "services/product/user/user-management-frontend")
    
    assert_equal("frontend", normalized['appType'], "Should preserve frontend appType")
    assert_equal("user-management-backend", normalized['backendName'], "Should preserve backendName")
    
    # Test backendName auto-computation
    frontend_json_no_backend = '''
    {
        "appName": "test-frontend",
        "appType": "frontend",
        "stack": "user",
        "port": 3001,
        "traefik": {
            "pathPrefix": "/test"
        }
    }
    '''
    
    result2 = Manifest.parse(frontend_json_no_backend)
    normalized2 = Manifest.normalize(result2.manifest, "services/product/user/test-frontend")
    assert_equal("test-backend", normalized2['backendName'], "Should auto-compute backendName")
    
    print("✅ Frontend normalization tests complete\n")

# =============================================================================
# TEST SUITE: Traefik Configuration
# =============================================================================

def _test_traefik_config():
    """Test Traefik configuration parsing."""
    print("🔍 Testing Traefik configuration...")
    
    # Backend with explicit traefik config
    backend_json = '''
    {
        "appName": "user-management-backend",
        "appType": "backend",
        "stack": "user",
        "port": 4000,
        "traefik": {
            "pathPrefix": "/api/v1/users",
            "priority": 200
        }
    }
    '''
    
    result = Manifest.parse(backend_json)
    normalized = Manifest.normalize(result.manifest, "services/product/user/user-management-backend")
    
    assert_equal("/api/v1/users", normalized['traefik']['pathPrefix'], "Should preserve pathPrefix")
    assert_equal(200, normalized['traefik']['priority'], "Should preserve priority")
    
    # Test default priority is applied when omitted (pathPrefix is required)
    backend_json_no_priority = '''
    {
        "appName": "test-management-backend",
        "appType": "backend",
        "stack": "user",
        "port": 4001,
        "traefik": {
            "pathPrefix": "/api/v1/test"
        }
    }
    '''

    result2 = Manifest.parse(backend_json_no_priority)
    normalized2 = Manifest.normalize(result2.manifest, "services/product/user/test-management-backend")

    assert_equal("/api/v1/test", normalized2['traefik']['pathPrefix'], "Should preserve pathPrefix")
    assert_not_none(normalized2['traefik']['priority'], "Should set default priority")
    
    print("✅ Traefik configuration tests complete\n")

# =============================================================================
# TEST SUITE: Manifest Merging
# =============================================================================

def _test_manifest_merging():
    """Test manifest merging functionality."""
    print("🔍 Testing manifest merging...")
    
    base = {
        'appName': 'test-service',
        'appType': 'backend',
        'port': 4000,
        'featuresEnabled': ['nats'],
        'envVars': {
            'SHARED_VAR': 'base_value',
        },
    }
    
    overlay = {
        'port': 4001,  # Override
        'featuresEnabled': ['prisma'],  # Override
        'envVars': {
            'SHARED_VAR': 'overlay_value',  # Override
            'NEW_VAR': 'new_value',  # Add
        },
    }
    
    merged = Manifest.merge_manifests(base, overlay)
    
    assert_equal('test-service', merged['appName'], "Should preserve base appName")
    assert_equal(4001, merged['port'], "Should overlay port")
    assert_equal(['prisma'], merged['featuresEnabled'], "Should overlay features")
    assert_equal('overlay_value', merged['envVars']['SHARED_VAR'], "Should overlay nested env var")
    assert_equal('new_value', merged['envVars']['NEW_VAR'], "Should add new env var")
    
    print("✅ Manifest merging tests complete\n")

# =============================================================================
# TEST SUITE: Values written into generated config (GHSA-phgf-pww4-7jxc)
# =============================================================================

def _test_generated_string_fields():
    """A line break or YAML syntax in a field that reaches generated compose output must be rejected."""
    base = {'appName': 'api', 'stack': 'shop', 'traefik': {'pathPrefix': '/api/v1/shop-management'}}

    assert_equal(None, ManifestParser.generated_string_error(base), "Clean manifest has no generated-field error")

    safe = {
        'appName': 'api',
        'stack': 'shop-1',
        'healthCheckPath': '/api/v1/health',
        'databaseName': 'Flisk_shop',
        'image': 'ghcr.io/acme/app:1.0',
        'traefik': {'host': 'shop.backend.my-project.local', 'pathPrefix': '/api/v1/shop', 'healthCheck': '/health'},
        'nats': {'queueGroup': 'shop_backend_svc'},
    }
    assert_equal(None, ManifestParser.generated_string_error(safe), "Safe values are accepted")

    hostile = [
        {'healthCheckPath': '/health\n    privileged: true'},
        {'healthCheckPath': '/health"'},
        {'traefik': {'host': 'a.local\n    privileged: true', 'pathPrefix': '/api'}},
        {'traefik': {'pathPrefix': '/api/v1/x\n    network_mode: host'}},
        {'traefik': {'pathPrefix': '/api', 'healthCheck': '/h\n    volumes: []'}},
        {'traefik': {'pathPrefix': '/api'}, 'nats': {'queueGroup': 'g: true'}},
        {'traefik': {'pathPrefix': '/api'}, 'databaseName': 'Flisk_x\n  privileged: true'},
        {'traefik': {'pathPrefix': '/api'}, 'stack': 'shop # comment'},
        {'traefik': {'pathPrefix': '/api'}, 'image': 'app\n    privileged: true'},
        {'traefik': {'pathPrefix': '/api'}, 'healthCheckPath': 'health'},
        {'traefik': {'pathPrefix': '/api'}, 'healthCheckPath': 42},
    ]
    for manifest in hostile:
        assert_not_none(ManifestParser.generated_string_error(manifest), "Rejects unsafe value: " + str(manifest))

    # The message names the field and never echoes the value
    message = ManifestParser.generated_string_error(hostile[0], 'services/shop/api')
    assert_true("healthCheckPath" in message, "Error names the field")
    assert_true("\n" not in message, "Error does not echo the value")

    # Fields outside the allowlist also reach generated config, so a line break anywhere is refused
    clean = {'appName': 'api', 'stack': 'shop', 'traefik': {'pathPrefix': '/api'}}
    line_breaks = [
        {'port': '4000\n    privileged: true'},
        {'appName': 'api\n    privileged: true'},
        {'dockerfile': 'Dockerfile\r    privileged: true'},
        {'buildContext': 'src\u2028privileged: true'},
        {'envVars': [{'name': 'A', 'value': 'v\n    privileged: true'}]},
        {'params': {'a\n    privileged': 'x'}},
    ]
    for extra in line_breaks:
        manifest = dict(clean)
        manifest.update(extra)
        assert_not_none(ManifestParser.generated_string_error(manifest), "Rejects a line break: " + repr(extra))

    smoke = dict(clean)
    smoke['smoke'] = {'via': '/api', 'create': {'body': '{\n}'}}
    assert_equal(None, ManifestParser.generated_string_error(smoke), "smoke is never written into generated config")

# =============================================================================
# TEST SUITE: Get Normalized Convenience Function
# =============================================================================

def _test_get_normalized():
    """Test the get_normalized convenience function."""
    print("🔍 Testing get_normalized...")
    
    json_content = '''
    {
        "appName": "test-service",
        "appType": "backend",
        "stack": "user",
        "port": 4001,
        "traefik": {
            "pathPrefix": "/api/v1/test"
        }
    }
    '''

    result = Manifest.get_normalized(json_content, "services/product/user/test-service")
    
    assert_not_none(result.manifest, "Should return normalized manifest")
    assert_equal(None, result.error, "Should have no error")
    assert_equal("test-service", result.manifest['appName'], "Should have correct appName")
    assert_equal("backend", result.manifest['appType'], "Should have correct appType")
    assert_equal(True, result.manifest.get('_normalized'), "Should be marked as normalized")
    
    print("✅ Get normalized tests complete\n")

# =============================================================================
# TEST SUITE: Service Description
# =============================================================================

def _test_resource_description():
    """Test service description generation."""
    print("🔍 Testing service description...")
    
    manifest = {
        'appName': 'user-management-backend',
        'appType': 'backend',
        'stack': 'user',
    }
    
    desc = Manifest.get_description(manifest)
    assert_equal("user/backend/user-management-backend", desc, "Should generate correct description")
    
    print("✅ Service description tests complete\n")

# =============================================================================
# MAIN
# =============================================================================

def _test_byo_health_path_is_optional():
    """A bring-your-own service without healthCheckPath gets none; /health is only the default for HTTP types."""
    print("\n🧪 Testing bring-your-own health path is optional...")

    byo = ManifestParser.normalize({'appType': 'bring-your-own', 'appName': 'postgres', 'stack': 'shop', 'port': 4500}, 'services/shop/postgres')
    assert_true('healthCheckPath' not in byo, "BYO without healthCheckPath gets no default /health")

    byo_http = ManifestParser.normalize({'appType': 'bring-your-own', 'appName': 'web', 'stack': 'shop', 'port': 4501, 'healthCheckPath': '/status'}, 'services/shop/web')
    assert_equal('/status', byo_http.get('healthCheckPath'), "BYO keeps an explicit healthCheckPath")

    backend = ManifestParser.normalize({'appType': 'backend', 'appName': 'api', 'stack': 'shop', 'port': 4000, 'traefik': {'pathPrefix': '/api'}}, 'services/shop/api')
    assert_equal('/health', backend.get('healthCheckPath'), "Backends still default to /health")

def run_tests():
    """Run all Phase 2 integration tests."""
    print("\n" + "="*70)
    print("📋 MANIFEST MODULE - PHASE 2 INTEGRATION TESTS")
    print("="*70 + "\n")
    
    # Run all test suites
    _test_loader_functions()
    _test_parser_functions()
    _test_parse_and_normalize()
    _test_stack_extraction()
    _test_path_canonicalization()
    _test_build_resource()
    _test_frontend_normalization()
    _test_traefik_config()
    _test_manifest_merging()
    _test_get_normalized()
    _test_resource_description()
    _test_generated_string_fields()
    _test_byo_health_path_is_optional()
    
    # Print results
    print("\n" + "="*70)
    print("📊 TEST RESULTS")
    print("="*70)
    print("✅ Passed: {}".format(test_results['passed']))
    print("❌ Failed: {}".format(test_results['failed']))
    
    if test_results['errors']:
        print("\n📝 ERRORS:")
        for error in test_results['errors']:
            print("   " + error)
    else:
        print("\n🎉 All Phase 2 integration tests passed!")
    
    print("="*70 + "\n")
    
    return test_results['failed'] == 0

# Export test runner
TestLoaderParser = struct(
    run=run_tests,
)
