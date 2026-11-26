# Copyright (c) 2026 Flisk Landscape contributors
# SPDX-License-Identifier: MIT
# =============================================================================
# ✅ TILT SDK - MANIFEST VALIDATION (compatibility shim)
# =============================================================================
# This module used to duplicate ../validation.star nearly line-for-line. The
# deduplicated rule table and validator now live in ../validation_rules.star
# and ../validation.star; the service-manifest corpus contract test
# (tests/fixtures/service-manifest-corpus/) asserts both entry points make the
# same accept/reject calls. Keep this shim so existing
# load("./validation.star", "validate_manifest") callers keep working.
# =============================================================================

load("../validation.star", _validate = "validate")


def validate_manifest(manifest):
    """Alias for ../validation.star's validate - see that module for the rules."""
    return _validate(manifest)
