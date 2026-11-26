// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import { existsSync } from "node:fs";
import { join } from "node:path";
import { BACKEND_LANGUAGES } from "../../../backend-languages/registry.js";
import type { CheckResult, DiscoveredResource } from "../../../types/index.js";
import { DATABASE_RESOURCE_TYPE } from "../../../types/index.js";
import { BRING_YOUR_OWN_TYPE, PACKAGE_JSON } from "../../constants.js";
import { formatCount } from "../../formatting.js";
import { findProjectRoot } from "../../paths.js";
import { discoverResourcesFromRoot } from "../../services.js";

/** A backend whose language provider scaffolds its own runtime files (Python) has no package.json. */
function ownsRuntimeFiles(resource: DiscoveredResource): boolean {
  const language = resource.config?.language;
  return (
    typeof language === "string" &&
    Object.hasOwn(BACKEND_LANGUAGES, language) &&
    BACKEND_LANGUAGES[language].createFiles !== undefined
  );
}

/**
 * A bring-your-own resource is a plain container: the engine builds the image from the resource's own `dockerfile`
 * (or its `buildContext`), or pulls `image`, and never generates the golden-layer Dockerfile that COPYs a package.json.
 */
function isBringYourOwn(resource: DiscoveredResource): boolean {
  return (resource.config?.appType ?? resource.type) === BRING_YOUR_OWN_TYPE;
}

/**
 * A database resource has no application code at all: no package.json is generated for it and no image is built
 * from its directory, exactly as for a bring-your-own resource. The same rule `REQUIRED_PACKAGE_SCRIPTS.database`
 * ([]) already follows for the "Startup Scripts" check.
 */
function isDatabaseResource(resource: DiscoveredResource): boolean {
  return (resource.config?.appType ?? resource.type) === DATABASE_RESOURCE_TYPE;
}

export function checkResourcePackageJson(
  projectRoot = findProjectRoot() ?? process.cwd(),
): CheckResult {
  const missing = discoverResourcesFromRoot(projectRoot)
    .filter(
      (resource) =>
        !isBringYourOwn(resource) &&
        !isDatabaseResource(resource) &&
        !ownsRuntimeFiles(resource) &&
        !existsSync(join(resource.path, PACKAGE_JSON)),
    )
    .map((resource) => resource.name);

  if (missing.length === 0) {
    return {
      name: "Resource package.json",
      didPass: true,
      message: "Every resource has a package.json",
    };
  }
  return {
    name: "Resource package.json",
    didPass: false,
    message: `${formatCount(missing.length, "resource")} without a package.json: ${missing.join(", ")}. The image build stops at "COPY .../package.json: not found"`,
    fix: "Add a package.json next to each service.json (copy one from a working resource), or delete the folder's service.json if it is not a service",
  };
}
