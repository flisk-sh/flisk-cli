# Copyright (c) 2026 Flisk Landscape contributors
# SPDX-License-Identifier: MIT
# =============================================================================
# 🔍 DISCOVERY MANIFEST VALIDATION
# =============================================================================
# The single service.json validator for discovery. manifest/validation.star
# used to carry a near-identical copy (validate_manifest); it is now a
# compatibility shim over this module, and the fixture corpus in
# tests/fixtures/service-manifest-corpus/ pins the same accept/reject decisions
# for both names, for the JSON schema and for the CLI's validateServiceManifest.
#
# The bounds and whitelists this enforces live in ./validation_rules.star -
# change a rule there, not here.
# =============================================================================

load(
    "./validation_rules.star",
    "APP_NAME_MAX_LENGTH",
    "APP_NAME_MIN_LENGTH",
    "BRING_YOUR_OWN_PORT_MAX",
    "BRING_YOUR_OWN_PORT_MIN",
    "PORT_OPTIONAL_APP_TYPES",
    "PORT_RANGES",
    "REPLICAS_MAX",
    "REPLICAS_MIN",
    "STANDARD_PORT_MAX",
    "STANDARD_PORT_MIN",
    "VALID_APP_TYPES",
    "VALID_RESOURCE_FEATURES",
    "VALID_STACKS",
)


def validate(manifest):
    """Lenient validator: returns a list of issues (empty means valid)."""
    issues = []

    app_name = manifest.get("appName")
    if not app_name:
        issues.append("Missing required field: appName")
    elif type(app_name) != "string":
        issues.append("appName must be a string")
    elif len(app_name) < APP_NAME_MIN_LENGTH:
        issues.append("appName too short: '" + app_name + "'. Minimum " + str(APP_NAME_MIN_LENGTH) + " characters")
    elif len(app_name) > APP_NAME_MAX_LENGTH:
        issues.append("appName too long: '" + app_name + "'. Maximum " + str(APP_NAME_MAX_LENGTH) + " characters")

    # kebab-case pattern - only on a real string (a non-string appName already has an issue)
    if type(app_name) == "string":
        for i in range(len(app_name)):
            char = app_name[i]
            if not (char.islower() or char.isdigit() or char == "-"):
                issues.append("Invalid character in appName: '" + char + "'. Must be kebab-case (lowercase, numbers, hyphens)")
                break
        if app_name.startswith("-") or app_name.endswith("-"):
            issues.append("appName cannot start or end with a hyphen")

    app_type = manifest.get("appType")
    if not app_type:
        issues.append("Missing required field: appType")
    elif app_type not in VALID_APP_TYPES:
        issues.append("Invalid appType: " + str(app_type) + ". Must be one of: " + ", ".join(VALID_APP_TYPES))

    stack = manifest.get("stack")
    if not stack:
        issues.append("Missing required field: stack")
    elif len(VALID_STACKS) > 0 and stack not in VALID_STACKS:
        # Only validate against list if VALID_STACKS is not empty
        issues.append("Invalid stack: " + str(stack) + ". Must be one of: " + ", ".join(VALID_STACKS))

    port = manifest.get("port")
    if port == None:
        # Infra resources and the database resource legitimately run without a port.
        if app_type not in PORT_OPTIONAL_APP_TYPES:
            issues.append("Missing required field: port")
    elif type(port) != "int":
        issues.append("Invalid port: " + str(port) + ". Must be an integer")
    elif app_type == "bring-your-own":
        # A bring-your-own port is the port its own container listens on, so an
        # imported Compose app keeps 80, 3000 or 5432.
        if port < BRING_YOUR_OWN_PORT_MIN or port > BRING_YOUR_OWN_PORT_MAX:
            issues.append("Invalid port: " + str(port) + ". Must be integer " + str(BRING_YOUR_OWN_PORT_MIN) + "-" + str(BRING_YOUR_OWN_PORT_MAX))
    elif app_type != "infra":
        if port < STANDARD_PORT_MIN or port > STANDARD_PORT_MAX:
            issues.append("Invalid port: " + str(port) + ". Must be integer " + str(STANDARD_PORT_MIN) + "-" + str(STANDARD_PORT_MAX))
        elif app_type and app_type in PORT_RANGES:
            port_range = PORT_RANGES[app_type]
            if port < port_range["min"] or port > port_range["max"]:
                issues.append("Port " + str(port) + " out of range for " + app_type + ". Expected " + str(port_range["min"]) + "-" + str(port_range["max"]))

    features = manifest.get("featuresEnabled", [])
    if type(features) != "list":
        issues.append("Invalid features: must be an array")
    else:
        for feature in features:
            if feature not in VALID_RESOURCE_FEATURES:
                issues.append("Invalid feature: " + str(feature) + ". Must be one of: " + ", ".join(VALID_RESOURCE_FEATURES))

    deps = manifest.get("dependsOn", [])
    if type(deps) != "list":
        issues.append("Invalid dependsOn: must be an array")
    # Valid dependency targets are discovered dynamically from manifests - the
    # actual existence check happens at orchestration time, not here.

    replicas = manifest.get("replicas")
    if replicas != None:
        if type(replicas) != "int":
            issues.append("Invalid replicas: must be an integer")
        elif replicas < REPLICAS_MIN:
            issues.append("Invalid replicas: " + str(replicas) + ". Minimum is " + str(REPLICAS_MIN))
        elif replicas > REPLICAS_MAX:
            issues.append("Invalid replicas: " + str(replicas) + ". Maximum is " + str(REPLICAS_MAX))

    return issues


def validate_manifest(manifest):
    """Old name kept for callers that imported it from manifest/validation.star."""
    return validate(manifest)
