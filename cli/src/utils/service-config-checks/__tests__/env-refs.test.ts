// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
// biome-ignore-all lint/suspicious/noTemplateCurlyInString: these strings are service.json env references, not templates
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { unsetEnvReferences, unsetEnvWarning } from "../env-refs.js";
import { tempProject } from "./helpers.js";

const project = tempProject("flisk-env-refs-");
const { service } = project;
const byo = { appType: "bring-your-own", image: "example/x:1" };

describe("unsetEnvReferences", () => {
  it("flags a ${VAR} with no value on a bring-your-own resource, naming the file, service and key", () => {
    service("api", { ...byo, env: { APP_KEY: "${APP_KEY}" } });
    const refs = unsetEnvReferences(project.root, undefined, {});
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ service: "api", envKey: "APP_KEY", variable: "APP_KEY" });
    expect(refs[0]?.file).toBe(join("services", "app", "api", "service.json"));
  });

  it("does not flag a reference that carries a default", () => {
    service("api", {
      ...byo,
      env: { A: "${MISSING:-fallback}", B: "${OTHER-another}", C: "${EMPTY:-}" },
    });
    expect(unsetEnvReferences(project.root, undefined, {})).toHaveLength(0);
  });

  it("does not flag a variable the project .env or the shell holds", () => {
    service("api", { ...byo, env: { A_KEY: "${A_KEY}", B_KEY: "${B_KEY}" } });
    writeFileSync(join(project.root, ".env"), "B_KEY=from-file\n");
    const refs = unsetEnvReferences(project.root, undefined, { A_KEY: "from-env" });
    expect(refs).toHaveLength(0);
  });

  it("flags a variable whose .env line is empty", () => {
    service("api", { ...byo, env: { APP_KEY: "${APP_KEY}" } });
    writeFileSync(join(project.root, ".env"), "APP_KEY=\n");
    const refs = unsetEnvReferences(project.root, undefined, {});
    expect(refs.map((ref) => ref.variable)).toEqual(["APP_KEY"]);
  });

  it("reads the env file named by FLISK_ENV_FILE instead of .env", () => {
    service("api", { ...byo, env: { A_KEY: "${A_KEY}" } });
    writeFileSync(join(project.root, "other.env"), "A_KEY=1\n");
    expect(
      unsetEnvReferences(project.root, undefined, {
        FLISK_ENV_FILE: join(project.root, "other.env"),
      }),
    ).toHaveLength(0);
  });

  it("flags a ${VAR} with no value on a command service", () => {
    service("api", { command: "node server.js", env: { APP_KEY: "${APP_KEY}" } });
    const refs = unsetEnvReferences(project.root, undefined, {});
    expect(refs.map((ref) => ref.variable)).toEqual(["APP_KEY"]);
  });

  it("lets an earlier env key of the same command service provide the value", () => {
    service("api", { command: "node server.js", env: { A: "1", B: "${A}" } });
    expect(unsetEnvReferences(project.root, undefined, {})).toHaveLength(0);
  });

  it("flags a forward reference to a later env key, as flisk up expands it", () => {
    service("api", { command: "node server.js", env: { B: "${A}", A: "1" } });
    expect(unsetEnvReferences(project.root, undefined, {}).map((ref) => ref.variable)).toEqual([
      "A",
    ]);
  });

  it("lets the service directory's own .env provide the value", () => {
    service("api", { command: "node server.js", env: { SVC_VAR: "${SVC_VAR}" } });
    writeFileSync(join(project.root, "services", "app", "api", ".env"), "SVC_VAR=x\n");
    expect(unsetEnvReferences(project.root, undefined, {})).toHaveLength(0);
  });

  it("does not flag a name secrets.generate writes before the start", () => {
    service("api", {
      ...byo,
      secrets: { generate: { SESSION_SECRET: "hex:32" } },
      env: { S: "${SESSION_SECRET}" },
    });
    expect(unsetEnvReferences(project.root, undefined, {})).toHaveLength(0);
  });

  it("does not flag the checkout identity variables flisk up exports", () => {
    service("api", {
      ...byo,
      env: { ID: "${FLISK_CHECKOUT_ID}", NAME: "${FLISK_CHECKOUT_NAME}" },
    });
    expect(unsetEnvReferences(project.root, undefined, {})).toHaveLength(0);
  });

  it("ignores env on a service that expands it nowhere: no command and not bring-your-own", () => {
    service("api", { env: { APP_KEY: "${APP_KEY}" } });
    expect(unsetEnvReferences(project.root, undefined, {})).toHaveLength(0);
  });

  it("reports each missing variable once per service, across services", () => {
    service("api", { ...byo, env: { A: "${SHARED}", B: "${SHARED}" } });
    service("web", { ...byo, env: { C: "${SHARED}" } }, "app/web");
    const refs = unsetEnvReferences(project.root, undefined, {});
    expect(refs.map((ref) => `${ref.service}:${ref.variable}`)).toEqual([
      "api:SHARED",
      "web:SHARED",
    ]);
  });
});

describe("unsetEnvWarning", () => {
  it("names the file, service, env key and variable, never a value", () => {
    service("api", { ...byo, env: { APP_KEY: "${APP_KEY}" } });
    writeFileSync(join(project.root, ".env"), "OTHER=secret-value\n");
    const refs = unsetEnvReferences(project.root, undefined, { ANOTHER: "secret-2" });
    const warning = unsetEnvWarning(refs[0] as NonNullable<(typeof refs)[0]>);
    expect(warning).toContain(join("services", "app", "api", "service.json"));
    expect(warning).toContain("api");
    expect(warning).toContain("APP_KEY");
    expect(warning).toContain("${APP_KEY}");
    expect(warning).toContain(".env");
    expect(warning).not.toContain("secret-value");
    expect(warning).not.toContain("secret-2");
  });
});
