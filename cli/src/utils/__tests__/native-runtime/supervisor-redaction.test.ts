// biome-ignore-all lint/suspicious/noTemplateCurlyInString: literal shell and migrator references are test fixtures
// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { SERVICE_LOCAL_JSON } from "../../constants.js";
import { applyServiceLocalOverrides } from "../../service-local-overrides.js";
import { native } from "../../test-support/native-runtime.js";

describe("native supervisor log redaction", () => {
  native.nativeTestContext();

  it("redacts default and selected env secrets before terminal output and private log writes", async () => {
    const root = native.createTempDir();
    const jwt = "NATIVE_JWT_SECRET_DO_NOT_LOG_12345";
    const password = "NATIVE_DB_PASSWORD_DO_NOT_LOG_67890";
    const extraEnvPath = native.join(root, ".env.integration");
    native.writeFileSync(native.join(root, ".env"), `JWT_SECRET=${jwt}\n`);
    native.writeFileSync(extraEnvPath, `DB_PASSWORD=${password}\n`);
    native.writeFileSync(
      native.join(root, "leaker.mjs"),
      "console.log(`jwt=${process.env.JWT_SECRET} db=${process.env.DB_PASSWORD}`);\n",
    );
    const logPath = native.nativeLogPath(root, "leaker");
    native.mkdirSync(native.join(root, ".flisk", "native", "logs"), {
      recursive: true,
      mode: 0o755,
    });
    native.writeFileSync(logPath, "previous benign log\n", { mode: 0o644 });

    const vars = { JWT_SECRET: jwt, DB_PASSWORD: password };
    const plan = native.planNativeRun(
      [
        native.nativeService(root, "leaker", {
          appType: "migrator",
          command: `${native.NODE} leaker.mjs`,
        }),
      ],
      vars,
      root,
    );
    const lines: string[] = [];
    const supervisor = new native.NativeSupervisor(
      root,
      plan.services,
      { onLine: (_name, line) => lines.push(line) },
      { baseEnv: vars, extraEnvPaths: [extraEnvPath] },
    );
    native.supervisors.push(supervisor);
    expect(await supervisor.start()).toEqual([]);
    await native.waitFor(() => lines.length > 0);

    const stored = native.readFileSync(logPath, "utf-8");
    expect(lines).toContain("jwt=[REDACTED] db=[REDACTED]");
    expect(stored).toContain("jwt=[REDACTED] db=[REDACTED]");
    expect(stored).not.toContain(jwt);
    expect(stored).not.toContain(password);
    if (process.platform !== "win32") {
      expect(native.statSync(logPath).mode & 0o777).toBe(0o600);
      expect(native.statSync(native.join(root, ".flisk", "native", "logs")).mode & 0o777).toBe(
        0o700,
      );
    }
  });

  it("masks secret shapes and a printed private key before output and the stored log", async () => {
    const root = native.createTempDir();
    native.writeFileSync(
      native.join(root, "leaker.mjs"),
      [
        'console.log("Authorization: Bearer abcdef1234567890");',
        'console.log("-----' + 'BEGIN PRIVATE KEY-----");',
        'console.log("MIIEvQIBADANBgkqhkiG9w0BAQEFAASC");',
        'console.log("-----' + 'END PRIVATE KEY-----");',
        'console.log("done");',
      ].join("\n"),
    );
    const plan = native.planNativeRun(
      [
        native.nativeService(root, "leaker", {
          appType: "migrator",
          command: `${native.NODE} leaker.mjs`,
        }),
      ],
      {},
      root,
    );
    const lines: string[] = [];
    const supervisor = new native.NativeSupervisor(root, plan.services, {
      onLine: (_name, line) => lines.push(line),
    });
    native.supervisors.push(supervisor);
    expect(await supervisor.start()).toEqual([]);
    await native.waitFor(() => lines.includes("done"));

    const stored = native.readFileSync(native.nativeLogPath(root, "leaker"), "utf-8");
    for (const text of [lines.join("\n"), stored]) {
      expect(text).toContain("Bearer [REDACTED]");
      expect(text).not.toContain("abcdef1234567890");
      expect(text).not.toContain("MIIEvQIBADANBgkqhkiG9w0BAQEFAASC");
    }
  });

  it("masks secret env values introduced by service.local.json, including multiline values", async () => {
    const root = native.createTempDir();
    const serviceDir = native.join(root, "leaker");
    native.mkdirSync(serviceDir, { recursive: true });
    const localToken = "LOCAL_API_TOKEN_DO_NOT_LOG_13579";
    const multiline = `FIRST_HALF_OF_LOCAL_SECRET\nSECOND_HALF_OF_LOCAL_SECRET`;
    // The committed service.json holds no secrets; a sibling service.local.json adds them, the way
    // `flisk up`'s native path reads the file before planning the run.
    native.writeFileSync(
      native.join(serviceDir, SERVICE_LOCAL_JSON),
      JSON.stringify({ env: { API_TOKEN: localToken, PRIVATE_NOTES: multiline } }),
    );
    native.writeFileSync(
      native.join(serviceDir, "leaker.mjs"),
      [
        'console.log("token=" + process.env.API_TOKEN);',
        'console.error("err-token=" + process.env.API_TOKEN);',
        "console.log(process.env.PRIVATE_NOTES);",
        "console.error(process.env.PRIVATE_NOTES);",
      ].join("\n"),
    );
    const applied = applyServiceLocalOverrides([
      native.nativeService(serviceDir, "leaker", {
        appType: "migrator",
        command: `${native.NODE} leaker.mjs`,
      }),
    ]);
    const plan = native.planNativeRun(applied.resources, {}, root);
    const lines: string[] = [];
    const supervisor = new native.NativeSupervisor(root, plan.services, {
      onLine: (_name, line) => lines.push(line),
    });
    native.supervisors.push(supervisor);
    expect(await supervisor.start()).toEqual([]);
    await native.waitFor(() => lines.length >= 6);

    // stdout and stderr are redacted alike: the token never reaches the terminal or the stored log.
    expect(lines).toContain("token=[REDACTED]");
    expect(lines).toContain("err-token=[REDACTED]");
    expect(lines.filter((line) => line === "[REDACTED]")).toHaveLength(4);
    const output = lines.join("\n");
    expect(output).not.toContain(localToken);
    // A multiline secret is masked line by line, not only as a whole.
    expect(output).not.toContain("FIRST_HALF_OF_LOCAL_SECRET");
    expect(output).not.toContain("SECOND_HALF_OF_LOCAL_SECRET");
    const stored = native.readFileSync(native.nativeLogPath(root, "leaker"), "utf-8");
    expect(stored).not.toContain(localToken);
    expect(stored).not.toContain("FIRST_HALF_OF_LOCAL_SECRET");
    expect(stored).not.toContain("SECOND_HALF_OF_LOCAL_SECRET");
  });

  it("masks a migrator output that a secret-named key receives", async () => {
    const root = native.createTempDir();
    native.writeFileSync(
      native.join(root, "printer.mjs"),
      'console.log("token=" + process.env.API_TOKEN);\nsetInterval(() => {}, 1000);\n',
    );
    const plan = native.planNativeRun([
      native.nativeService(root, "migrator", {
        appType: "migrator",
        command: 'printf "KEY=resolved_secret_value_789\\n" > "$FLISK_OUTPUT"',
      }),
      native.nativeService(root, "api", {
        command: `${native.NODE} printer.mjs`,
        dependsOn: ["migrator"],
        env: { API_TOKEN: "${migrator:KEY}" },
      }),
    ]);
    const lines: string[] = [];
    const supervisor = new native.NativeSupervisor(root, plan.services, {
      onLine: (_name, line) => lines.push(line),
    });
    native.supervisors.push(supervisor);
    expect(await supervisor.start()).toEqual([]);
    await native.waitFor(() => lines.some((line) => line.startsWith("token=")));

    expect(lines).toContain("token=[REDACTED]");
    expect(lines.join("\n")).not.toContain("resolved_secret_value_789");
    expect(native.readFileSync(native.nativeLogPath(root, "api"), "utf-8")).not.toContain(
      "resolved_secret_value_789",
    );
  });
});
