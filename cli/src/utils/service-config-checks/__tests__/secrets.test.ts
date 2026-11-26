// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkRequiredSecrets, warnSecretConflicts } from "../secrets.js";
import { tempProject } from "./helpers.js";

const project = tempProject("flisk-secret-checks-");
const { service } = project;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("checkRequiredSecrets", () => {
  it("fails for a required secret with no value, naming the file and the secret", () => {
    service("api", { secrets: { required: ["SECRET_KEY"], optional: ["TOKEN"] } });
    const result = checkRequiredSecrets(project.root, undefined, {});
    expect(result.didPass).toBe(false);
    expect(result.message).toContain("secret SECRET_KEY has no value");
    expect(result.message).toContain(join("services", "app", "api", "service.json"));
    expect(result.message).not.toContain("TOKEN");
    expect(result.fix).toContain(".env");
  });

  it("passes when the environment or the project .env holds a value", () => {
    service("api", { secrets: { required: ["A_KEY", "B_KEY"] } });
    writeFileSync(join(project.root, ".env"), "B_KEY=from-file\n");
    expect(checkRequiredSecrets(project.root, undefined, { A_KEY: "from-env" }).didPass).toBe(true);
    expect(checkRequiredSecrets(project.root, undefined, { A_KEY: "  " }).didPass).toBe(false);
  });

  it("reads the env file named by FLISK_ENV_FILE instead of .env", () => {
    service("api", { secrets: { required: ["A_KEY"] } });
    writeFileSync(join(project.root, "other.env"), "A_KEY=1\n");
    expect(
      checkRequiredSecrets(project.root, undefined, {
        FLISK_ENV_FILE: join(project.root, "other.env"),
      }).didPass,
    ).toBe(true);
  });

  it("does not require a name that secrets.generate writes before the start", () => {
    service("api", {
      secrets: { required: ["SESSION_SECRET"], generate: { SESSION_SECRET: "hex:32" } },
    });
    expect(checkRequiredSecrets(project.root, undefined, {}).didPass).toBe(true);
  });

  it("requires a provider's token unless the provider has a local fallback", () => {
    service("agent", {
      providers: {
        braket: { url: "https://braket.example", tokenSecret: "AWS_BRAKET_TOKEN" },
        "ibm-quantum": {
          url: "https://quantum.example",
          tokenSecret: "IBM_QUANTUM_TOKEN",
          fallback: "quantum-sim",
        },
      },
    });
    const result = checkRequiredSecrets(project.root, undefined, {});
    expect(result.didPass).toBe(false);
    expect(result.message).toContain("(token of provider braket)");
    expect(result.message).not.toContain("IBM_QUANTUM_TOKEN");
  });

  it("passes with a warning under FLISK_SECRET_PROVIDER=infisical when this build has no bridge", () => {
    service("api", { secrets: { required: ["A_KEY"] } });
    const result = checkRequiredSecrets(project.root, undefined, {
      FLISK_SECRET_PROVIDER: "infisical",
    });
    expect(result.didPass).toBe(true);
    expect(result.isWarning).toBe(true);
    expect(result.message).toContain("A_KEY");
  });

  it("passes cleanly under infisical when a bridge is present", () => {
    service("api", { secrets: { required: ["A_KEY"] } });
    const result = checkRequiredSecrets(project.root, undefined, {
      FLISK_SECRET_PROVIDER: "infisical",
      FLISK_SECRET_BRIDGE: "1",
    });
    expect(result.didPass).toBe(true);
    expect(result.isWarning).toBeUndefined();
    expect(result.message).toContain("secret provider");
  });

  it("warns under infisical with no bridge even when nothing is required", () => {
    service("api");
    const result = checkRequiredSecrets(project.root, undefined, {
      FLISK_SECRET_PROVIDER: "infisical",
    });
    expect(result.didPass).toBe(true);
    expect(result.isWarning).toBe(true);
    expect(result.message).toContain("no required secrets to inject");
  });
});

describe("warnSecretConflicts", () => {
  const byo = { appType: "bring-your-own", image: "example/x:1" };

  it("warns when a literal env value overrides a declared secret", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    service("api", {
      ...byo,
      secrets: { required: ["API_KEY"] },
      env: { API_KEY: "literal" },
    });
    warnSecretConflicts(project.root);
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0]?.[0])).toContain("API_KEY");
  });

  it("stays silent when no literal collides with a declared secret", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    service("api", { ...byo, secrets: { required: ["API_KEY"] }, env: { OTHER: "x" } });
    warnSecretConflicts(project.root);
    expect(warn).not.toHaveBeenCalled();
  });
});
