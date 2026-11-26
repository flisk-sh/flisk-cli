// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { RESOURCE_DEFAULTS_FILE, TECH_STACK_FILE } from "../utils/constants.js";
/**
 * Type guard to validate filename is a known master config file.
 * Eliminates the need for 'as MasterConfigFileName' assertion.
 */
export function isMasterConfigFileName(filename) {
    const validNames = [TECH_STACK_FILE, RESOURCE_DEFAULTS_FILE, "spec.master"];
    return validNames.includes(filename);
}
