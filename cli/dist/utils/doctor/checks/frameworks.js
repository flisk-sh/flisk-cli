// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { BRING_YOUR_OWN_TYPE } from "../../constants.js";
import { formatCount } from "../../formatting.js";
import { findProjectRoot } from "../../paths.js";
import { discoverResourcesFromRoot } from "../../services.js";
/** The connection settings of the presets that `flisk resource --type redis|qdrant|rabbitmq` (1.4.24) wrote, and their frameworks. */
const OLD_PRESET_PROVIDES = {
    REDIS_URL: { type: "database", framework: "redis" },
    QDRANT_URL: { type: "database", framework: "qdrant" },
    AMQP_URL: { type: "queue", framework: "rabbitmq" },
};
/**
 * A bring-your-own service.json that `provides` REDIS_URL, QDRANT_URL or AMQP_URL and has no `framework`: written by
 * `flisk resource --type redis|qdrant|rabbitmq`, which became `--type database|queue --framework ...`. The file keeps working
 * (it is plain bring-your-own), so this is a warning that names the command to recreate it with the web UI port and the
 * `framework` field.
 */
export function checkInfraFrameworks(projectRoot = findProjectRoot() ?? process.cwd()) {
    const old = [];
    for (const resource of discoverResourcesFromRoot(projectRoot)) {
        if (resource.config?.appType !== BRING_YOUR_OWN_TYPE)
            continue;
        let manifest;
        try {
            manifest = JSON.parse(readFileSync(resource.configPath, "utf-8"));
        }
        catch {
            continue;
        }
        if (manifest.framework !== undefined)
            continue;
        const provides = manifest.provides;
        if (!provides || typeof provides !== "object")
            continue;
        for (const key of Object.keys(provides)) {
            const preset = OLD_PRESET_PROVIDES[key];
            if (!preset)
                continue;
            old.push(`${resource.name} (${relative(projectRoot, resource.configPath)}) provides ${key}: recreate it with flisk resource ${resource.name} --type ${preset.type} --framework ${preset.framework}`);
        }
    }
    if (old.length === 0) {
        return {
            name: "Infrastructure frameworks",
            didPass: true,
            message: "No service.json is an old redis, qdrant or rabbitmq preset",
        };
    }
    return {
        name: "Infrastructure frameworks",
        didPass: false,
        isWarning: true,
        message: `${formatCount(old.length, "bring-your-own resource")} written by the old --type redis|qdrant|rabbitmq preset (no "framework" field):\n    ${old.join("\n    ")}`,
        fix: 'These still work as they are. To get the framework field and the UI port, move the data you need, delete the folder and run the command above, or add "framework" to the service.json by hand (see docs/byo.md, "Moving from the old preset types")',
    };
}
