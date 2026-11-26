// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { existsSync } from "node:fs";
import { join } from "node:path";
import { toComposeProjectName } from "../../compose-project-name.js";
import { DOCKER_COMPOSE_FILE } from "../../constants.js";
import { formatCount } from "../../formatting.js";
import { findProjectRoot } from "../../paths.js";
import { discoverResourcesFromRoot } from "../../services.js";
import { projectName } from "./shared.js";
export function checkNatsBroker(projectRoot = findProjectRoot() ?? process.cwd()) {
    const users = discoverResourcesFromRoot(projectRoot)
        .filter((resource) => resource.config?.featuresEnabled?.includes("nats"))
        .map((resource) => resource.name);
    if (users.length === 0) {
        return {
            name: "NATS broker",
            didPass: true,
            message: "No resource enables the nats feature",
            isSkipped: true,
        };
    }
    if (existsSync(join(projectRoot, "services", "platform", "messaging", DOCKER_COMPOSE_FILE))) {
        return {
            name: "NATS broker",
            didPass: true,
            message: `${formatCount(users.length, "resource")} enable nats and services/platform/messaging/docker-compose.yml is present`,
        };
    }
    const name = toComposeProjectName(projectName(projectRoot) ?? "flisk-project");
    return {
        name: "NATS broker",
        didPass: false,
        message: `${users.join(", ")} enable the nats feature, but no NATS server will start: Flisk only starts one when services/platform/messaging/docker-compose.yml exists, and it does not generate that file`,
        fix: `Create it with a "nats" service (image nats with -js, container_name ${name}_nats, network ${name}_backend, external) and a "redis" service, which Flisk registers alongside it`,
    };
}
