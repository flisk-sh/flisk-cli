#!/usr/bin/env python3
# Copyright (c) 2026 Flisk Landscape contributors
# SPDX-License-Identifier: MIT
"""Convert YAML manifest to JSON for Tilt"""
import os
import sys
import yaml
from _confine import _confined
import json

if len(sys.argv) < 2:
    print("Usage: yaml_to_json.py <yaml_file>", file=sys.stderr)
    sys.exit(1)

yaml_file = _confined(sys.argv[1], ('.yaml', '.yml'))
if yaml_file is None:
    print("Error: expected an existing .yaml/.yml file inside the project", file=sys.stderr)
    sys.exit(1)
try:
    with open(yaml_file, 'r') as f:
        data = yaml.safe_load(f)
    print(json.dumps(data))
except Exception as e:
    print(f"Error: {e}", file=sys.stderr)
    sys.exit(1)
