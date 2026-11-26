# Copyright (c) 2026 Flisk Landscape contributors
# SPDX-License-Identifier: MIT
# =============================================================================
# 📏 SERVICE MANIFEST VALIDATION RULES - THE STARLARK RULE TABLE
# =============================================================================
# The single named source for the service.json rules the discovery validator
# enforces. TILT_DISCOVERY.star's get_port_ranges(), get_valid_stacks() and
# get_valid_resource_features() return values from this table, and
# cli/src/utils/service-manifest-rules.ts mirrors it for the TypeScript side.
# The fixture corpus (tests/fixtures/service-manifest-corpus/) pins both tables
# and the accept/reject decisions of every validator together (#4858). Change
# a rule here (or in the schema it mirrors), never in a validator.
#
# This module loads only the engine's constants for VALID_APP_TYPES. It must
# NOT load TILT_DISCOVERY.star - that file loads this one, which would be a
# circular dependency.
# =============================================================================

load(
    "../engine/topologies/tilt/manifest/constants.star",
    _engine_app_types = "VALID_APP_TYPES",
)

# appName: required string, kebab-case, 2-64 characters
# (runtime/engine/schemas/service-schema.json minLength/maxLength).
APP_NAME_MIN_LENGTH = 2
APP_NAME_MAX_LENGTH = 64

# Every appType the schema and the CLI accept, plus the engine's internal
# "infra" resource type. The engine's VALID_APP_TYPES list does not name
# "agent", but the schema enum and the CLI's RESOURCE_CONFIG_APP_TYPES do, and
# the loader normalises an agent to a backend - so it belongs in the table.
VALID_APP_TYPES = _engine_app_types + ["agent"]

# Stacks are project-specific, discovered dynamically (empty skips the check).
VALID_STACKS = []

# The discovery whitelist for a resource's featuresEnabled entries. The schema
# enum is wider (it also has drizzle and sablier but no vite-node or
# maintenance); the corpus records that drift.
VALID_RESOURCE_FEATURES = [
    # Resource-level features (code generators)
    "api-client",
    "env-config",
    "api-index",
    "prisma",
    # Infrastructure features
    "nats",
    "redis",
    "infisical",
    "vitest",
    "traefik",
    "websocket",
    "graphql",
    "grpc",
    "vite-node",
    "maintenance",
    # Premium (requires FLISK_LICENSE_KEY) - see generate_backend_path_aliases()
    # in engine/topologies/tilt/generators/vite/helpers.star
    "ddd",
]

# appTypes that legitimately run without a port: an "infra" resource is
# platform plumbing and a "database" resource only declares the shared
# Postgres (schema: a database has no port, command, image or dockerfile).
PORT_OPTIONAL_APP_TYPES = ["infra", "database"]

# A scaffolded (container) service's port: 3000-9999 in discovery.
STANDARD_PORT_MIN = 3000
STANDARD_PORT_MAX = 9999

# A bring-your-own port is the port its own container listens on - Traefik
# reaches it on the stack network, nothing is published on the host - so an
# imported Compose app keeps 80, 3000 or 5432.
BRING_YOUR_OWN_PORT_MIN = 1
BRING_YOUR_OWN_PORT_MAX = 65535

# Per-appType port bands for validation - the single Starlark source
# (cli/src/utils/service-manifest-rules.ts keeps the TypeScript mirror).
PORT_RANGES = {
    "frontend": {"min": 3000, "max": 5999},
    "backend": {"min": 4000, "max": 5999},
    "worker": {"min": 4000, "max": 6999},
    "migrator": {"min": 7000, "max": 7999},
    "sdk": {"min": 3000, "max": 9999},  # SDKs don't have strict rules
    "library": {"min": 3000, "max": 9999},  # Libraries don't have ports
}

REPLICAS_MIN = 1
REPLICAS_MAX = 10

# The whole table as one value, for contract tests that compare it wholesale
# against cli/src/utils/service-manifest-rules.ts and the corpus expectations.
SERVICE_MANIFEST_RULES = struct(
    app_name_min_length = APP_NAME_MIN_LENGTH,
    app_name_max_length = APP_NAME_MAX_LENGTH,
    valid_app_types = VALID_APP_TYPES,
    port_optional_app_types = PORT_OPTIONAL_APP_TYPES,
    standard_port_min = STANDARD_PORT_MIN,
    standard_port_max = STANDARD_PORT_MAX,
    bring_your_own_port_min = BRING_YOUR_OWN_PORT_MIN,
    bring_your_own_port_max = BRING_YOUR_OWN_PORT_MAX,
    port_ranges = PORT_RANGES,
    valid_resource_features = VALID_RESOURCE_FEATURES,
    replicas_min = REPLICAS_MIN,
    replicas_max = REPLICAS_MAX,
)
