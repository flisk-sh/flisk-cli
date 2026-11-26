// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { relative, sep } from "node:path";
import { formatCount } from "../../formatting.js";
import { findProjectRoot } from "../../paths.js";
import { discoverResourcesWithProblems } from "../../services.js";
/**
 * A service.json that does not parse, or that misses the required fields, is skipped by discovery:
 * its service vanishes from every other check and only a stderr warning says why. Doctor is where
 * the project asks "is everything OK?", so the skipped files are a failing check here (#5143).
 */
export function checkValidServiceJsonFiles(projectRoot = findProjectRoot() ?? process.cwd()) {
    const { problems } = discoverResourcesWithProblems(projectRoot);
    if (problems.length === 0) {
        return {
            name: "Valid service.json files",
            didPass: true,
            message: "Every service.json parses and declares a service",
        };
    }
    const lines = problems.map((problem) => `${relative(projectRoot, problem.path).split(sep).join("/")}: ${problem.reason}`);
    return {
        name: "Valid service.json files",
        didPass: false,
        message: `Discovery skipped ${formatCount(problems.length, "service.json file")}:\n    ${lines.join("\n    ")}`,
        fix: 'Fix each service.json (invalid JSON or missing "appName"/"appType"), or remove it if the folder is not a service. `flisk config verify` reports every service.json problem',
    };
}
