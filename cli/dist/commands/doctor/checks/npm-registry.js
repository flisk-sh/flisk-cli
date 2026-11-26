// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { hasVerdaccioLicense } from "../../../generator/extension-fetch.js";
import { checkPrivateNpmRegistry, projectConfigEnablesVerdaccio, } from "../../../utils/doctor-runtime.js";
import { findProjectRoot } from "../../../utils/paths.js";
/**
 * Preflight: with Verdaccio configured but down, ImageBuild `bun install` hits
 * ConnectionRefused. The license check only runs when the project config opted into Verdaccio.
 */
export const privateNpmRegistryCheck = {
    name: "Private npm registry",
    requires: null,
    run: async (ctx) => {
        const root = findProjectRoot() ?? process.cwd();
        const licensed = projectConfigEnablesVerdaccio(root) ? await hasVerdaccioLicense(root) : true;
        return checkPrivateNpmRegistry(ctx.execSync, root, undefined, licensed, ctx.hostCommandCache);
    },
};
