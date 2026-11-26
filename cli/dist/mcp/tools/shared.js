// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { FliskError } from "../../utils/errors.js";
import { validateProjectName, validateResourceName } from "../../utils/validation.js";
/** A service or stack name. A leading "-" is rejected so a value can never be read as a flag. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export function names(value, field) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !NAME.test(item))) {
        throw new FliskError(`${field} must be an array of names (letters, digits, ".", "_", "-")`, [
            `Pass ${field} as an array of names, for example ["orders-api"]`,
        ]);
    }
    return value;
}
export function optionalName(value, field) {
    if (value === undefined)
        return undefined;
    if (typeof value !== "string" || !NAME.test(value)) {
        throw new FliskError(`${field} must be a name (letters, digits, ".", "_", "-")`, [
            `Pass ${field} as a name that does not start with "-", for example orders-api`,
        ]);
    }
    return value;
}
/**
 * A name `flisk resource` can scaffold, checked with the CLI's own validator: lowercase letters,
 * numbers and hyphens, starting and ending with a letter or number, at most 63 characters and never a
 * Windows device name. The shared NAME pattern above also lets ".", "_" and uppercase through, so
 * the tool accepted names the command then refused (#5235).
 */
export function creatableResourceName(value) {
    if (typeof value !== "string") {
        throw new FliskError("name must be a string", [
            "Pass a kebab-case name, for example my-service",
        ]);
    }
    const validation = validateResourceName(value);
    if (!validation.valid) {
        throw new FliskError(validation.error ?? `Resource name "${value}" is not valid`, [
            "Pass a kebab-case name, for example my-service",
        ]);
    }
    return value;
}
/** A list of project-relative paths (used by config_verify's opt-in diffFiles). */
export function paths(value, field) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value)) {
        throw new FliskError(`${field} must be an array of paths`, [
            `Pass ${field} as paths reported by config_verify, for example ["Tiltfile"]`,
        ]);
    }
    return value.map((item) => {
        const file = optionalPath(item, field);
        if (file === undefined) {
            throw new FliskError(`${field} must contain only non-empty paths`, [
                `Pass ${field} as paths reported by config_verify, for example ["Tiltfile"]`,
            ]);
        }
        return file;
    });
}
/** A project name: the kebab-case rule the CLI's `--name` applies, so the spawned command cannot refuse it. */
export function optionalProjectName(value, field) {
    if (value === undefined)
        return undefined;
    if (typeof value !== "string") {
        throw new FliskError(`${field} must be a string`, [
            "Pass the project name, for example my-shop",
        ]);
    }
    const name = value.trim();
    const result = validateProjectName(name);
    if (!result.valid) {
        throw new FliskError(result.error ?? `${field} is not a valid project name`, [
            "Use lowercase letters, numbers, and hyphens only",
        ]);
    }
    return name;
}
export function flag(value, field, fallback = false) {
    if (value === undefined)
        return fallback;
    if (typeof value !== "boolean") {
        throw new FliskError(`${field} must be a boolean`, [
            `Pass true or false, or omit ${field} for ${fallback}`,
        ]);
    }
    return value;
}
/** One of a fixed set of values, such as a resource type or a template name. */
export function optionalChoice(value, field, choices) {
    if (value === undefined)
        return undefined;
    if (typeof value !== "string" || !choices.includes(value)) {
        throw new FliskError(`${field} must be one of: ${choices.join(", ")}`, [
            `Omit ${field} to use the command's default`,
        ]);
    }
    return value;
}
/** A file or directory path. A leading "-" is rejected so a positional path can never be read as a flag. */
export function optionalPath(value, field) {
    if (value === undefined)
        return undefined;
    if (typeof value !== "string" ||
        value === "" ||
        value.startsWith("-") ||
        /[\0\r\n]/.test(value)) {
        throw new FliskError(`${field} must be a non-empty path that does not start with "-"`, [
            "Pass a path relative to projectPath, or an absolute path",
        ]);
    }
    return value;
}
export function optionalPort(value, field) {
    if (value === undefined)
        return undefined;
    if (!Number.isInteger(value) || value < 1 || value > 65535) {
        throw new FliskError(`${field} must be an integer from 1 to 65535`, [
            `Omit ${field} to take the next free port in the type's range`,
        ]);
    }
    return value;
}
export const OBJECT = (properties) => ({
    type: "object",
    properties,
    additionalProperties: false,
});
export const PROJECT_PATH = {
    type: "string",
    description: "Absolute path to the Flisk project root; run this operation from that directory.",
};
export function projectPath(value) {
    if (value === undefined)
        return undefined;
    if (typeof value !== "string" || !isAbsolute(value)) {
        throw new FliskError("projectPath must be an absolute path to a Flisk project root", [
            "Pass the absolute path of the directory that holds .flisk/project.json",
            "Or omit projectPath to run in the MCP server's directory",
        ]);
    }
    // The path is the child's working directory, so a missing one would fail the
    // spawn with an ENOENT that names the binary instead of the directory. One
    // stat call tells a path that is not there (no entry) from one this process
    // cannot read (the error is kept, so a permission problem is not reported
    // as a missing directory).
    const stat = statSync(value, { throwIfNoEntry: false });
    if (!stat?.isDirectory()) {
        // Shared by project_init, which writes .flisk/project.json into the directory, so
        // the guidance must not assume the directory already holds one.
        throw new FliskError(`projectPath does not exist or is not a directory: ${value}`, [
            "Create the directory, or pass the absolute path of an existing directory (for a project that is already set up, the one that holds .flisk/project.json)",
            "Or omit projectPath to run in the MCP server's directory",
        ]);
    }
    return value;
}
