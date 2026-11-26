// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import * as manifestFacade from "../../service-manifest.js";
import {
  SERVICE_MANIFEST_SCHEMA_URL,
  SERVICE_MANIFEST_SCHEMA_VERSION,
  validateServiceManifest,
  validateServiceManifestFile,
} from "../../service-manifest.js";
import * as configsModule from "../../service-manifest-configs.js";
import * as coreFieldsModule from "../../service-manifest-core-fields.js";
import * as dockerNameModule from "../../service-manifest-docker-name.js";
import * as generatedFieldsModule from "../../service-manifest-generated-fields.js";
import * as healthModule from "../../service-manifest-health.js";
import * as restartModule from "../../service-manifest-restart.js";
import * as secretsModule from "../../service-manifest-secrets.js";
import * as sidecarsModule from "../../service-manifest-sidecars.js";
import * as webUiModule from "../../service-manifest-web-ui.js";

describe("service manifest module contract", () => {
  it("publishes the schema version and documentation URL", () => {
    expect(SERVICE_MANIFEST_SCHEMA_VERSION).toBe(1);
    expect(SERVICE_MANIFEST_SCHEMA_URL).toContain("schema.service.json");
  });

  it("publishes the validation entry points", () => {
    expect(typeof validateServiceManifest).toBe("function");
    expect(typeof validateServiceManifestFile).toBe("function");
  });
});

describe("service-manifest re-exports", () => {
  it("re-exports every moved validator and helper unchanged", () => {
    expect(manifestFacade.healthCheckErrors).toBe(healthModule.healthCheckErrors);
    expect(manifestFacade.healthCheckPathOf).toBe(healthModule.healthCheckPathOf);
    expect(manifestFacade.isHealthCheckDisabled).toBe(healthModule.isHealthCheckDisabled);
    expect(manifestFacade.parseHealthCheckConfig).toBe(healthModule.parseHealthCheckConfig);
    expect(manifestFacade.readinessProbeOf).toBe(healthModule.readinessProbeOf);
    expect(manifestFacade.HEALTH_PATH_PATTERN).toBe(healthModule.HEALTH_PATH_PATTERN);
    expect(manifestFacade.sidecarErrors).toBe(sidecarsModule.sidecarErrors);
    expect(manifestFacade.secretsErrors).toBe(secretsModule.secretsErrors);
    expect(manifestFacade.secretConflictWarnings).toBe(secretsModule.secretConflictWarnings);
    expect(manifestFacade.configsErrors).toBe(configsModule.configsErrors);
    expect(manifestFacade.validateGeneratedStringFields).toBe(
      generatedFieldsModule.validateGeneratedStringFields,
    );
    expect(manifestFacade.generatedFieldErrorsForFile).toBe(
      generatedFieldsModule.generatedFieldErrorsForFile,
    );
    expect(manifestFacade.BASE_PATH_PATTERN).toBe(generatedFieldsModule.BASE_PATH_PATTERN);
    expect(manifestFacade.dockerNameErrors).toBe(dockerNameModule.dockerNameErrors);
    expect(manifestFacade.isDockerSafeName).toBe(dockerNameModule.isDockerSafeName);
    expect(manifestFacade.webUiErrors).toBe(webUiModule.webUiErrors);
    expect(manifestFacade.restartErrors).toBe(restartModule.restartErrors);
    expect(manifestFacade.appTypeAndPortErrors).toBe(coreFieldsModule.appTypeAndPortErrors);
    expect(manifestFacade.getInvalidServiceRoutePathFields).toBe(
      coreFieldsModule.getInvalidServiceRoutePathFields,
    );
  });
});
