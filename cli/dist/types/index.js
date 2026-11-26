// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
// Barrel: the shared type surface of the CLI, split into per-domain modules. Every
// symbol lives in exactly one module and is re-exported here, so the 100+ importers
// of `types/index.js` keep working unchanged. Keep the modules import-cycle free:
// constants.js reads ResourceType from this barrel, so only shared.ts may reach back
// into utils (for TECH_STACK_FILE / RESOURCE_DEFAULTS_FILE).
export { CREATABLE_RESOURCE_TYPES, isCreatableResourceType, RESOURCE_CONFIG_APP_TYPES, } from "./app-types.js";
export { DATABASE_FRAMEWORK, DATABASE_FRAMEWORKS, DATABASE_INFRA_FRAMEWORKS, DATABASE_RESOURCE_TYPE, DEFAULT_QUEUE_FRAMEWORK, INFERENCE_RESOURCE_TYPE, isResourceCreateType, MAIL_FRAMEWORKS, MAIL_RESOURCE_TYPE, PAYMENT_FRAMEWORKS, PAYMENT_RESOURCE_TYPE, PRESET_RESOURCE_TYPES, QUEUE_FRAMEWORKS, QUEUE_RESOURCE_TYPE, RESOURCE_CREATE_TYPE_VALUES, RESOURCE_TYPE_VALUES, STORAGE_FRAMEWORKS, STORAGE_RESOURCE_TYPE, } from "./infra.js";
export { isMasterConfigFileName } from "./shared.js";
