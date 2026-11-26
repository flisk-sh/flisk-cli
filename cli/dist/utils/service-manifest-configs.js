// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { validateSecretConfigFileEntry } from "./service-manifest-shared.js";
/** `configs` must be an array of { name, source, target, uid?, gid?, mode? } (#3059). */
export function configsErrors(manifest, displayPath) {
    const configs = manifest.configs;
    if (configs === undefined || configs === null)
        return [];
    if (manifest.appType !== "bring-your-own") {
        return [
            `${displayPath}.configs: only applies to bring-your-own resources (appType "bring-your-own")`,
        ];
    }
    if (!Array.isArray(configs)) {
        return [`${displayPath}.configs: expected an array of { name, source, target }`];
    }
    const errors = [];
    for (let i = 0; i < configs.length; i++) {
        const field = `${displayPath}.configs[${i}]`;
        errors.push(...validateSecretConfigFileEntry(configs[i], field, "config"));
    }
    return errors;
}
